import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { manager } from "../background/manager.js";
import { registerBackgroundRunTool } from "./background-run.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION_ID = "background-run-test-session";

describe("background_run tool", () => {
  afterEach(() => {
    manager.clearSession(SESSION_ID);
  });

  it("returns immediately with a task id and an already-created output file, even for a long command", async () => {
    const tool = registerOne(registerBackgroundRunTool);
    const start = Date.now();
    const result = await call(tool, { command: 'node -e "setTimeout(() => {}, 5000)"', timeoutSeconds: 30 }, SESSION_ID);

    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.content[0]?.text).toContain("Started in background");
    const details = result.details as { id: string; status: string; outputPath: string };
    expect(details.status).toBe("running");
    expect(existsSync(details.outputPath)).toBe(true);
    expect(manager.get(details.id, SESSION_ID)?.status).toBe("running");
  });

  it("surfaces the required-timeoutSeconds guard instead of swallowing it into a running task", async () => {
    const tool = registerOne(registerBackgroundRunTool);
    await expect(call(tool, { command: "echo hi", timeoutSeconds: 0 }, SESSION_ID)).rejects.toThrow(/timeoutSeconds/);
    expect(manager.list(SESSION_ID)).toEqual([]);
  });
});
