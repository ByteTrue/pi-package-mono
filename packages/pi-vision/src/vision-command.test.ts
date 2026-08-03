import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { makeCommandCtx, makeCtx, makeModel, makeSettingsSandbox } from "./test-helpers.js";
import { runVisionCommand } from "./vision-command.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

const VISION = [makeModel("vendor", "qwen-plus"), makeModel("vendor", "gemini-flash")];

function readSettings(agentDir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
}

describe("runVisionCommand", () => {
  it("lists only vision-capable models and saves the choice", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const models = [...VISION, makeModel("vendor", "text-only", false)];
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models }), (o) => o[1]);

    await runVisionCommand(ctx);

    expect(ui.selectOptions).toEqual(["vendor/qwen-plus", "vendor/gemini-flash"]);
    expect(ui.selectTitle).toContain("not set yet");
    expect(readSettings(agentDir)["pi-vision"]).toEqual({ model: "vendor/gemini-flash" });
    expect(ui.notifications.at(-1)).toMatchObject({ type: "info" });
    expect(ui.notifications.at(-1)!.message).toContain("vendor/gemini-flash");
  });

  it("shows the current model in the title", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    expect(ui.selectTitle).toContain("currently vendor/qwen-plus");
  });

  it("writes nothing when the user cancels", async () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), () => undefined);

    await runVisionCommand(ctx);

    expect(readSettings(agentDir)["pi-vision"]).toEqual({ model: "vendor/qwen-plus" });
  });

  it("keeps every other setting and the file permissions", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const file = join(agentDir, "settings.json");
    writeFileSync(
      file,
      JSON.stringify({ defaultModel: "claude-opus-5", packages: ["npm:pi-subagents"] }, null, 2),
    );
    chmodSync(file, 0o600);
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    const after = readSettings(agentDir);
    expect(after.defaultModel).toBe("claude-opus-5");
    expect(after.packages).toEqual(["npm:pi-subagents"]);
    expect(after["pi-vision"]).toEqual({ model: "vendor/qwen-plus" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps unrelated keys inside its own section", async () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/old", somethingElse: 42 });
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[1]);

    await runVisionCommand(ctx);

    expect(readSettings(agentDir)["pi-vision"]).toEqual({
      model: "vendor/gemini-flash",
      somethingElse: 42,
    });
  });

  it("refuses to overwrite a settings file that is not valid JSON", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const file = join(agentDir, "settings.json");
    writeFileSync(file, '{ "defaultModel": "claude" ,,, ');
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    expect(readFileSync(file, "utf8")).toBe('{ "defaultModel": "claude" ,,, ');
    expect(ui.notifications.at(-1)).toMatchObject({ type: "error" });
    expect(ui.notifications.at(-1)!.message).toContain("not valid JSON");
  });

  it("warns when a project settings file overrides what was just saved", async () => {
    const { cwd } = makeSettingsSandbox();
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-vision": { model: "vendor/gemini-flash" } }),
    );
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    expect(ui.notifications.at(-1)).toMatchObject({ type: "warning" });
    expect(ui.notifications.at(-1)!.message).toContain("still overrides it");
  });

  it("says so when there is no vision-capable model at all", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const { ctx, ui } = makeCommandCtx(
      makeCtx({ cwd, models: [makeModel("vendor", "text-only", false)] }),
      (o) => o[0],
    );

    await runVisionCommand(ctx);

    expect(ui.selectOptions).toBeUndefined();
    expect(ui.notifications.at(-1)).toMatchObject({ type: "error" });
    expect(() => readSettings(agentDir)).toThrow();
  });

  it("enables automatic attached-image analysis only after a model is configured", async () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx, "auto on");

    expect(ui.selectOptions).toBeUndefined();
    expect(readSettings(agentDir)["pi-vision"]).toEqual({
      model: "vendor/qwen-plus",
      autoAnalyzeAttachments: true,
    });
    expect(ui.notifications.at(-1)?.message).toContain("enabled");

    await runVisionCommand(ctx, "auto off");

    expect(readSettings(agentDir)["pi-vision"].autoAnalyzeAttachments).toBe(false);
    expect(ui.notifications.at(-1)?.message).toContain("disabled");
  });

  it("refuses to enable automatic analysis without a configured model", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx, "auto on");

    expect(() => readSettings(agentDir)).toThrow();
    expect(ui.notifications.at(-1)).toMatchObject({ type: "error" });
    expect(ui.notifications.at(-1)?.message).toContain("No vision model configured");
  });
});
