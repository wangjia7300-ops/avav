"use client";

import { create } from "zustand";
import type { SearchProviderConfig, SearchProviderId } from "@/lib/types";

type SearchProviderStoreState = {
  config: SearchProviderConfig | null;
  isConfigured: boolean;
};

type SearchProviderStoreActions = {
  selectProvider: (providerId: SearchProviderId) => void;
  setApiKey: (apiKey: string) => void;
  resetConfig: () => void;
  getActiveConfig: () => SearchProviderConfig | null;
};

function createDefaultConfig(providerId: SearchProviderId): SearchProviderConfig {
  return {
    providerId,
    apiKey: ""
  };
}

export const useSearchProviderStore = create<SearchProviderStoreState & SearchProviderStoreActions>()(
    (set, get) => ({
      config: null,
      isConfigured: false,
      selectProvider: (providerId) => {
        const existing = get().config;
        if (existing?.providerId === providerId) return;

        set({
          config: createDefaultConfig(providerId),
          isConfigured: false
        });
      },
      setApiKey: (apiKey) => {
        const config = get().config ?? createDefaultConfig("serpapi");
        set({
          config: { ...config, apiKey },
          isConfigured: Boolean(apiKey)
        });
      },
      resetConfig: () => {
        set({ config: null, isConfigured: false });
      },
      getActiveConfig: () => {
        const { config, isConfigured } = get();
        return isConfigured && config ? config : null;
      }
    })
);
