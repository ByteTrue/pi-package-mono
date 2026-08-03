import { afterEach, describe, expect, it, vi } from "vitest";
import { manager } from "../background/manager.js";
import { registerBackgroundKillTool } from "./background-kill.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION_ID = "background-kill-test-session";
const OTHER_SESSION = "background-kill-other-session";

describe("background_kill tool", () => {
  afterEach(async () => {
    await manager.clearSession(SESSION_ID);
    await manager.clearSession(OTHER_SESSION);
  });

  it("stops a running background task", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), SESSION_ID, 30);

    const result = await call(registerOne(registerBackgroundKillTool), { id: started.id }, SESSION_ID);

    expect(result.content[0]?.text).toContain("Stopped");
    await vi.waitFor(() => expect(manager.get(started.id, SESSION_ID)?.status).toBe("killed"), { timeout: 8000 });
  });

  it("reports an already-finished task (including timed_out) without erroring", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), SESSION_ID, 1);
    await vi.waitFor(() => expect(manager.get(started.id, SESSION_ID)?.status).toBe("timed_out"), { timeout: 8000 });

    const result = await call(registerOne(registerBackgroundKillTool), { id: started.id }, SESSION_ID);

    expect(result.content[0]?.text).toContain("already timed_out");
  });

  it("cannot stop another session's task", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), OTHER_SESSION, 30);

    await expect(call(registerOne(registerBackgroundKillTool), { id: started.id }, SESSION_ID)).rejects.toThrow(
      /No background task found/,
    );
    expect(manager.get(started.id, OTHER_SESSION)?.status).toBe("running");
  });

  it("throws for an unknown task id", async () => {
    await expect(call(registerOne(registerBackgroundKillTool), { id: "bg_nope" }, SESSION_ID)).rejects.toThrow(
      /No background task found/,
    );
  });
});
