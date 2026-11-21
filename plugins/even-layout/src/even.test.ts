import { describe, expect, test } from "bun:test";
import { readPaneTab } from "../../../runtime/pane-tabs";
import type { HerdrRpc, JsonRpcResponse } from "../../../runtime/rpc";
import { paneTabsDeps, routedRpc } from "../../../runtime/testing";
import { createEvenInvocation, evenTab } from "./even";

const tree = {
  type: "split",
  direction: "right",
  ratio: 0.6,
  first: { type: "pane" },
  second: { type: "pane" },
};

describe("evenTab", () => {
  test("returns when the layout is gone", async () => {
    const { deps: d } = paneTabsDeps({
      rpc: scriptedRpc([() => ({ error: { code: "layout_not_found" } })]),
    });
    await evenTab(d, "tab");
  });

  test("seeds live panes on the first successful export", async () => {
    const { deps: d } = paneTabsDeps({
      rpc: scriptedRpc([
        () => ({ result: { layout: { root: tree } } }),
        () => ({ result: { type: "pane_list", panes: [{ pane_id: "p1", tab_id: "t1" }] } }),
        (method, params) => {
          expect(method).toBe("layout.set_split_ratio");
          expect(params).toEqual({ tab_id: "tab", path: [], ratio: 0.5 });
          return { result: { type: "layout_split_ratio_set" } };
        },
        () => ({ result: { layout: { root: { type: "pane" } } } }),
      ]),
    });
    await evenTab(d, "tab");
    expect(await readPaneTab(d, "p1")).toBe("t1");
  });
});

describe("createEvenInvocation", () => {
  test("equalizes a seeded invocation without listing panes", async () => {
    const methods: string[] = [];
    const { deps: d } = paneTabsDeps({
      rpc: scriptedRpc([
        (method) => {
          methods.push(method);
          return { result: { layout: { root: tree } } };
        },
        (method, params) => {
          methods.push(method);
          expect(params).toEqual({ tab_id: "tab", path: [], ratio: 0.5 });
          return { result: { type: "layout_split_ratio_set" } };
        },
        (method) => {
          methods.push(method);
          return { result: { layout: { root: { type: "pane" } } } };
        },
      ]),
    });

    await createEvenInvocation(d, true)("tab");

    expect(methods).toEqual(["layout.export", "layout.set_split_ratio", "layout.export"]);
  });

  test("seeds live panes once across concurrent tabs", async () => {
    let paneListCalls = 0;
    const { deps: d } = paneTabsDeps({
      rpc: routedRpc({
        "layout.export": () => ({ result: { layout: { root: { type: "pane" } } } }),
        "pane.list": () => {
          paneListCalls += 1;
          return { result: { type: "pane_list", panes: [] } };
        },
      }),
    });
    const run = createEvenInvocation(d);
    await Promise.all([run("first"), run("second")]);
    expect(paneListCalls).toBe(1);
  });

  test("shares a seed failure with current waiters and retries for a later tab", async () => {
    let paneListCalls = 0;
    let resolveFirstSeed: (response: JsonRpcResponse) => void = () => undefined;
    let markSeedStarted: () => void = () => undefined;
    const firstSeed = new Promise<JsonRpcResponse>((resolve) => {
      resolveFirstSeed = resolve;
    });
    const seedStarted = new Promise<void>((resolve) => {
      markSeedStarted = resolve;
    });
    const { deps: d } = paneTabsDeps({
      rpc: routedRpc({
        "layout.export": () => ({ result: { layout: { root: { type: "pane" } } } }),
        "pane.list": () => {
          paneListCalls += 1;
          if (paneListCalls === 1) {
            markSeedStarted();
            return firstSeed;
          }
          return { result: { type: "pane_list", panes: [] } };
        },
      }),
    });
    const run = createEvenInvocation(d);
    const first = run("first");
    const second = run("second");
    await seedStarted;
    await Promise.resolve();
    resolveFirstSeed({ error: { code: "temporary" } });

    const failures = await Promise.allSettled([first, second]);
    expect(failures[0]?.status).toBe("rejected");
    expect(failures[1]?.status).toBe("rejected");
    if (failures[0]?.status === "rejected" && failures[1]?.status === "rejected") {
      expect(failures[0].reason).toBe(failures[1].reason);
    }
    expect(paneListCalls).toBe(1);

    await run("later");
    expect(paneListCalls).toBe(2);
  });
});

function scriptedRpc(
  script: Array<(method: string, params: unknown) => JsonRpcResponse>,
): HerdrRpc {
  let i = 0;
  return {
    call(method, params) {
      const step = script[i];
      i += 1;
      if (!step) {
        return Promise.resolve({ error: { code: "unexpected" } });
      }
      return Promise.resolve(step(method, params));
    },
  };
}
