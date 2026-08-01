import { afterEach, describe, expect, it, vi } from "vitest";
import { manager } from "../background/manager.js";
import { registerBackgroundStatusTool } from "./background-status.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION_ID = "background-status-test-session";

describe("background_status tool", () => {
  afterEach(() => {
    manager.clearSession(SESSION_ID);
  });

  it("without id, lists all background tasks", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), SESSION_ID, 30);

    const result = await call(registerOne(registerBackgroundStatusTool), {}, SESSION_ID);

    expect(result.content[0]?.text).toContain(started.id);
    expect(result.content[0]?.text).toContain("status: running");
  });

  it("without id and no tasks, says so plainly", async () => {
    const result = await call(registerOne(registerBackgroundStatusTool), {}, SESSION_ID);
    expect(result.content[0]?.text).toBe("No background tasks.");
  });

  it("with id, reports status, exit code, output path, line count, tail preview, and the read-tool hint", async () => {
    manager.init(() => {});
    const started = manager.start(
      'node -e "console.log(\'line-one\'); console.log(\'line-two\')"',
      process.cwd(),
      SESSION_ID,
      30,
    );
    await vi.waitFor(() => expect(manager.get(started.id, SESSION_ID)?.status).toBe("exited"), { timeout: 8000 });

    const text = (await call(registerOne(registerBackgroundStatusTool), { id: started.id }, SESSION_ID)).content[0]?.text ?? "";

    expect(text).toContain("status: exited");
    expect(text).toContain("exitCode: 0");
    expect(text).toContain(`Output file: ${started.outputPath}`);
    expect(text).toContain("Lines so far: 2");
    expect(text).toContain("line-one");
    expect(text).toContain("line-two");
    expect(text).toContain("Use the read tool");
  });

  it("throws for an unknown task id", async () => {
    await expect(call(registerOne(registerBackgroundStatusTool), { id: "bg_nope" }, SESSION_ID)).rejects.toThrow(
      /No background task found/,
    );
  });
});
