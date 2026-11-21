# Agent notes

The consumer is the owner's nix-darwin dotfiles, which take `packages.<system>.*` from this flake. Nothing here is installed by `herdr plugin install` or copied by hand.

## Setup

```sh
mise install
bun install --frozen-lockfile
```

## Before completion

- Run `bun run check`: oxfmt, oxlint, tsc (TypeScript 7) and `bun test`.
- Run `nix flake check`. It builds every package. Each compiled executable's build runs `bun test` on its sources, then a smoke test runs the executable once.
- For a mod, copy `nix build .#mod-<name>` to a scratch folder, make the copy writable, and run `herdr-app check` on it. Never call a mod done without a passing check.
- New files must be added to Git before Nix can see them.

## Code style

The same rules hold for TypeScript and for mods' JavaScript.

- Order a file top-down: imports, constants, types, then exports in the order a reader meets them, then the internal helpers they call. A helper used by one function goes right below it.
- Declare types with `type`, not `interface`.
- Declare top-level functions with `function`. Arrow functions are for callbacks and object members.
- Tests sit beside the module they cover. A test file has one `describe` per export it tests, named after the export. Test names say what happens, as in `test("recovers a lock whose owner is dead")`.
- Test doubles shared across plugins' and runtime's tests live in `runtime/testing.ts`. A mod's helper program builds from its own `src/` alone, so its shared test code stays there. A helper used by one test file stays in that file.

## Plugins

- `plugins/<name>/` holds `herdr-plugin.toml`, `src/main.ts` and a `default.nix` of `buildPlugin ./.`. `flake.nix` finds it and exposes `plugin-<name>`.
- Plugins talk to Herdr through `runtime/`.
- Keep layout math and event routing free of sockets and the filesystem, so tests stay deterministic.
- `herdr-plugin.toml` is the source of a plugin's id and version. Bump `version` there.

## Mods

- `mods/<name>/` holds `main.js`, `mod.json` and a `default.nix` built with `buildMod`. `flake.nix` finds it and exposes `mod-<name>`.
- Mods are plain JavaScript against the app's `gpui-kit`, `gpui-base` and `herdr` modules. Their types are in `~/.config/herdr-app/*.d.ts`, which the app rewrites on every start. Read them there, and read `~/.config/herdr-app/AGENTS.md`.
- Code more than one mod needs goes in `mods/shared/`. `buildMod` copies it into every mod, and a mod imports it as `./<file>`. Running a mod from a plain checkout therefore fails; build it.
- A mod's code refers to its installed name, as in `mods/pick/pick` and `mods/prefix/card.json`. That name is its folder's.
- Work a mod awaits, `hc` calls included, must run in a view that stays open. A task with `owner: null` outlives its view, but the app stops answering its calls.
- A helper program a mod runs lives in `mods/<name>/src/` and is compiled with `buildBunExecutable`.
