// The app answers a mod's calls, hc's included, only while one of its views
// lives, so the prefix, which closes on its key, can't do this itself. This is
// a window with nothing in it, open until the picker shows.

import { View, div } from "gpui-kit";
import { appHome, closeOverlay, focused, hc, props, run, terminals } from "herdr";
import { hcOk } from "./hc.js";
import { notifyError } from "./notify.js";

const PICKER = "mods/pick/pick";
const LISTING_POLL_MS = 20;
const LISTING_TIMEOUT_MS = 3000;

export default class Pick extends View {
  init(_props, cx) {
    const mode = props()?.mode === "open" ? "open" : "copy";
    cx.spawn(async (cx) => {
      try {
        await showPicker(mode, cx);
      } catch (err) {
        const title = mode === "open" ? "Couldn't open" : "Couldn't copy";
        notifyError(title, err);
      }
      const overlay = props()?.overlay;
      if (overlay) closeOverlay(overlay);
    });
  }

  render() {
    return div();
  }
}

async function showPicker(mode, cx) {
  const f = focused();
  // A layout terminal block has no pane to show the picker in.
  if (!f?.pane) return;
  const path = `${appHome()}/${PICKER}`;
  // Picking over a picker starts over on the screen beneath it. The old one
  // goes first, since its end would take the new one out of the pane.
  const over = terminals().some((x) => x.address === f.shown && x.argv?.[0] === path);
  if (over) {
    await hc(["kill", f.shown]);
    await until(cx, () => !listed(f.shown), `${f.shown} didn't end`);
  }
  const address = over ? f.terminal : (f.shown ?? f.terminal);
  if (!address) return;
  const { text } = JSON.parse(await hcOk(["read", "--json", address]));
  const cwd = localCwd(address);
  const { address: picker } = JSON.parse(
    await hcOk(["run", "--bg", "--json", "--no-parent", "--rm", "--", path, mode, text, cwd]),
  );
  // terminal.show takes a terminal only once the app has listed it, and before
  // that goes back to the pane's own.
  try {
    await until(cx, () => listed(picker), `${picker} never reached the window`);
  } catch (err) {
    await hc(["kill", picker]);
    throw err;
  }
  run("terminal.show", { terminal: picker, pane: f.pane });
}

async function until(cx, done, failure) {
  const deadline = Date.now() + LISTING_TIMEOUT_MS;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(failure);
    await cx.sleep(LISTING_POLL_MS);
  }
}

function listed(address) {
  return terminals().some((x) => x.address === address);
}

// Where the program on screen runs, for the picker to find the files it names.
// None for a terminal on another machine, whose address has a machine/ in it.
function localCwd(address) {
  if (address.includes("/")) return "";
  const t = terminals().find((x) => x.address === address);
  return t?.foreground?.cwd ?? t?.cwd ?? "";
}
