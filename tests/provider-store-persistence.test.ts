import { afterEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(name: string) {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string) {
    this.values.set(name, value);
  }

  removeItem(name: string) {
    this.values.delete(name);
  }
}

function persistedConfig(storage: MemoryStorage, name: string) {
  const serialized = storage.getItem(name);
  expect(serialized).not.toBeNull();
  return (
    JSON.parse(serialized!) as {
      state: { config: Record<string, unknown> | null };
    }
  ).state.config;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("provider stores keep secrets in page memory only", () => {
  it("migrates a legacy planning key, keeps it for this page, and removes it after reload", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "ai-provider-config",
      JSON.stringify({
        state: {
          config: {
            providerId: "volcengine",
            apiKey: "legacy-planning-secret",
            baseURL: "https://ark.cn-beijing.volces.com/api/v3",
            model: "ep-planning"
          },
          isConfigured: true
        },
        version: 0
      })
    );
    vi.stubGlobal("window", { localStorage: storage });

    const { useProviderStore } = await import("@/lib/provider-store");
    let state = useProviderStore.getState();

    expect(state.config?.apiKey).toBe("legacy-planning-secret");
    expect(state.isConfigured).toBe(true);
    expect(state.legacyKeyMigrated).toBe(true);
    expect(persistedConfig(storage, "ai-provider-config")).toMatchObject({
      providerId: "volcengine",
      model: "ep-planning",
      apiKey: ""
    });

    useProviderStore.getState().setConfig({
      providerId: "volcengine",
      apiKey: "new-session-secret",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      model: "ep-planning-v2"
    });
    expect(persistedConfig(storage, "ai-provider-config")).toMatchObject({
      model: "ep-planning-v2",
      apiKey: ""
    });

    vi.resetModules();
    const reloaded = await import("@/lib/provider-store");
    state = reloaded.useProviderStore.getState();

    expect(state.config).toMatchObject({
      providerId: "volcengine",
      model: "ep-planning-v2",
      apiKey: ""
    });
    expect(state.isConfigured).toBe(false);
    expect(state.legacyKeyMigrated).toBe(false);
  });

  it("persists image-provider metadata independently without its session key", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    const { useImageProviderStore } = await import("@/lib/image-provider-store");
    useImageProviderStore.getState().setConfig({
      scope: "image_generation",
      providerId: "openai",
      apiKey: "image-session-secret",
      baseURL: "https://api.openai.com/v1",
      imageModel: "gpt-image-2"
    });

    expect(useImageProviderStore.getState().getActiveConfig()?.apiKey).toBe(
      "image-session-secret"
    );
    expect(persistedConfig(storage, "image-provider-config")).toEqual({
      scope: "image_generation",
      providerId: "openai",
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      imageModel: "gpt-image-2"
    });

    vi.resetModules();
    const reloaded = await import("@/lib/image-provider-store");
    const state = reloaded.useImageProviderStore.getState();

    expect(state.config?.imageModel).toBe("gpt-image-2");
    expect(state.config?.apiKey).toBe("");
    expect(state.isConfigured).toBe(false);
    expect(state.getActiveConfig()).toBeNull();
  });
});
