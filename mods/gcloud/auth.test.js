import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextStatus, present } from "./auth.js";

const NOW = new Date(2026, 10, 25, 14, 5).getTime();
const MINUTE = 60_000;
const ACCOUNT = "me@example.com";

const CLI_TOKEN = "1//cli-refresh-token";
const ADC_TOKEN = "1//adc-refresh-token";

const CURL_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG/argv"
body=$(cat)
printf '%s\\n' "$body" >> "$STUB_LOG/stdin"
case $body in
*cli-refresh-token*) printf '%s\\n' "\${STUB_CLI:-200}" ;;
*) printf '%s\\n' "\${STUB_ADC:-200}" ;;
esac
`;

const onMac = test.skipIf(process.platform !== "darwin");

describe("nextStatus", () => {
  onMac("refreshes the active account's sign-in and ADC, the tokens only on stdin", () =>
    withGcloud(async ({ exec, log }) => {
      const status = await nextStatus(exec, null, NOW);
      expect(status).toEqual({
        account: ACCOUNT,
        credentials: [
          { name: "CLI", state: "ok", at: NOW },
          { name: "ADC", state: "ok", at: NOW },
        ],
      });
      expect(log("argv")).toContain("https://oauth2.googleapis.com/token");
      expect(log("argv")).not.toContain("refresh-token");
      expect(exec.stdout.join("")).not.toContain("refresh-token");
      expect(log("stdin")).toContain(
        `grant_type=refresh_token&client_id=cli-id&client_secret=cli-secret&refresh_token=${CLI_TOKEN}`,
      );
      expect(log("stdin")).toContain(`refresh_token=${ADC_TOKEN}`);
    }),
  );

  onMac("calls a refused sign-in expired", () =>
    withGcloud(async ({ exec }) => {
      exec.env.STUB_ADC = "400";
      const status = await nextStatus(exec, null, NOW);
      expect(status.credentials.map((c) => c.state)).toEqual(["ok", "expired"]);
    }),
  );

  onMac("doesn't send a service account key's credentials", () =>
    withGcloud(async ({ exec, home, log }) => {
      writeJson(join(home, ".config/gcloud/application_default_credentials.json"), {
        type: "service_account",
        private_key: "-----BEGIN PRIVATE KEY-----",
      });
      const status = await nextStatus(exec, null, NOW);
      expect(status.credentials.map((c) => c.state)).toEqual(["ok", "other"]);
      expect(log("argv").trim().split("\n")).toHaveLength(1);
    }),
  );

  onMac("takes the account from the active configuration", () =>
    withGcloud(async ({ exec, home }) => {
      writeFileSync(join(home, ".config/gcloud/active_config"), "default");
      const status = await nextStatus(exec, null, NOW);
      expect(status.account).toBe("");
      expect(status.credentials.map((c) => c.state)).toEqual(["none", "ok"]);
    }),
  );

  onMac("finds no sign-in without gcloud's folder", () =>
    withGcloud(async ({ exec, home }) => {
      rmSync(join(home, ".config/gcloud"), { recursive: true });
      const status = await nextStatus(exec, null, NOW);
      expect(status).toMatchObject({ account: "" });
      expect(status.credentials.map((c) => c.state)).toEqual(["none", "none"]);
    }),
  );

  test("calls a 400 or 401 expired", async () => {
    const status = await nextStatus(answering(`${ACCOUNT}\n400\n401\n`), null, NOW);
    expect(status.credentials.map((c) => c.state)).toEqual(["expired", "expired"]);
  });

  test("keeps each sign-in's last state while Google doesn't answer", async () => {
    const first = await nextStatus(answering(`${ACCOUNT}\n200\n400\n`), null, NOW);
    for (const answers of ["000\n000", "429\n500", "\n"]) {
      const exec = answering(`${ACCOUNT}\n${answers}\n`);
      expect(await nextStatus(exec, first, NOW + MINUTE)).toEqual(first);
    }
  });

  test("marks a sign-in unknown until Google first answers", async () => {
    const status = await nextStatus(answering(`${ACCOUNT}\n000\n200\n`), null, NOW);
    expect(status.credentials).toEqual([
      { name: "CLI", state: "unknown", at: 0 },
      { name: "ADC", state: "ok", at: NOW },
    ]);
  });

  test("keeps the last status when the shell can't run", async () => {
    const first = await nextStatus(answering(`${ACCOUNT}\n200\n200\n`), null, NOW);
    const exec = async () => {
      throw new Error("sh: not found");
    };
    expect(await nextStatus(exec, first, NOW + MINUTE)).toBe(first);
  });
});

describe("present", () => {
  test("says ok while both sign-ins are fresh", () => {
    const shown = present(status("ok", "ok"), NOW);
    expect(shown).toMatchObject({ account: ACCOUNT, text: "ok", tone: "ansi2", login: false });
    expect(shown.tip).toBe(`CLI (${ACCOUNT}): signed in, as of 14:05\nADC: signed in, as of 14:05`);
  });

  test("says expired and offers a sign-in while one has expired", () => {
    const shown = present(status("ok", "expired"), NOW);
    expect(shown).toMatchObject({ text: "expired", tone: "ansi1", login: true });
    expect(shown.tip).toBe(
      `CLI (${ACCOUNT}): signed in, as of 14:05\nADC: expired, as of 14:05\nClick to run gcloud auth login --update-adc`,
    );
  });

  test("puts an expired sign-in before a missing one", () => {
    expect(present(status("none", "expired"), NOW).text).toBe("expired");
  });

  test("says signed out and offers a sign-in while one is missing", () => {
    expect(present(status("ok", "none"), NOW)).toMatchObject({
      text: "signed out",
      tone: "ansi3",
      login: true,
    });
  });

  test("dims ok once a sign-in was last read over five minutes ago", () => {
    expect(present(status("ok", "ok"), NOW + 6 * MINUTE)).toMatchObject({
      text: "ok",
      tone: "dim",
    });
  });

  test("keeps saying expired while the sign-in can't be read", () => {
    expect(present(status("ok", "expired"), NOW + 60 * MINUTE).tone).toBe("ansi1");
  });

  test("asks until Google first answers", () => {
    const shown = present(status("unknown", "ok"), NOW);
    expect(shown).toMatchObject({ text: "?", tone: "dim", login: false });
    expect(shown.tip).toStartWith(`CLI (${ACCOUNT}): not checked yet\n`);
  });

  test("leaves credentials it doesn't check out of the verdict", () => {
    expect(present(status("ok", "other"), NOW)).toMatchObject({ text: "ok", tone: "ansi2" });
    expect(present(status("other", "other"), NOW).text).toBe("—");
  });
});

async function withGcloud(body) {
  const root = mkdtempSync(join(tmpdir(), "gcloud-"));
  try {
    const bin = join(root, "bin");
    const home = join(root, "home");
    const gcloud = join(home, ".config/gcloud");
    mkdirSync(bin);
    mkdirSync(join(gcloud, "configurations"), { recursive: true });
    mkdirSync(join(gcloud, "legacy_credentials", ACCOUNT), { recursive: true });
    writeFileSync(join(gcloud, "active_config"), "work");
    writeFileSync(
      join(gcloud, "configurations/config_work"),
      `[auth]\naccount = someone@example.com\n\n[core]\nproject = p\naccount = ${ACCOUNT}\n`,
    );
    writeJson(join(gcloud, "legacy_credentials", ACCOUNT, "adc.json"), {
      client_id: "cli-id",
      client_secret: "cli-secret",
      refresh_token: CLI_TOKEN,
      type: "authorized_user",
    });
    writeJson(join(gcloud, "application_default_credentials.json"), {
      client_id: "adc-id",
      client_secret: "adc-secret",
      refresh_token: ADC_TOKEN,
      type: "authorized_user",
    });
    writeFileSync(join(bin, "curl"), CURL_STUB);
    chmodSync(join(bin, "curl"), 0o755);
    const exec = async (command, args) => {
      const proc = Bun.spawn([command, ...args], {
        env: { ...exec.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, STUB_LOG: root },
        stdout: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      exec.stdout.push(stdout);
      return { code: await proc.exited, stdout, stderr: "" };
    };
    exec.env = {};
    exec.stdout = [];
    await body({ exec, home, log: (name) => readFileSync(join(root, name), "utf8") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value));
}

function answering(stdout) {
  return async () => ({ code: 0, stdout, stderr: "" });
}

function status(cli, adc) {
  const at = (state) => (state === "unknown" ? 0 : NOW);
  return {
    account: ACCOUNT,
    credentials: [
      { name: "CLI", state: cli, at: at(cli) },
      { name: "ADC", state: adc, at: at(adc) },
    ],
  };
}
