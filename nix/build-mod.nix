# A mod's code finds itself under mods/<folder name>, so that is its modName.
# Every mod also gets mods/shared/*, to import as ./<file>.
{
  lib,
  runCommand,
}:
{
  # mods/<name>, holding main.js and mod.json.
  dir,
  # More files, by their path in the mod.
  files ? { },
  passthru ? { },
}:
let
  name = baseNameOf dir;

  shared = lib.mapAttrs (file: _: ../mods/shared + "/${file}") (
    lib.filterAttrs (_: type: type == "regular") (builtins.readDir ../mods/shared)
  );

  own = {
    "main.js" = dir + "/main.js";
    "mod.json" = dir + "/mod.json";
  }
  // files;

  clashes = lib.intersectLists (lib.attrNames shared) (lib.attrNames own);

  contents =
    assert lib.assertMsg (
      clashes == [ ]
    ) "mod ${name}: ${lib.concatStringsSep ", " clashes} would replace mods/shared/";
    shared // own;
in
runCommand "herdr-app-mod-${name}"
  {
    passthru = passthru // {
      modName = name;
    };
  }
  ''
    mkdir $out
    ${lib.concatLines (
      lib.mapAttrsToList (path: source: "cp ${source} $out/${lib.escapeShellArg path}") contents
    )}
  ''
