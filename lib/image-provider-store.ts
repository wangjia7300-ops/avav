"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isImageProviderConfigComplete,
  normalizeImageProviderConfig,
  parseImageProviderConfig
} from "@/lib/image-providers";
import type { ImageProviderConfig } from "@/lib/types";

type ImageProviderStoreState = {
  config: ImageProviderConfig | null;
  isConfigured: boolean;
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

      setConfig: (config) => {
        const normalized = normalizeImageProviderConfig(config);
        set({
          config: normalized,
          isConfigured: isImageProviderConfigComplete(normalized)
        });
      },

      resetConfig: () => {
        set({ config: null, isConfigured: false });
      },

      getActiveConfig: () => {
        const { config, isConfigured } = get();
        return isConfigured && config ? config : null;
      }
    }),
    {
      name: "image-provider-config",
      version: 1,
      partialize: (state) => ({
        config: state.config
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { config?: unknown };
        const config = parseImageProviderConfig(persisted.config);
        const isConfigured = Boolean(config && isImageProviderConfigComplete(config));

        return {
          ...currentState,
          config: isConfigured ? config : null,
          isConfigured
        };
      }
    }
  )
);
