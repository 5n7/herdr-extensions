# `src` must hold at least one test: the build runs `bun test`, which fails when
# it finds none. The executable carries its own Bun, so whatever runs it (the
# herdr server under launchd, a mod's hidden terminal) needs no Bun on PATH. It
# needs Bun 1.4: macOS kills what 1.3's --compile writes, since its signature
# fails.
{
  bun,
  lib,
  stdenvNoCC,
}:
{
  pname,
  version,
  # Every file the entrypoint imports, laid out as in the checkout.
  src,
  # Relative to `src`.
  entrypoint,
  # Shell run against $exe, the installed executable. Running it at all is the
  # signature check.
  smoke,
}:
stdenvNoCC.mkDerivation {
  inherit pname version src;

  nativeBuildInputs = [ bun ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    bun build --compile --target=bun ${lib.escapeShellArg entrypoint} --outfile ${pname}
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    bun test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    install -Dm555 ${pname} $out/bin/${pname}
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    exe=$out/bin/${pname}
    ${smoke}
    runHook postInstallCheck
  '';

  meta.mainProgram = pname;
}
