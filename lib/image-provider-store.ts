"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  isImageProviderConfigComplete,
  normalizeImageProviderConfig,
  parseImageProviderConfig
} from "@/lib/image-providers";
import type { ImageProviderConfig } from "@/lib/types";
import {
  createProviderMetadataStorage,
  toProviderMetadataConfig
} from "@/lib/provider-secret-storage";

type ImageProviderStoreState = {
  config: ImageProviderConfig | null;
  isConfigured: boolean;
  legacyKeyMigrated: boolean;
};

type ImageProviderStoreActions = {
  setConfig: (config: ImageProviderConfig) => void;
  resetConfig: () => void;
  getActiveConfig: () => ImageProviderConfig | null;
};

export const useImageProviderStore = create<
  ImageProviderStoreState & ImageProviderStoreActions
>()(
  persist(
    (set, get) => ({
      config: null,
      isConfigured: false,
      legacyKeyMigrated: false,

      setConfig: (config) => {
        const normalized = normalizeImageProviderConfig(config);
        set({
          config: normalized,
          isConfigured: isImageProviderConfigComplete(normalized),
          legacyKeyMigrated: false
        });
      },

      resetConfig: () => {
        set({ config: null, isConfigured: false, legacyKeyMigrated: false });
      },

      getActiveConfig: () => {
        const { config, isConfigured } = get();
        return isConfigured && config ? config : null;
      }
    }),
    {
      name: "image-provider-config",
      version: 2,
      storage: createJSONStorage(() =>
        createProviderMetadataStorage(window.localStorage)
      ),
      partialize: (state) => ({
        config: toProviderMetadataConfig(state.config)
      }),
      migrate: (persistedState) => persistedState,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as {
          config?: unknown;
          legacyKeyMigrated?: unknown;
        };
        const config = parseImageProviderConfig(persisted.config);
        const isConfigured = Boolean(config && isImageProviderConfigComplete(config));

        return {
          ...currentState,
          config,
          isConfigured,
          legacyKeyMigrated:
            persisted.legacyKeyMigrated === true &&
            Boolean(config?.apiKey.trim())
        };
      }
    }
  )
);
