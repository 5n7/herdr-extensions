# herdr-extensions

Extensions for [Herdr](https://herdr.dev), packaged as a Nix flake. It holds Herdr plugins, for the herdr TUI and server.

| Package              | Kind                       | What it does                                                     |
| -------------------- | -------------------------- | ---------------------------------------------------------------- |
| `plugin-even-layout` | plugin `herdr-even-layout` | Equalizes pane widths and heights after splits, moves and closes |

## Layout

```text
flake.nix                 packages.<system>.*, found from plugins/
nix/                      buildPlugin, buildBunExecutable
runtime/                  TypeScript shared by plugins: JSON-RPC, pane notes, coalescing
plugins/<name>/           herdr-plugin.toml, src/, default.nix
```

## Using the packages

Every package builds to a folder that is installed as is.

- A plugin is a folder for `herdr plugin link`. `passthru.pluginId` is its id.

## Development

```sh
mise install
bun install --frozen-lockfile
bun run check   # format, lint, typecheck, test
nix flake check # build every package; each executable's build runs its tests and a smoke test
```

To try a plugin from a checkout, run `herdr plugin link "$(nix build --print-out-paths .#plugin-even-layout)"`.

## Adding one

A folder with a `default.nix` becomes a package; nothing else lists it.

- **A plugin:** `plugins/<name>/` with `herdr-plugin.toml` (its commands run `./plugin`), `src/main.ts`, and a `default.nix` of `{ buildPlugin }: buildPlugin ./.`.
