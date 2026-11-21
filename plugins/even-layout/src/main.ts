import { coalesceTabWork } from "../../../runtime/coalesce";
import { createHost, createPluginLog, requiredEnv, runPlugin } from "../../../runtime/host";
import { pluginEventFromEnv, resolveTabs } from "../../../runtime/pane-tabs";
import { createEvenInvocation } from "./even";

const pluginLog = createPluginLog("herdr-even-layout");
const host = createHost({
  id: pluginLog.prefix,
  socketPath: requiredEnv("HERDR_SOCKET_PATH", pluginLog.log),
  stateDir: requiredEnv("HERDR_PLUGIN_STATE_DIR", pluginLog.log),
  log: pluginLog.log,
});
const event = pluginEventFromEnv(process.env);

await runPlugin(pluginLog, async () => {
  const { tabIds } = await resolveTabs(host.paneTabs, event);
  const runEvenTab = createEvenInvocation(host.paneTabs, event.event === "startup");
  const results = await Promise.allSettled(
    tabIds.map((tabId) => coalesceTabWork(host.coalesce, tabId, runEvenTab)),
  );
  let failed = false;
  for (const result of results) {
    if (result.status === "rejected") {
      pluginLog.logError(result.reason);
      failed = true;
    }
  }
  return failed ? 1 : 0;
});
