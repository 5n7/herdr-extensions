import { notify } from "herdr";

export function notifyError(title, err) {
  notify({ title, body: err.message ?? String(err), level: "error" });
}
