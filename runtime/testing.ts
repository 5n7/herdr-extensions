import { memoryFs } from "./memory-fs";
import type { PaneTabsDeps } from "./pane-tabs";
import type { HerdrRpc, JsonRpcResponse } from "./rpc";

export function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function routedRpc(
  handlers: Record<string, (params: unknown) => JsonRpcResponse | Promise<JsonRpcResponse>>,
): HerdrRpc {
  return {
    call(method, params) {
      const handler = handlers[method];
      if (!handler) {
        return Promise.resolve({ error: { code: "unknown_method" } });
      }
      return Promise.resolve(handler(params));
    },
  };
}

export function paneTabsDeps(partial?: Partial<PaneTabsDeps>): {
  deps: PaneTabsDeps;
  logs: string[];
} {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      fs: memoryFs(),
      rpc: routedRpc({}),
      stateDir: "/state",
      socketKey: "abc",
      log: (message) => logs.push(message),
      pid: 42,
      ...partial,
    },
  };
}
