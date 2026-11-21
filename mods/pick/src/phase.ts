const ESC = "\x1b";
const CTRL_C = "\x03";
const BACKSPACE = new Set(["\x7f", "\b"]);
// CSI and SS3 sequences: arrows, function keys and the like.
// oxlint-disable-next-line no-control-regex
const SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|O.)/g;

export type Phase =
  | { kind: "typing"; typed: string }
  | { kind: "picked"; text: string }
  | { kind: "empty"; note: string }
  | { kind: "failed"; note: string };

export function typing(typed = ""): Phase {
  return { kind: "typing", typed };
}

export function press(
  hints: ReadonlyMap<string, string>,
  phase: Phase,
  keys: string,
): Phase | "quit" {
  const typed = keys.replace(SEQUENCE, "");
  if (typed.includes(ESC) || typed.includes(CTRL_C) || phase.kind === "empty") return "quit";
  if (typed === "") return phase;
  let next: Phase = phase;
  for (const key of typed) {
    if (next.kind !== "typing") break;
    next = type(hints, next.typed, key);
  }
  return next;
}

function type(hints: ReadonlyMap<string, string>, typed: string, key: string): Phase {
  if (BACKSPACE.has(key)) return typing(typed.slice(0, -1));
  if (!/^[a-z]$/i.test(key)) return typing(typed);
  const next = typed + key.toLowerCase();
  for (const [text, hint] of hints) if (hint === next) return { kind: "picked", text };
  const started = [...hints.values()].some((hint) => hint.startsWith(next));
  return typing(started ? next : "");
}
