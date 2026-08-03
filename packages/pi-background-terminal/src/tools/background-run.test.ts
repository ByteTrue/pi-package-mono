import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { manager } from "../background/manager.js";
import { registerBackgroundRunTool } from "./background-run.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION_ID = "background-run-test-session";

describe("background_run tool", () => {
  afterEach(async () => {
    await manager.clearSession(SESSION_ID);
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

  it("allows an omitted timeout and still rejects an invalid explicit timeout", async () => {
    const tool = registerOne(registerBackgroundRunTool);
    const result = await call(tool, { command: 'node -e "setInterval(() => {}, 1000)"' }, SESSION_ID);
    const details = result.details as { id: string; status: string };
    expect(details.status).toBe("running");
    await expect(call(tool, { command: "echo hi", timeoutSeconds: 0 }, SESSION_ID)).rejects.toThrow(/timeoutSeconds/);
  });
});
