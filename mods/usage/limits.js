// What every provider hands the block. A provider (./claude.js) is
// `{ key, poll(previous, now) }`: `poll` turns its last accounts into the next
// ones, and a rejection keeps the last. An account is
//
//   { id, provider, icon, name, source, limits, at }
//
// `id` is unique across providers, `icon` the program whose icon it shows
// (knownAgents' key), `source` where it came from
// (the tooltip), `at` when its limits were read. A provider may keep its own
// fields on its accounts too. A limit is
//
//   { key, label, pct, resetsAt, main }
//
// `key` the line's short name ("5h"), `label` the full one ("5-hour"),
// `resetsAt` a time in ms or 0, and `main` whether the line shows it.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALERT_PCT = 80;
const WARN_PCT = 50;
const STALE_MS = 30 * 60_000;

// A limit past its reset time has started over, whatever it last read.
export function shown(accounts, order, now) {
  const sorted = accounts
    .filter((a) => a.limits?.length && order.includes(a.provider))
    .sort(
      (a, b) => order.indexOf(a.provider) - order.indexOf(b.provider) || a.id.localeCompare(b.id),
    );
  return sorted.map((a) => ({
    ...a,
    title: sorted.some((o) => o !== a && o.name === a.name) ? `${a.name} · ${a.source}` : a.name,
    stale: now - a.at > STALE_MS,
    limits: a.limits.map((l) => (l.resetsAt && l.resetsAt <= now ? { ...l, pct: 0 } : l)),
  }));
}

export function tone(pct) {
  return pct >= ALERT_PCT ? "ansi1" : pct >= WARN_PCT ? "ansi3" : "ansi2";
}

export function onLine(limits) {
  const main = limits.filter((l) => l.main);
  return main.length ? main : limits;
}

export function hiddenAlert(limits) {
  const shownOnLine = onLine(limits);
  return limits.some((l) => !shownOnLine.includes(l) && l.pct >= ALERT_PCT);
}

export function compactUntil(at, now) {
  return until(at, now, "");
}

export function longUntil(at, now) {
  return until(at, now, " ");
}

export function clock(at, now) {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString()
    ? time
    : `${WEEKDAYS[d.getDay()]} ${time}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function ago(at, now) {
  const m = Math.round((now - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function until(at, now, gap) {
  const m = Math.ceil((at - now) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h${gap}${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d${gap}${h % 24}h` : `${Math.floor(h / 24)}d`;
}
