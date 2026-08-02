import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeCtx, makeModel, makeSettingsSandbox } from "./test-helpers.js";
import { readConfiguredModelRef, resolveVisionModel } from "./vision-model.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("readConfiguredModelRef", () => {
  it("reads the global settings section", () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });

    expect(readConfiguredModelRef(cwd)).toBe("vendor/qwen-plus");
  });

  it("lets project settings win over global", () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/global" });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-vision": { model: "vendor/project" } }),
    );

    expect(readConfiguredModelRef(cwd)).toBe("vendor/project");
  });

  it("returns undefined when nothing is configured", () => {
    const { cwd } = makeSettingsSandbox();

    expect(readConfiguredModelRef(cwd)).toBeUndefined();
  });

  it("survives malformed settings json instead of throwing", () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    writeFileSync(join(agentDir, "settings.json"), "{ not json");

    expect(readConfiguredModelRef(cwd)).toBeUndefined();
  });
});

describe("resolveVisionModel", () => {
  it("resolves the configured model with its auth", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
    const model = makeModel("vendor", "qwen-plus");

    const result = await resolveVisionModel(makeCtx({ cwd, models: [model] }));

    expect(result).toEqual({
      ok: true,
      model,
      auth: { apiKey: "test-key-123456", headers: undefined, env: undefined },
    });
  });

  it("keeps slashes inside the model id", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/minimaxai/minimax-m3" });
    const model = makeModel("vendor", "minimaxai/minimax-m3");

    const result = await resolveVisionModel(makeCtx({ cwd, models: [model] }));

    expect(result.ok).toBe(true);
  });

  it("never auto-picks a model, and lists the candidates instead", async () => {
    const { cwd } = makeSettingsSandbox();
    const expensive = makeModel("vendor", "opus-5");

    const result = await resolveVisionModel(makeCtx({ cwd, models: [expensive] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No vision model configured");
    expect(result.error).toContain('"vendor/opus-5"');
  });

  it("says so when no vision-capable model exists at all", async () => {
    const { cwd } = makeSettingsSandbox();

    const result = await resolveVisionModel(makeCtx({ cwd, models: [makeModel("vendor", "text-only", false)] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No vision-capable model is configured");
  });

  it("rejects a ref without a provider prefix", async () => {
    const { cwd } = makeSettingsSandbox({ model: "qwen-plus" });

    const result = await resolveVisionModel(makeCtx({ cwd, models: [makeModel("vendor", "qwen-plus")] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('must be "provider/model-id"');
  });

  it("rejects a ref that is not in models.json", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/gone" });

    const result = await resolveVisionModel(makeCtx({ cwd, models: [makeModel("vendor", "qwen-plus")] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not in models.json");
  });

  it("rejects a configured model that cannot accept images", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/text-only" });

    const result = await resolveVisionModel(
      makeCtx({ cwd, models: [makeModel("vendor", "text-only", false)] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not accept image input");
  });

  it("does not echo the registry auth error, which can quote configuration", async () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });

    const result = await resolveVisionModel(
      makeCtx({
        cwd,
        models: [makeModel("vendor", "qwen-plus")],
        auth: { ok: false, error: "apiKey $SECRET_TOKEN resolved to empty" },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("SECRET_TOKEN");
    expect(result.error).toContain('provider "vendor"');
  });
});
