// gcloud's two sign-ins: the active account's, which gcloud itself uses (CLI),
// and Application Default Credentials (ADC), which client libraries use.
// `gcloud auth login --update-adc` renews both.
//
// A check asks Google's token endpoint to refresh each one, as gcloud would.
// `gcloud auth print-access-token` answers from a token cached for up to an
// hour, so it would miss a session that has just ended. A shell reads each
// refresh token and pipes it to curl, whose answer goes to /dev/null, so no
// token reaches the mod, a file or a command line.
//
// `nextStatus` turns the last status into the next. A status is
//
//   { account, credentials: [{ name, state, at }] }
//
// `account` is the active one, or "". `state` is "ok", "expired", "none" (no
// sign-in), "other" (not a user's, such as a service account key, so not
// checked) or "unknown" (Google hasn't answered yet). `at` is when it was last
// read, or 0 if never.

export const LOGIN = ["gcloud", "auth", "login", "--update-adc"];

const CREDENTIALS = ["CLI", "ADC"];

// Prints the active account, then for CLI and for ADC the token endpoint's
// HTTP status ("000" when it didn't answer), "none" or "other". gcloud keeps
// each account's credentials for other tools in legacy_credentials/, in ADC's
// format.
const CHECK = `dir=\${CLOUDSDK_CONFIG:-$HOME/.config/gcloud}
config=\${CLOUDSDK_ACTIVE_CONFIG_NAME:-$(cat "$dir/active_config" 2>/dev/null)}
account=\${CLOUDSDK_CORE_ACCOUNT:-$(awk -F ' *= *' '/^\\[/ { core = $0 == "[core]" } core && $1 == "account" { print $2; exit }' "$dir/configurations/config_\${config:-default}" 2>/dev/null)}
field() { plutil -extract "$1" raw -o - "$2" 2>/dev/null; }
check() {
  [ -f "$1" ] || { echo none; return; }
  [ "$(field type "$1")" = authorized_user ] || { echo other; return; }
  printf 'grant_type=refresh_token&client_id=%s&client_secret=%s&refresh_token=%s' \\
    "$(field client_id "$1")" "$(field client_secret "$1")" "$(field refresh_token "$1")" |
    curl -s --max-time 10 -o /dev/null -w '%{http_code}\\n' --data @- \\
      "$(field token_uri "$1" || echo https://oauth2.googleapis.com/token)"
}
printf '%s\\n' "$account"
check "$dir/legacy_credentials/$account/adc.json"
check "\${GOOGLE_APPLICATION_CREDENTIALS:-$dir/application_default_credentials.json}"`;

const STALE_MS = 5 * 60_000;

const TIPS = {
  ok: "signed in",
  expired: "expired",
  none: "not signed in",
  other: "not a user's sign-in, not checked",
  unknown: "not checked yet",
};

const VERDICTS = {
  expired: { text: "expired", tone: "ansi1" },
  none: { text: "signed out", tone: "ansi3" },
  unknown: { text: "?", tone: "dim" },
  stale: { text: "ok", tone: "dim" },
  ok: { text: "ok", tone: "ansi2" },
  other: { text: "—", tone: "dim" },
};

export async function nextStatus(exec, previous, now) {
  const result = await exec("sh", ["-c", CHECK]).catch(() => null);
  if (!result) return previous;
  const [account, ...answers] = result.stdout.split("\n");
  return {
    account,
    credentials: CREDENTIALS.map((name, i) => {
      const state = stateOf(answers[i]);
      if (state !== "unknown") return { name, state, at: now };
      return previous?.credentials[i] ?? { name, state, at: 0 };
    }),
  };
}

// Google refuses a refresh token with 400 invalid_grant once its sign-in has
// expired, been revoked, or needs reauthenticating.
function stateOf(answer) {
  if (answer === "none" || answer === "other") return answer;
  if (answer === "200") return "ok";
  if (answer === "400" || answer === "401") return "expired";
  return "unknown";
}

export function present(status, now) {
  const key = verdict(status.credentials, now);
  const login = key === "expired" || key === "none";
  const tip = [
    ...status.credentials.map((c) => {
      const name = c.name === "CLI" && status.account ? `CLI (${status.account})` : c.name;
      return `${name}: ${TIPS[c.state]}${c.at ? `, as of ${clock(c.at)}` : ""}`;
    }),
    ...(login ? [`Click to run ${LOGIN.join(" ")}`] : []),
  ].join("\n");
  return { account: status.account, ...VERDICTS[key], login, tip };
}

function verdict(credentials, now) {
  const checked = credentials.filter((c) => c.state !== "other");
  const worst = ["expired", "none", "unknown"].find((s) => checked.some((c) => c.state === s));
  if (worst) return worst;
  if (!checked.length) return "other";
  return checked.some((c) => now - c.at > STALE_MS) ? "stale" : "ok";
}

function clock(at) {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
