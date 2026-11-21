{
  description = "Herdr plugins, built with Nix";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;

      forAllSystems = lib.genAttrs [ "aarch64-darwin" ];

      # Every plugins/<name> or mods/<name> with a default.nix, as
      # <kind>-<name>.
      discover =
        kind: callPackage: dir:
        lib.mapAttrs' (name: _: lib.nameValuePair "${kind}-${name}" (callPackage (dir + "/${name}") { })) (
          lib.filterAttrs (
            name: type: type == "directory" && builtins.pathExists (dir + "/${name}/default.nix")
          ) (builtins.readDir dir)
        );
    in
    {
      packages = forAllSystems (
        system:
        let
          scope = lib.makeScope nixpkgs.legacyPackages.${system}.newScope (self: {
            buildBunExecutable = self.callPackage ./nix/build-bun-executable.nix { };
            buildPlugin = self.callPackage ./nix/build-plugin.nix { };
          });
        in
        discover "plugin" scope.callPackage ./plugins
      );

      checks = self.packages;
    };
}
