import { describe, expect, test } from "bun:test";
import { ago, clock, compactUntil, hiddenAlert, longUntil, onLine, shown, tone } from "./limits.js";

const NOW = new Date(2026, 10, 21, 13, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("shown", () => {
  const account = (id, name, at = NOW) => ({
    id,
    provider: id.split(":")[0],
    name,
    source: id.split(":")[1],
    at,
    limits: [{ key: "5h", pct: 60, resetsAt: NOW + HOUR, main: true }],
  });

  test("orders accounts by provider, then by id", () => {
    const accounts = [
      account("claude:~/.claude-work", "Claude Max"),
      account("claude:~/.claude", "Claude Ultra"),
      account("codex:~/.codex", "Codex"),
    ];
    expect(shown(accounts, ["codex", "claude"], NOW).map((a) => a.id)).toEqual([
      "codex:~/.codex",
      "claude:~/.claude",
      "claude:~/.claude-work",
    ]);
  });

  test("leaves out accounts without limits or without a provider", () => {
    const empty = { ...account("claude:~/.claude", "Claude"), limits: [] };
    expect(shown([empty, account("grok:~/.grok", "Grok")], ["claude"], NOW)).toEqual([]);
  });

  test("tells two accounts with the same name apart by where they came from", () => {
    const accounts = [
      account("claude:~/.claude", "Claude Max"),
      account("claude:~/.claude-work", "Claude Max"),
    ];
    expect(shown(accounts, ["claude"], NOW).map((a) => a.title)).toEqual([
      "Claude Max · ~/.claude",
      "Claude Max · ~/.claude-work",
    ]);
  });

  test("shows a limit past its reset as empty", () => {
    const [a] = shown([account("claude:~/.claude", "Claude")], ["claude"], NOW + 2 * HOUR);
    expect(a.limits[0].pct).toBe(0);
  });

  test("marks an account read over 30 minutes ago as stale", () => {
    const accounts = [
      account("claude:~/.claude", "A", NOW - 30 * MINUTE),
      account("claude:~/.claude-b", "B", NOW - 31 * MINUTE),
    ];
    expect(shown(accounts, ["claude"], NOW).map((a) => a.stale)).toEqual([false, true]);
  });
});

describe("tone", () => {
  test("turns yellow from 50% and red from 80%", () => {
    expect([tone(49), tone(50), tone(79), tone(80)]).toEqual(["ansi2", "ansi3", "ansi3", "ansi1"]);
  });
});

describe("onLine", () => {
  test("keeps the main limits", () => {
    const limits = [
      { key: "5h", main: true },
      { key: "7d", main: true },
      { key: "weekly_scoped", main: false },
    ];
    expect(onLine(limits).map((l) => l.key)).toEqual(["5h", "7d"]);
  });

  test("takes every limit when none is main", () => {
    expect(onLine([{ key: "weekly_scoped", main: false }]).map((l) => l.key)).toEqual([
      "weekly_scoped",
    ]);
  });
});

describe("hiddenAlert", () => {
  test("flags a limit off the line from 80%", () => {
    expect(
      hiddenAlert([
        { main: true, pct: 10 },
        { main: false, pct: 80 },
      ]),
    ).toBe(true);
  });

  test("ignores the line's own limits", () => {
    expect(
      hiddenAlert([
        { main: true, pct: 90 },
        { main: false, pct: 79 },
      ]),
    ).toBe(false);
  });

  test("ignores a limit the line shows for want of main ones", () => {
    expect(hiddenAlert([{ main: false, pct: 90 }])).toBe(false);
  });
});

describe("compactUntil", () => {
  test("counts minutes under an hour", () => {
    expect(compactUntil(NOW + 45 * MINUTE, NOW)).toBe("45m");
  });

  test("counts hours and minutes under two days", () => {
    expect(compactUntil(NOW + 2 * HOUR + 30 * MINUTE, NOW)).toBe("2h30m");
    expect(compactUntil(NOW + 3 * HOUR, NOW)).toBe("3h");
  });

  test("counts days and hours from two days", () => {
    expect(compactUntil(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe("3d4h");
    expect(compactUntil(NOW + 6 * DAY, NOW)).toBe("6d");
  });

  test("says now once passed", () => {
    expect(compactUntil(NOW - MINUTE, NOW)).toBe("now");
  });
});

describe("longUntil", () => {
  test("spaces its parts", () => {
    expect(longUntil(NOW + 2 * HOUR + 30 * MINUTE, NOW)).toBe("2h 30m");
    expect(longUntil(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe("3d 4h");
  });
});

describe("clock", () => {
  test("shows the time alone today", () => {
    expect(clock(NOW + 2 * HOUR + 30 * MINUTE, NOW)).toBe("15:30");
  });

  test("adds the weekday on another day", () => {
    expect(clock(new Date(2026, 10, 24, 17, 0).getTime(), NOW)).toBe("Tue 17:00");
  });
});

describe("ago", () => {
  test("rounds to minutes, then hours", () => {
    expect(ago(NOW - 10_000, NOW)).toBe("just now");
    expect(ago(NOW - 3 * MINUTE, NOW)).toBe("3m ago");
    expect(ago(NOW - 2 * HOUR, NOW)).toBe("2h ago");
  });
});
