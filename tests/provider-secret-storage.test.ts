import { describe, expect, it } from "vitest";
import {
  createProviderMetadataStorage,
  prepareProviderStoragePayload,
  toProviderMetadataConfig
} from "@/lib/provider-secret-storage";

class MemoryStorage {
  private values = new Map<string, string>();
  failWrites = false;

  getItem(name: string) {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string) {
    if (this.failWrites) throw new Error("storage unavailable");
    this.values.set(name, value);
  }

  removeItem(name: string) {
    this.values.delete(name);
  }
}

function parseState(serialized: string | null) {
  expect(serialized).not.toBeNull();
  return (JSON.parse(serialized!) as { state: Record<string, unknown> }).state;
}

describe("provider metadata persistence", () => {
  it("writes AI provider metadata without persisting its API key", () => {
    const backing = new MemoryStorage();
    const storage = createProviderMetadataStorage(backing);

    storage.setItem(
      "ai-provider-config",
      JSON.stringify({
        state: {
          config: {
            providerId: "volcengine",
            apiKey: "ark-private-secret",
            baseURL: "https://ark.cn-beijing.volces.com/api/v3",
            model: "ep-model"
          },
          isConfigured: true
        },
        version: 2
      })
    );

    const persisted = parseState(backing.getItem("ai-provider-config"));
    expect(persisted).toEqual({
      config: {
        providerId: "volcengine",
        apiKey: "",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        model: "ep-model"
      }
    });
    expect(JSON.stringify(persisted)).not.toContain("ark-private-secret");
  });

  it("scrubs a legacy AI key before making it available for the current page", () => {
    const backing = new MemoryStorage();
    const storage = createProviderMetadataStorage(backing);
    backing.setItem(
      "ai-provider-config",
      JSON.stringify({
        state: {
          config: {
            providerId: "volcengine",
            apiKey: "legacy-ark-secret",
            baseURL: "https://ark.cn-beijing.volces.com/api/v3",
            model: "ep-legacy"
          },
          isConfigured: true
        },
        version: 0
      })
    );

    const hydrated = parseState(storage.getItem("ai-provider-config"));
    const persisted = parseState(backing.getItem("ai-provider-config"));

    expect((hydrated.config as { apiKey: string }).apiKey).toBe("legacy-ark-secret");
    expect(hydrated.legacyKeyMigrated).toBe(true);
    expect((persisted.config as { apiKey: string }).apiKey).toBe("");
    expect(persisted).not.toHaveProperty("isConfigured");
    expect(JSON.stringify(persisted)).not.toContain("legacy-ark-secret");
  });

  it("fails closed when a legacy key cannot be scrubbed from storage", () => {
    const backing = new MemoryStorage();
    backing.setItem(
      "image-provider-config",
      JSON.stringify({
        state: {
          config: {
            scope: "image_generation",
            providerId: "openai",
            apiKey: "legacy-image-secret",
            baseURL: "https://api.openai.com/v1",
            imageModel: "gpt-image-2"
          }
        },
        version: 1
      })
    );
    backing.failWrites = true;

    const hydrated = parseState(
      createProviderMetadataStorage(backing).getItem("image-provider-config")
    );

    expect((hydrated.config as { apiKey: string }).apiKey).toBe("");
    expect(hydrated.legacyKeyMigrated).toBe(false);
    expect(hydrated.config).toMatchObject({
      providerId: "openai",
      baseURL: "https://api.openai.com/v1",
      imageModel: "gpt-image-2"
    });
  });

  it("keeps planning and image provider records independent", () => {
    const backing = new MemoryStorage();
    const storage = createProviderMetadataStorage(backing);

    storage.setItem(
      "ai-provider-config",
      JSON.stringify({
        state: {
          config: {
            providerId: "volcengine",
            apiKey: "planning-secret",
            baseURL: "https://ark.example/v3",
            model: "planning-model"
          }
        },
        version: 2
      })
    );
    storage.setItem(
      "image-provider-config",
      JSON.stringify({
        state: {
          config: {
            scope: "image_generation",
            providerId: "openai",
            apiKey: "image-secret",
            baseURL: "https://images.example/v1",
            imageModel: "image-model"
          }
        },
        version: 2
      })
    );

    const planning = parseState(backing.getItem("ai-provider-config"));
    const image = parseState(backing.getItem("image-provider-config"));

    expect(planning.config).toMatchObject({
      providerId: "volcengine",
      model: "planning-model",
      apiKey: ""
    });
    expect(image.config).toMatchObject({
      providerId: "openai",
      imageModel: "image-model",
      apiKey: ""
    });
  });

  it("creates an immutable metadata copy for Zustand partialize", () => {
    const source = {
      providerId: "custom",
      apiKey: "session-secret",
      baseURL: "https://provider.example/v1",
      model: "vision-model"
    };

    const metadata = toProviderMetadataConfig(source);

    expect(metadata).toEqual({ ...source, apiKey: "" });
    expect(source.apiKey).toBe("session-secret");
  });

  it("rejects invalid serialized provider data", () => {
    expect(prepareProviderStoragePayload("{not-json")).toBeNull();
  });

  it("removes an unknown provider schema instead of persisting unreviewed secrets", () => {
    const backing = new MemoryStorage();
    const storage = createProviderMetadataStorage(backing);
    backing.setItem(
      "ai-provider-config",
      JSON.stringify({
        state: {
          apiKey: "secret-in-an-unknown-schema"
        },
        version: 999
      })
    );

    expect(storage.getItem("ai-provider-config")).toBeNull();
    expect(backing.getItem("ai-provider-config")).toBeNull();

    storage.setItem(
      "ai-provider-config",
      JSON.stringify({ apiKey: "another-secret" })
    );
    expect(backing.getItem("ai-provider-config")).toBeNull();
  });
});
