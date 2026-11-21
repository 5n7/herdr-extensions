{
  buildBunExecutable,
  buildMod,
  lib,
}:
buildMod {
  dir = ./.;
  # main.js starts it in a hidden terminal as mods/pick/pick.
  files.pick = lib.getExe (buildBunExecutable {
    pname = "pick";
    version = "0.1.0";
    src = lib.fileset.toSource {
      root = ./src;
      fileset = ./src;
    };
    entrypoint = "main.ts";
    # Without a screen to pick from it prints its usage and exits 64.
    smoke = ''
      "$exe" || [ $? -eq 64 ]
    '';
  });
}
