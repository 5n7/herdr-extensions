# Herdr Extensions

Extensions for [Herdr](https://herdr.dev), packaged as a Nix flake:

- Herdr plugins, for the herdr TUI and server.
- Herdr app mods, for the desktop app.

| Package              | Kind                       | What it does                                                                                        |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `plugin-even-layout` | plugin `herdr-even-layout` | Equalizes pane widths and heights after splits, moves and closes                                    |
| `mod-pick`           | mod `pick`                 | Hint-based picker over the focused terminal: copy a token, open a URL, or a Markdown file in Neovim |
| `mod-prefix`         | mod `prefix`               | A tmux-style Ctrl+F prefix with a cheat-sheet card; its y and u open `pick`                         |
| `mod-usage`          | mod `usage`                | Claude Code's rate limits in a sidebar block, with when each resets                                 |

## Layout

```text
flake.nix                 packages.<system>.*, found from plugins/ and mods/
nix/                      buildPlugin, buildMod, buildBunExecutable
runtime/                  TypeScript shared by plugins: JSON-RPC, pane notes, coalescing, test doubles
plugins/<name>/           herdr-plugin.toml, src/, default.nix
mods/<name>/              main.js, mod.json, default.nix, and src/ for a helper program
mods/shared/              modules copied into every mod
```

## Using the packages

Every package builds to a folder that is installed as is.

- A plugin is a folder for `herdr plugin link`. `passthru.pluginId` is its id.
- A mod is a folder for `~/.config/herdr-app/mods/<passthru.modName>/`. Copy it in rather than symlinking it: the app refuses modules whose real path is outside the mod's folder. The app also writes `jsconfig.json` and `gpui-kit.d.ts` beside the mod.

`mod-prefix` takes its key table as an argument:

```nix
prefix = herdr-extensions.packages.${system}.mod-prefix.override {
  groups = [
    {
      name = "Tabs";
      rows = [ { keys = [ "c" ]; label = "New tab"; run = "tab.new"; } ];
    }
  ];
};
# prefix.keymap is the "mod:prefix" section for keys.json.
```

## Development

```sh
mise install
bun install --frozen-lockfile
bun run check   # format, lint, typecheck, test
nix flake check # build every package; each executable's build runs its tests and a smoke test
```

To try a plugin from a checkout, run `herdr plugin link "$(nix build --print-out-paths .#plugin-even-layout)"`.

To try a mod from a checkout, run `herdr-app check` on a copy of `nix build .#mod-<name>`.

## Adding one

A folder with a `default.nix` becomes a package; nothing else lists it.

- **A plugin:** `plugins/<name>/` with `herdr-plugin.toml` (its commands run `./plugin`), `src/main.ts`, and a `default.nix` of `{ buildPlugin }: buildPlugin ./.`.
- **A mod:** `mods/<name>/` with `main.js`, `mod.json`, and a `default.nix` of `{ buildMod }: buildMod { dir = ./.; }`. `files` adds built files, as `mod-pick` adds its picker.
