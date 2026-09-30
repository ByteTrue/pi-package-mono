import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  globalSettingsFile,
  legacyProjectSettingsFile,
  legacySettingsFile,
  makeCommandCtx,
  makeCtx,
  makeModel,
  makeSettingsSandbox,
  writeLegacySettings,
  writeSettings,
} from "./test-helpers.js";
import { runVisionCommand } from "./vision-command.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

const VISION = [makeModel("vendor", "qwen-plus"), makeModel("vendor", "gemini-flash")];

function readSettings(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("runVisionCommand", () => {
  it("lists only vision-capable models and saves the choice", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const models = [...VISION, makeModel("vendor", "text-only", false)];
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models }), (o) => o[1]);

    await runVisionCommand(ctx);

    expect(ui.selectOptions).toEqual(["vendor/qwen-plus", "vendor/gemini-flash"]);
    expect(ui.selectTitle).toContain("not set yet");
    expect(readSettings(globalSettingsFile(agentDir))).toEqual({ model: "vendor/gemini-flash" });
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

    expect(readSettings(globalSettingsFile(agentDir))).toEqual({ model: "vendor/qwen-plus" });
  });

  it("leaves Pi's settings.json untouched and keeps the file permissions", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const piFile = legacySettingsFile(agentDir);
    const piContents = JSON.stringify({ defaultModel: "claude-opus-5", packages: ["npm:pi-subagents"] }, null, 2);
    writeFileSync(piFile, piContents);
    const own = globalSettingsFile(agentDir);
    writeSettings(own, {});
    chmodSync(own, 0o600);
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    expect(readFileSync(piFile, "utf8")).toBe(piContents);
    expect(readSettings(own)).toEqual({ model: "vendor/qwen-plus" });
    if (process.platform !== "win32") expect(statSync(own).mode & 0o777).toBe(0o600);
  });

  it("lifts an unmigrated section out of Pi's settings.json in one write", async () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/old", somethingElse: 42 }, { legacy: true });
    const piFile = legacySettingsFile(agentDir);
    const piContents = readFileSync(piFile, "utf8");
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[1]);

    await runVisionCommand(ctx);

    expect(readSettings(globalSettingsFile(agentDir))).toEqual({
      model: "vendor/gemini-flash",
      somethingElse: 42,
    });
    expect(readFileSync(piFile, "utf8")).toBe(piContents);
  });

  it("refuses to overwrite Pi's settings.json when it is not valid JSON", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const piFile = legacySettingsFile(agentDir);
    writeFileSync(piFile, '{ "defaultModel": "claude" ,,, ');
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx);

    expect(readFileSync(piFile, "utf8")).toBe('{ "defaultModel": "claude" ,,, ');
    expect(ui.notifications.at(-1)).toMatchObject({ type: "error" });
    expect(ui.notifications.at(-1)!.message).toContain("not valid JSON");
  });

  it("warns when a project settings file overrides what was just saved", async () => {
    const { cwd } = makeSettingsSandbox();
    writeLegacySettings(legacyProjectSettingsFile(cwd), { model: "vendor/gemini-flash" });
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
    expect(() => readSettings(globalSettingsFile(agentDir))).toThrow();
  });

  it("enables automatic attached-image analysis only after a model is configured", async () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx, "auto on");

    expect(ui.selectOptions).toBeUndefined();
    expect(readSettings(globalSettingsFile(agentDir))).toEqual({
      model: "vendor/qwen-plus",
      autoAnalyzeAttachments: true,
    });
    expect(ui.notifications.at(-1)?.message).toContain("enabled");

    await runVisionCommand(ctx, "auto off");

    expect(readSettings(globalSettingsFile(agentDir)).autoAnalyzeAttachments).toBe(false);
    expect(ui.notifications.at(-1)?.message).toContain("disabled");
  });

  it("keeps the configured model when only toggling automatic analysis", async () => {
    const { agentDir, cwd } = makeSettingsSandbox(
      { model: "vendor/qwen-plus", autoAnalyzeAttachments: true },
      { legacy: true },
    );
    const { ctx } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx, "auto off");

    expect(readSettings(globalSettingsFile(agentDir))).toEqual({
      model: "vendor/qwen-plus",
      autoAnalyzeAttachments: false,
    });
  });

  it("refuses to enable automatic analysis without a configured model", async () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    const { ctx, ui } = makeCommandCtx(makeCtx({ cwd, models: VISION }), (o) => o[0]);

    await runVisionCommand(ctx, "auto on");

    expect(() => readSettings(globalSettingsFile(agentDir))).toThrow();
    expect(ui.notifications.at(-1)).toMatchObject({ type: "error" });
    expect(ui.notifications.at(-1)?.message).toContain("No vision model configured");
  });
});
