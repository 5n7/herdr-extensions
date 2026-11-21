import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaude } from "./claude.js";

const HOME = "/Users/me";
const NOW = Date.parse("2026-11-21T04:00:00Z");
const MINUTE = 60_000;

const SESSION = { kind: "session", percent: 60, resets_at: "2026-11-21T07:00:00+00:00" };
const WEEK = { kind: "weekly_all", percent: 40, resets_at: "2026-11-25T00:00:00+00:00" };
const FABLE_WEEK = {
  kind: "weekly_scoped",
  percent: 80,
  resets_at: "2026-11-25T00:00:00+00:00",
  scope: { model: { id: null, display_name: "Fable" }, surface: null },
};

// Stand-ins for the programs USAGE runs. security knows the logins of
// ~/.claude and of the folder whose item is $STUB_WORK_SVC, their token
// expiring at $STUB_EXPIRES (ms). curl notes its arguments and stdin, and
// answers $STUB_STATUS as an Enterprise account whose profile has no display
// name.
const TOKEN = "sk-ant-oat01-test";
const SECURITY_STUB = `#!/bin/sh
[ "$3" = "Claude Code-credentials" ] || [ "$3" = "$STUB_WORK_SVC" ] || exit 44
printf '{"claudeAiOauth":{"accessToken":"%s","expiresAt":%s}}' "${TOKEN}" "\${STUB_EXPIRES:-9999999999999}"
`;
const CURL_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG/argv"
cat >> "$STUB_LOG/stdin"
for a; do url=$a; done
case $url in
*/profile) printf '%s' '{"organization":{"plan_display_name":"","organization_type":"claude_enterprise"}}' ;;
*/usage) printf '%s\\n%s' '{"limits":[{"kind":"session","percent":100,"resets_at":"2026-11-21T07:00:00Z"}]}' "\${STUB_STATUS:-200}" ;;
esac
`;

describe("createClaude", () => {
  test("reads an account per config folder with a login", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("Ultra", { limits: [SESSION, WEEK, FABLE_WEEK] }),
      [`${HOME}/.claude-old`]: { code: 3, stdout: "" },
    });
    const [account, ...rest] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(rest).toEqual([]);
    expect(account).toMatchObject({
      id: `claude:${HOME}/.claude`,
      provider: "claude",
      icon: "claude",
      name: "Claude Ultra",
      source: "~/.claude",
      at: NOW,
    });
    expect(account.limits).toEqual([
      { key: "5h", label: "5-hour", pct: 60, resetsAt: Date.parse(SESSION.resets_at), main: true },
      { key: "7d", label: "7-day", pct: 40, resetsAt: Date.parse(WEEK.resets_at), main: true },
      {
        key: "fbl",
        label: "7-day Fable",
        pct: 80,
        resetsAt: Date.parse(FABLE_WEEK.resets_at),
        main: false,
      },
    ]);
  });

  test("puts only the 5-hour limit on an Enterprise account's line", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("claude_enterprise", {
        seven_day: null,
        limits: [
          { ...SESSION, percent: 100 },
          { ...FABLE_WEEK, percent: 0 },
        ],
      }),
    });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.name).toBe("Claude Enterprise");
    expect(account.limits.filter((l) => l.main).map((l) => l.key)).toEqual(["5h"]);
  });

  test("reads a plan name with Claude or a qualifier in it", async () => {
    const names = [];
    for (const plan of ["Claude Max", "Max 20x"]) {
      const exec = fakeExec({ [`${HOME}/.claude`]: usage(plan, { limits: [SESSION] }) });
      const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
      names.push(account.name);
    }
    expect(names).toEqual(["Claude Max", "Claude Max 20x"]);
  });

  test("falls back to five_hour and seven_day without limits", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("pro", {
        five_hour: { utilization: 30, resets_at: "2026-11-21T05:00:00Z" },
        seven_day: { utilization: 20, resets_at: "2026-11-25T00:00:00Z" },
      }),
    });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.name).toBe("Claude Pro");
    expect(account.limits).toEqual([
      {
        key: "5h",
        label: "5-hour",
        pct: 30,
        resetsAt: Date.parse("2026-11-21T05:00:00Z"),
        main: true,
      },
      {
        key: "7d",
        label: "7-day",
        pct: 20,
        resetsAt: Date.parse("2026-11-25T00:00:00Z"),
        main: true,
      },
    ]);
  });

  test("asks for the plan only once an hour", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    exec.answers[`${HOME}/.claude`] = usage("", { limits: [SESSION] });
    const second = await claude.poll(first, NOW + 5 * MINUTE);
    await claude.poll(second, NOW + 90 * MINUTE);
    expect(exec.planAsked).toEqual(["1", "0", "1"]);
    expect(second[0].name).toBe("Claude Max");
  });

  test("keeps the last account while its token is expired", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    exec.answers[`${HOME}/.claude`] = { code: 4, stdout: "" };
    expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual(first);
  });

  test("waits 15 minutes after a 429", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    exec.answers[`${HOME}/.claude`] = usage("", {}, 429);
    expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual(first);
    expect(await claude.poll(first, NOW + 10 * MINUTE)).toEqual(first);
    await claude.poll(first, NOW + 20 * MINUTE);
    expect(exec.planAsked).toHaveLength(3);
  });

  test("drops a shown account once its login is gone", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    exec.answers[`${HOME}/.claude`] = { code: 3, stdout: "" };
    expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual([]);
  });

  test("keeps the last account when the Keychain, curl or exec fails", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    for (const answer of [{ code: 5, stdout: "" }, usage("", {}, "000"), new Error("timeout")]) {
      exec.answers[`${HOME}/.claude`] = answer;
      expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual(first);
    }
  });

  test("keeps the last account when the answer isn't JSON or isn't 200", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    for (const answer of [
      { code: 0, stdout: "\n<html>\n200" },
      usage("", { limits: [SESSION] }, 401),
    ]) {
      exec.answers[`${HOME}/.claude`] = answer;
      expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual(first);
    }
  });

  test("asks for the plan again next time when the profile named none", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    await claude.poll(first, NOW + 5 * MINUTE);
    expect(first[0].name).toBe("Claude");
    expect(exec.planAsked).toEqual(["1", "1"]);
  });

  test("keeps the last plan when the profile names none", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const claude = createClaude({ exec, home: HOME });
    const first = await claude.poll([], NOW);
    exec.answers[`${HOME}/.claude`] = usage("", { limits: [SESSION] });
    const [account] = await claude.poll(first, NOW + 90 * MINUTE);
    expect(account.name).toBe("Claude Max");
  });

  test("labels a kind it doesn't know by its own name", async () => {
    const monthly = {
      kind: "monthly_scoped",
      percent: 10,
      resets_at: null,
      scope: { model: null, surface: "Code" },
    };
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION, monthly] }) });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.limits[1]).toEqual({
      key: "cd",
      label: "monthly scoped Code",
      pct: 10,
      resetsAt: 0,
      main: false,
    });
  });

  test("skips entries without a kind or a percent", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("Max", { limits: [null, { percent: 10 }, SESSION] }),
    });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.limits.map((l) => l.key)).toEqual(["5h"]);
  });

  test("takes five_hour for a session without a percent", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("claude_enterprise", {
        five_hour: { utilization: 30, resets_at: "2026-11-21T05:00:00Z" },
        limits: [{ ...SESSION, percent: null }, FABLE_WEEK],
      }),
    });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.limits.map((l) => [l.key, l.pct, l.main])).toEqual([
      ["5h", 30, true],
      ["fbl", 80, false],
    ]);
  });

  test("falls back to five_hour when no entry has a percent", async () => {
    const exec = fakeExec({
      [`${HOME}/.claude`]: usage("Max", {
        five_hour: { utilization: 30, resets_at: "2026-11-21T05:00:00Z" },
        limits: [{ ...SESSION, percent: null }],
      }),
    });
    const [account] = await createClaude({ exec, home: HOME }).poll([], NOW);
    expect(account.limits.map((l) => [l.key, l.pct])).toEqual([["5h", 30]]);
  });

  test.skipIf(process.platform !== "darwin")(
    "reads the Keychain and hands the token to curl only on stdin",
    () =>
      withStubs(async ({ exec, home, log }) => {
        const accounts = await createClaude({ exec, home }).poll([], NOW);
        expect(accounts.map((a) => a.source)).toEqual(["~/.claude", "~/.claude-work"]);
        expect(accounts[0]).toMatchObject({ name: "Claude Enterprise" });
        expect(accounts[0].limits.map((l) => [l.key, l.pct])).toEqual([["5h", 100]]);
        expect(log("argv")).not.toContain(TOKEN);
        expect(exec.stdout.join("")).not.toContain(TOKEN);
        expect(log("stdin")).toContain(`Authorization: Bearer ${TOKEN}`);
      }),
  );

  test.skipIf(process.platform !== "darwin")(
    "asks nothing while the Keychain's token is expired",
    () =>
      withStubs(async ({ exec, home, log }) => {
        const claude = createClaude({ exec, home });
        const first = await claude.poll([], NOW);
        exec.env.STUB_EXPIRES = "1000";
        expect(await claude.poll(first, NOW + 90 * MINUTE)).toEqual(first);
        expect(log("argv").trim().split("\n")).toHaveLength(4);
      }),
  );

  test.skipIf(process.platform !== "darwin")("asks for the plan only once usage answers", () =>
    withStubs(async ({ exec, home, log }) => {
      exec.env.STUB_STATUS = "401";
      expect(await createClaude({ exec, home }).poll([], NOW)).toEqual([]);
      expect(log("argv")).not.toContain("/profile");
    }),
  );

  test.skipIf(process.platform !== "darwin")("backs off after curl's status line says 429", () =>
    withStubs(async ({ exec, home, log }) => {
      const claude = createClaude({ exec, home });
      const first = await claude.poll([], NOW);
      exec.env.STUB_STATUS = "429";
      expect(await claude.poll(first, NOW + 5 * MINUTE)).toEqual(first);
      expect(await claude.poll(first, NOW + 10 * MINUTE)).toEqual(first);
      expect(log("argv").trim().split("\n")).toHaveLength(6);
    }),
  );

  test("fails when the folders can't be listed", async () => {
    const exec = async () => {
      throw new Error("sh: not found");
    };
    await expect(createClaude({ exec, home: HOME }).poll([], NOW)).rejects.toThrow("sh: not found");
  });

  test("drops the account of a folder that's gone", async () => {
    const exec = fakeExec({ [`${HOME}/.claude`]: usage("Max", { limits: [SESSION] }) });
    const gone = { id: `claude:${HOME}/.claude-work`, dir: `${HOME}/.claude-work`, limits: [] };
    const accounts = await createClaude({ exec, home: HOME }).poll([gone], NOW);
    expect(accounts.map((a) => a.dir)).toEqual([`${HOME}/.claude`]);
  });
});

function usage(plan, json, status = 200) {
  return { code: 0, stdout: `${plan}\n${JSON.stringify(json)}\n${status}` };
}

// Runs `test` against a home with logins in ~/.claude and ~/.claude-work,
// none in ~/.claude-old, and an exec running the real shell with security and
// curl swapped for the stubs. `exec.env` reaches the stubs; `log(name)` reads
// what curl noted.
async function withStubs(test) {
  const root = mkdtempSync(join(tmpdir(), "usage-"));
  try {
    const bin = join(root, "bin");
    const home = join(root, "home");
    mkdirSync(bin);
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".claude-old"));
    mkdirSync(join(home, ".claude-work"));
    // As Claude Code names a folder's Keychain item.
    const hash = createHash("sha256").update(join(home, ".claude-work")).digest("hex");
    for (const [name, script] of [
      ["curl", CURL_STUB],
      ["security", SECURITY_STUB],
    ]) {
      writeFileSync(join(bin, name), script);
      chmodSync(join(bin, name), 0o755);
    }
    const exec = async (command, args) => {
      const proc = Bun.spawn([command, ...args], {
        env: {
          ...exec.env,
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          STUB_LOG: root,
          STUB_WORK_SVC: `Claude Code-credentials-${hash.slice(0, 8)}`,
        },
        stdout: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      exec.stdout.push(stdout);
      return { code: await proc.exited, stdout };
    };
    exec.env = {};
    exec.stdout = [];
    await test({ exec, home, log: (name) => readFileSync(join(root, name), "utf8") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakeExec(answers) {
  const exec = async (_command, args) => {
    const [, , , dir, askPlan] = args;
    if (dir === undefined) return { code: 0, stdout: `${Object.keys(exec.answers).join("\n")}\n` };
    exec.planAsked.push(askPlan);
    const answer = exec.answers[dir];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  exec.answers = answers;
  exec.planAsked = [];
  return exec;
}
