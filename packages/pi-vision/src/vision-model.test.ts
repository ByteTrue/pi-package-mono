import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  globalSettingsFile,
  legacyProjectSettingsFile,
  legacySettingsFile,
  makeCtx,
  makeModel,
  makeSettingsSandbox,
  projectSettingsFile,
  writeLegacySettings,
  writeSettings,
} from "./test-helpers.js";
import {
  describeGlobalSettingsPath,
  readAutoAnalyzeAttachments,
  readConfiguredModelRef,
  resolveVisionModel,
} from "./vision-model.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("vision settings readers", () => {
  it("reads the global settings section", () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/qwen-plus");
  });

  it("reads an unmigrated section out of Pi's settings.json", () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/legacy" }, { legacy: true });

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/legacy");
    // Reading it lifted the section into the package's own file, one write, no clobber.
    expect(JSON.parse(readFileSync(globalSettingsFile(agentDir), "utf8"))).toEqual({
      model: "vendor/legacy",
    });
  });

  it("lets trusted project settings win over global", () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/global" });
    writeLegacySettings(legacyProjectSettingsFile(cwd), { model: "vendor/project" });

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/project");
    expect(readConfiguredModelRef(cwd, false)).toBe("vendor/global");
  });

  it("reads the package's own project file without migrating it", () => {
    const { cwd } = makeSettingsSandbox({ model: "vendor/global" });
    writeSettings(projectSettingsFile(cwd), { model: "vendor/project" });

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/project");
    expect(readConfiguredModelRef(cwd, false)).toBe("vendor/global");
  });

  it("prefers a changed own global file over the legacy section", () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/legacy" }, { legacy: true });
    writeSettings(globalSettingsFile(agentDir), { model: "vendor/own" });

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/own");
  });

  it("returns undefined when nothing is configured", () => {
    const { cwd } = makeSettingsSandbox();

    expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
  });

  it("survives malformed settings json instead of throwing", () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    writeFileSync(legacySettingsFile(agentDir), "{ not json");

    expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
  });

  it("layers the automatic-analysis opt-in through trusted project settings", () => {
    const { cwd } = makeSettingsSandbox({ autoAnalyzeAttachments: true });
    writeLegacySettings(legacyProjectSettingsFile(cwd), { autoAnalyzeAttachments: false });

    expect(readAutoAnalyzeAttachments(cwd, true)).toBe(false);
    expect(readAutoAnalyzeAttachments(cwd, false)).toBe(true);
  });

  it("fails closed on invalid higher-priority values", () => {
    const { cwd } = makeSettingsSandbox({
      model: "vendor/global",
      autoAnalyzeAttachments: true,
    });
    writeLegacySettings(legacyProjectSettingsFile(cwd), {
      model: null,
      autoAnalyzeAttachments: "yes",
    });

    expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
    expect(readAutoAnalyzeAttachments(cwd, true)).toBe(false);
  });

  it.each(["{ not json", "[]", "42"])(
    "fails closed when trusted project settings are invalid: %s",
    (contents) => {
      const { cwd } = makeSettingsSandbox({
        model: "vendor/global",
        autoAnalyzeAttachments: true,
      });
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(legacyProjectSettingsFile(cwd), contents);

      expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
      expect(readAutoAnalyzeAttachments(cwd, true)).toBe(false);
    },
  );

  it.each(["{ not json", "[]", "42"])(
    "fails closed when the package's own project file is invalid: %s",
    (contents) => {
      const { cwd } = makeSettingsSandbox({
        model: "vendor/global",
        autoAnalyzeAttachments: true,
      });
      mkdirSync(join(cwd, ".pi", "pi-pkg-cfg", "pi-vision"), { recursive: true });
      writeFileSync(projectSettingsFile(cwd), contents);

      expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
      expect(readAutoAnalyzeAttachments(cwd, true)).toBe(false);
    },
  );

  it("fails closed when trusted project settings cannot be read as a file", () => {
    const { cwd } = makeSettingsSandbox({
      model: "vendor/global",
      autoAnalyzeAttachments: true,
    });
    mkdirSync(join(cwd, ".pi", "settings.json"), { recursive: true });

    expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
    expect(readAutoAnalyzeAttachments(cwd, true)).toBe(false);
  });

  it("fails closed when an unreadable legacy global file exists", () => {
    const { agentDir, cwd } = makeSettingsSandbox();
    mkdirSync(legacySettingsFile(agentDir), { recursive: true });

    expect(readConfiguredModelRef(cwd, true)).toBeUndefined();
  });

  it("falls back to the legacy section when the package's own root cannot be created", () => {
    const { agentDir, cwd } = makeSettingsSandbox({ model: "vendor/legacy" }, { legacy: true });
    // A plain file where the package's config directory should go: mkdirSync fails,
    // so the migration write cannot land and the section stays live where it is.
    writeFileSync(join(agentDir, "pi-pkg-cfg"), "");

    expect(readConfiguredModelRef(cwd, true)).toBe("vendor/legacy");
    expect(describeGlobalSettingsPath()).toBe(
      `${legacySettingsFile(agentDir)} (legacy (read-only fallback))`,
    );
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

  it("resolves URL-style provider ids", async () => {
    const { cwd } = makeSettingsSandbox({ model: "llama-server=http://127.0.0.1:8080/qwen2-vl" });
    const model = makeModel("llama-server=http://127.0.0.1:8080", "qwen2-vl");

    const result = await resolveVisionModel(makeCtx({ cwd, models: [model] }));

    expect(result.ok).toBe(true);
  });

  it("resolves URL-style provider ids that include a path", async () => {
    const { cwd } = makeSettingsSandbox({ model: "srv=http://127.0.0.1:8080/v1/qwen2-vl" });
    const model = makeModel("srv=http://127.0.0.1:8080/v1", "qwen2-vl");

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
