import { homedir } from "node:os";
import { dirname } from "node:path";
import { draw, ENTER, LEAVE } from "./draw";
import { existingFile, searchFolders } from "./files";
import { layOut, type Screen } from "./layout";
import { type Phase, press, typing } from "./phase";
import { findOpenable, findTokens, isWebUrl, type Token } from "./tokens";

const PICKED_MS = 150;
const NOTE_MS = 1200;
const FAILED_MS = 4000;
// A picker the window never showed, or whose pane went away, gets no keys.
const IDLE_MS = 60_000;

const OPENER = process.platform === "darwin" ? "/usr/bin/open" : "xdg-open";
// Neovim, read-only, shows a Markdown file in a terminal on the right; the
// files it shows.
const VIEWER = ["nvim", "-R"];
const VIEWABLE = /\.(?:md|markdown)$/i;

const MODES: Record<string, (cwd: string) => Mode> = {
  copy: () => ({
    find: findTokens,
    nothing: "nothing to copy on screen",
    take: async (text) => {
      process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
    },
  }),
  open: openMode,
};

type Mode = {
  find: (lines: readonly string[]) => Token[];
  nothing: string;
  take: (text: string) => Promise<void>;
};

class Picker {
  private readonly tokens: Token[];
  private screen!: Screen;
  private phase: Phase = typing();
  private note?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly mode: Mode,
    private readonly lines: string[],
  ) {
    this.tokens = mode.find(lines);
    this.fit();
  }

  start(): void {
    process.stdout.write(ENTER);
    const idle = setTimeout(() => this.quit(), IDLE_MS);
    // Shown in a pane, the picker takes the pane's size from herdr-core's.
    process.stdout.on("resize", () => {
      this.fit();
      // From when it shows, not from its start in the hidden terminal.
      clearTimeout(this.note);
      if (this.phase.kind === "empty") this.note = setTimeout(() => this.quit(), NOTE_MS);
      this.render();
    });
    process.stdin.setRawMode(true);
    process.stdin.on("data", (data: Buffer) => {
      idle.refresh();
      this.input(data.toString("utf8"));
    });
    this.render();
  }

  // The size decides which tokens are on screen, and so which get hints. Typing
  // starts over, and with none on screen there is nothing to pick.
  private fit(): void {
    this.screen = layOut(this.lines, this.tokens, process.stdout.columns, process.stdout.rows);
    if (this.phase.kind !== "typing" && this.phase.kind !== "empty") return;
    this.phase = this.screen.hints.size > 0 ? typing() : { kind: "empty", note: this.mode.nothing };
  }

  private render(): void {
    process.stdout.write(
      draw({ screen: this.screen, phase: this.phase, height: process.stdout.rows }),
    );
  }

  private input(keys: string): void {
    const next = press(this.screen.hints, this.phase, keys);
    if (next === "quit") return this.quit();
    this.phase = next;
    if (next.kind === "picked") return void this.pick(next.text);
    this.render();
  }

  private async pick(text: string): Promise<void> {
    process.stdin.removeAllListeners("data");
    this.render();
    try {
      await this.mode.take(text);
      await Bun.sleep(PICKED_MS);
    } catch (err) {
      this.phase = { kind: "failed", note: oneLine(err) };
      this.render();
      // Keys held from the pick don't take the note away before it's read.
      const key = Bun.sleep(NOTE_MS).then(
        () => new Promise((done) => process.stdin.once("data", done)),
      );
      await Promise.race([Bun.sleep(FAILED_MS), key]);
    }
    this.quit();
  }

  private quit(): void {
    process.stdin.removeAllListeners("data");
    process.stdout.write(LEAVE, () => process.exit(0));
  }
}

const [name, screen, cwd] = process.argv.slice(2);
if (
  name === undefined ||
  !Object.hasOwn(MODES, name) ||
  screen === undefined ||
  !process.stdin.isTTY
) {
  console.error("usage: pick copy|open <screen> [<cwd>], on a terminal");
  process.exit(64);
}
new Picker(MODES[name](cwd ?? ""), screen.split("\n")).start();

// URLs go to the browser, and files to the viewer, in a terminal to the right
// of the pane the picker shows in. Files are looked up from the working
// directory of the program on screen, "" when that runs on another machine,
// and from its repository's root, where git prints paths from.
function openMode(cwd: string): Mode {
  const home = homedir();
  let folders: string[] | undefined;
  const files = new Map<string, string | null>();
  const viewable = (text: string) => {
    if (!cwd) return null;
    if (!files.has(text)) {
      folders ??= searchFolders(cwd);
      const file = existingFile(text, folders, home);
      files.set(text, file !== null && VIEWABLE.test(file) ? file : null);
    }
    return files.get(text) ?? null;
  };
  return {
    find: (lines) =>
      findOpenable(lines).filter((t) => isWebUrl(t.text) || viewable(t.text) !== null),
    nothing: "nothing to open on screen",
    take: (text) => {
      const file = files.get(text);
      if (!file) return openUrl(text);
      return herdrApp([
        "do",
        "terminal.open",
        JSON.stringify({ argv: [...VIEWER, file], folder: dirname(file), place: "right" }),
      ]);
    },
  };
}

// The output stays unread: a browser the opener starts can hold its pipes open.
async function openUrl(url: string): Promise<void> {
  const code = await Bun.spawn([OPENER, url], { stdio: ["ignore", "ignore", "ignore"] }).exited;
  if (code !== 0) throw new Error(`${OPENER} exited with ${code}`);
}

// herdr-app reports a failure on stdout, as {"error": "..."}. The app keeps
// its link in ~/.local/bin up to date.
async function herdrApp(args: string[]): Promise<void> {
  const cli = Bun.which("herdr-app") ?? `${homedir()}/.local/bin/herdr-app`;
  const child = Bun.spawn([cli, ...args], { stdio: ["ignore", "pipe", "ignore"] });
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (code !== 0) throw new Error(errorOf(stdout) ?? `herdr-app exited with ${code}`);
}

function errorOf(stdout: string): string | null {
  try {
    return JSON.parse(stdout).error || null;
  } catch {
    return null;
  }
}

// For the picker's bottom row, where a line break or a control character
// would move the cursor.
function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // oxlint-disable-next-line no-control-regex
  return message.split("\n")[0]!.replace(/[\x00-\x1f\x7f]/g, "");
}
