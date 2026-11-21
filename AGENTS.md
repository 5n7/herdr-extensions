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
- New files must be added to Git before Nix can see them.

## Plugins

- `plugins/<name>/` holds `herdr-plugin.toml`, `src/main.ts` and a `default.nix` of `buildPlugin ./.`. `flake.nix` finds it and exposes `plugin-<name>`.
- Plugins talk to Herdr through `runtime/`.
- Keep layout math and event routing free of sockets and the filesystem, so tests stay deterministic.
- `herdr-plugin.toml` is the source of a plugin's id and version. Bump `version` there.
