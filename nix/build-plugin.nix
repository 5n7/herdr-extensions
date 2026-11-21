# herdr-plugin.toml's commands run ./plugin, compiled here from src/main.ts.
{
  buildBunExecutable,
  lib,
  runCommand,
}:
# plugins/<name>, holding herdr-plugin.toml and src/.
dir:
let
  manifest = lib.importTOML (dir + "/herdr-plugin.toml");

  root = ../.;

  plugin = buildBunExecutable {
    pname = manifest.id;
    inherit (manifest) version;
    src = lib.fileset.toSource {
      inherit root;
      fileset = lib.fileset.unions [
        ../runtime
        (dir + "/src")
      ];
    };
    entrypoint = lib.path.removePrefix root (dir + "/src/main.ts");
    # Every plugin starts through runtime's requiredEnv, so outside herdr it
    # names the missing socket and exits 1.
    smoke = ''
      set +e
      env -i "$exe" 2>stderr
      status=$?
      set -e
      [ "$status" -eq 1 ]
      grep -F "HERDR_SOCKET_PATH is not set" stderr
    '';
  };
in
runCommand "${manifest.id}-plugin-${manifest.version}" { passthru.pluginId = manifest.id; } ''
  mkdir $out
  cp ${dir + "/herdr-plugin.toml"} $out/herdr-plugin.toml
  cp ${lib.getExe plugin} $out/plugin
''
