import { hc } from "herdr";

// Runs hc and gives back its stdout, or throws with hc's own message.
export async function hcOk(args) {
  const result = await hc(args);
  if (result.code !== 0) throw new Error(hcError(result.stderr));
  return result.stdout;
}

// hc writes its errors as JSON when no terminal is attached to it.
function hcError(stderr) {
  try {
    return JSON.parse(stderr).error.message;
  } catch {
    return stderr.trim();
  }
}
