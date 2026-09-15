import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDashboardStatus, startDashboard, stopDashboard } from "./dashboard.js";
import { setAgentBrowserCliOverride } from "./cli.js";
import type { ExecFn } from "./env.js";

beforeEach(() => {
  setAgentBrowserCliOverride({ command: "agent-browser" });
});

afterEach(() => {
  setAgentBrowserCliOverride(undefined);
});

describe("dashboard management", () => {
  it("reports running false when no server is listening on port", async () => {
    // 59123 is arbitrary unused port
    const status = await checkDashboardStatus(59123, 200);
    expect(status.running).toBe(false);
    expect(status.port).toBe(59123);
  });

  it("calls agent-browser dashboard start and stop commands", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "Dashboard started at http://localhost:59124", stderr: "", code: 0 };
    };

    const startRes = await startDashboard(exec, 59124);
    expect(startRes.ok).toBe(true);
    expect(calls[0]).toContain("dashboard");
    expect(calls[0]).toContain("start");

    const stopRes = await stopDashboard(exec);
    expect(stopRes.ok).toBe(true);
    expect(calls[1]).toContain("dashboard");
    expect(calls[1]).toContain("stop");
  });
});
