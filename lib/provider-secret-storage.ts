/**
 * Provider API keys are session-only secrets.
 *
 * Zustand still persists non-sensitive provider metadata so users do not need
 * to re-select the provider, endpoint and model after every refresh. This
 * storage wrapper is a defence-in-depth boundary: even if a future partialize
 * callback accidentally includes apiKey, the serialized value written to
 * localStorage is scrubbed here.
 *
 * Legacy records are handled once on read:
 * 1. write a metadata-only replacement back to the same storage key;
 * 2. only after that write succeeds, return the old key to Zustand for the
 *    current page lifetime;
 * 3. mark the in-memory state so the UI can explain the migration.
 *
 * No secret is copied to sessionStorage, cookies or IndexedDB.
 */

type StringStorage = {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
};

type JsonRecord = Record<string, unknown>;

type ProviderStoragePayload = {
  hydrationValue: string;
  persistedValue: string;
  hadLegacySecret: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseEnvelope(serialized: string) {
  try {
    const envelope = JSON.parse(serialized) as unknown;
    if (!isRecord(envelope) || !isRecord(envelope.state)) return null;
    return envelope;
  } catch {
    return null;
  }
}

/**
 * Produces separate values for disk and hydration.
 *
 * The disk value contains metadata only. The hydration value may contain a
 * legacy key for this page lifetime, but only when the caller has already
 * persisted the scrubbed replacement successfully.
 */
export function prepareProviderStoragePayload(
  serialized: string
): ProviderStoragePayload | null {
  const envelope = parseEnvelope(serialized);
  if (!envelope) return null;

  const state = envelope.state as JsonRecord;
  const config = state.config;

  if (config !== null && !isRecord(config)) return null;

  const apiKey =
    isRecord(config) && typeof config.apiKey === "string" ? config.apiKey : "";
  const hadLegacySecret = Boolean(apiKey.trim());
  const metadataConfig = isRecord(config) ? { ...config, apiKey: "" } : null;

  const persistedValue = JSON.stringify({
    ...envelope,
    state: {
      config: metadataConfig
    }
  });

  const hydrationValue = JSON.stringify({
    ...envelope,
    state: {
      ...state,
      config: hadLegacySecret ? config : metadataConfig,
      legacyKeyMigrated: hadLegacySecret
    }
  });

  return {
    hydrationValue,
    persistedValue,
    hadLegacySecret
  };
}

/**
 * Creates the storage used by both provider stores.
 *
 * Passing the backing storage makes the migration independently testable
 * without requiring a DOM test environment.
 */
export function createProviderMetadataStorage(
  backingStorage: StringStorage
): StringStorage {
  return {
    getItem(name) {
      const serialized = backingStorage.getItem(name);
      if (!serialized) return serialized;

      const prepared = prepareProviderStoragePayload(serialized);
      if (!prepared) {
        // This wrapper is only used for provider records. An unknown schema
        // cannot be proven secret-free, so remove it instead of returning or
        // rewriting the raw value.
        try {
          backingStorage.removeItem(name);
        } catch {
          // Reading still fails closed even when the backing store is broken.
        }
        return null;
      }

      if (prepared.persistedValue !== serialized) {
        try {
          backingStorage.setItem(name, prepared.persistedValue);
        } catch {
          // Fail closed: do not hydrate a legacy key unless it was removed
          // from persistent storage successfully. Metadata remains readable.
          const persistedEnvelope = JSON.parse(
            prepared.persistedValue
          ) as JsonRecord & { state: JsonRecord };
          return JSON.stringify({
            ...persistedEnvelope,
            state: {
              ...persistedEnvelope.state,
              legacyKeyMigrated: false
            }
          });
        }
      }

      return prepared.hydrationValue;
    },

    setItem(name, value) {
      const prepared = prepareProviderStoragePayload(value);
      if (!prepared) {
        backingStorage.removeItem(name);
        return;
      }
      backingStorage.setItem(name, prepared.persistedValue);
    },

    removeItem(name) {
      backingStorage.removeItem(name);
    }
  };
}

export function toProviderMetadataConfig<T extends { apiKey: string }>(
  config: T | null
): T | null {
  return config ? { ...config, apiKey: "" } : null;
}
