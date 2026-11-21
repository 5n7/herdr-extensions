// Claude Code's accounts: each ~/.claude* folder with a login in the macOS
// Keychain. A shell reads its access token and pipes it to curl, which asks
// Anthropic's usage endpoint (/api/oauth/usage, undocumented), so the token
// never reaches the mod, a file or a command line. Adapted from usage-limits
// in neelrocketbots/herdr-mods.

const BACKOFF_MS = 15 * 60_000;
const PLAN_REFRESH_MS = 60 * 60_000;

const NO_LOGIN = 3;

const CONFIG_DIRS = `for d in "$HOME"/.claude "$HOME"/.claude?*; do [ -d "$d" ] && printf '%s\\n' "$d"; done`;

// sh -c USAGE sh <config folder> <1: ask for the plan too>. Prints the plan
// (empty when not asked, or when usage didn't answer 200), the usage JSON,
// then the HTTP status on its own line. Only the plan leaves the shell, never
// the profile, which holds the email and name.
//
// Claude Code names a folder's Keychain item after the first 8 hex of its
// path's sha256, all but ~/.claude's. It hashes CLAUDE_CONFIG_DIR as set, so a
// value with a trailing slash, or one naming ~/.claude, has an item this can't
// find.
//
// Exit 3: no login there (security's 44 is "not found"); 4: its token expired
// (Claude Code renews it while it runs); 5: the Keychain wouldn't answer
// (locked, or access denied).
const USAGE = `svc="Claude Code-credentials"
[ "$1" = "$HOME/.claude" ] || svc="$svc-$(printf %s "$1" | shasum -a 256 | cut -c1-8)"
s=0
c=$(security find-generic-password -s "$svc" -w 2>/dev/null) || s=$?
[ "$s" -eq 44 ] && exit 3
[ "$s" -eq 0 ] || exit 5
t=$(printf %s "$c" | plutil -extract claudeAiOauth.accessToken raw -o - - 2>/dev/null) || exit 3
e=$(printf %s "$c" | plutil -extract claudeAiOauth.expiresAt raw -o - - 2>/dev/null)
[ -n "$e" ] && [ $((e / 1000)) -lt "$(date +%s)" ] && exit 4
ask() { printf 'Authorization: Bearer %s\\n' "$t" | curl -sS --max-time 10 -H @- -H 'anthropic-beta: oauth-2025-04-20' "$@"; }
usage=$(ask -w '\\n%{http_code}' https://api.anthropic.com/api/oauth/usage)
plan=""
if [ "$2" = 1 ] && [ "$(printf %s "$usage" | tail -n 1)" = 200 ]; then
  profile=$(ask https://api.anthropic.com/api/oauth/profile)
  plan=$(printf %s "$profile" | plutil -extract organization.plan_display_name raw -o - - 2>/dev/null)
  [ -n "$plan" ] || plan=$(printf %s "$profile" | plutil -extract organization.organization_type raw -o - - 2>/dev/null)
fi
printf '%s\\n' "$plan" | tr -d '\\t'
printf %s "$usage"`;

// `poll` rejects when the folders can't be listed.
export function createClaude({ exec, home }) {
  const retryAt = {};
  return {
    key: "claude",
    poll: (previous, now) => pollAccounts({ exec, home, retryAt }, previous, now),
  };
}

async function pollAccounts(env, previous, now) {
  const listed = await env.exec("sh", ["-c", CONFIG_DIRS]);
  const dirs = listed.stdout.split("\n").filter(Boolean);
  const accounts = await Promise.all(
    dirs.map((dir) =>
      pollAccount(
        env,
        dir,
        previous.find((a) => a.dir === dir),
        now,
      ),
    ),
  );
  return accounts.filter((a) => a !== null);
}

async function pollAccount({ exec, home, retryAt }, dir, old, now) {
  const kept = old ?? null;
  if (now < (retryAt[dir] ?? 0)) return kept;
  const askPlan = now - (old?.planAt ?? 0) > PLAN_REFRESH_MS;
  const result = await exec("sh", ["-c", USAGE, "sh", dir, askPlan ? "1" : "0"]).catch(() => null);
  if (result?.code === NO_LOGIN) return null;
  if (result?.code !== 0) return kept;
  const answer = parseAnswer(result.stdout);
  if (answer.status === 429) {
    retryAt[dir] = now + BACKOFF_MS;
    return kept;
  }
  if (answer.status !== 200 || !answer.limits.length) return kept;
  const plan = answer.plan || old?.plan || "";
  return {
    id: `claude:${dir}`,
    provider: "claude",
    icon: "claude",
    name: planName(plan),
    source: dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir,
    limits: answer.limits,
    at: now,
    dir,
    plan,
    planAt: answer.plan ? now : (old?.planAt ?? 0),
  };
}

function parseAnswer(out) {
  const first = out.indexOf("\n");
  const last = out.lastIndexOf("\n");
  const status = Number(out.slice(last + 1));
  let limits = [];
  try {
    limits = parseLimits(JSON.parse(out.slice(first + 1, last)));
  } catch {}
  return { plan: out.slice(0, first).trim(), status, limits };
}

// In the usage endpoint's `limits[]`, `session` is the 5-hour limit,
// `weekly_all` the 7-day one and `weekly_scoped` one model's week. Without a
// usable `session` or `weekly_all`, the top-level `five_hour` and `seven_day`
// stand in.
function parseLimits(json) {
  const limits = (Array.isArray(json?.limits) ? json.limits : [])
    .filter((l) => typeof l?.kind === "string" && typeof l.percent === "number")
    .map(fromLimit);
  if (limits.some((l) => l.main)) return limits;
  const windows = [
    fromWindow(json?.five_hour, "5h", "5-hour"),
    fromWindow(json?.seven_day, "7d", "7-day"),
  ].filter((l) => l !== null);
  return [...windows, ...limits];
}

function fromLimit(l) {
  const resetsAt = Date.parse(l.resets_at) || 0;
  if (l.kind === "session")
    return { key: "5h", label: "5-hour", pct: l.percent, resetsAt, main: true };
  if (l.kind === "weekly_all")
    return { key: "7d", label: "7-day", pct: l.percent, resetsAt, main: true };
  const scope = [l.scope?.model?.display_name, l.scope?.surface].find((s) => typeof s === "string");
  const label =
    l.kind === "weekly_scoped"
      ? `7-day ${scope ?? "scoped"}`
      : [l.kind.replace(/_/g, " "), scope].filter(Boolean).join(" ");
  return { key: abbreviate(scope || l.kind), label, pct: l.percent, resetsAt, main: false };
}

function abbreviate(name) {
  const letters = name.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "?";
  return (letters[0] + letters.slice(1).replace(/[aeiou]/g, "")).slice(0, 3);
}

function fromWindow(w, key, label) {
  if (typeof w?.utilization !== "number") return null;
  return { key, label, pct: w.utilization, resetsAt: Date.parse(w.resets_at) || 0, main: true };
}

function planName(plan) {
  const words = plan
    .replace(/^claude[_ ]/i, "")
    .replace(/_/g, " ")
    .trim();
  return words ? `Claude ${words[0].toUpperCase()}${words.slice(1)}` : "Claude";
}
