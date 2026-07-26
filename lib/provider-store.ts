"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIProviderConfig, AIProviderId } from "@/lib/types";
import { PRESET_PROVIDERS } from "@/lib/ai-providers";
import type { ProviderPreset } from "@/lib/ai-providers";

// ── Store state ───────────────────────────────────────────────────

export type ProviderStoreState = {
  /** Currently selected provider config, null = use server env fallback */
  config: AIProviderConfig | null;
  /** Whether user has manually configured a provider */
  isConfigured: boolean;
};

type ProviderStoreActions = {
  /** Select a preset provider (clears apiKey, fills baseURL + default model) */
  selectPreset: (providerId: AIProviderId) => void;
  /** Set API key */
  setApiKey: (apiKey: string) => void;
  /** Set custom base URL */
  setBaseURL: (baseURL: string) => void;
  /** Set model name */
  setModel: (model: string) => void;
  /** Replace entire config */
  setConfig: (config: AIProviderConfig) => void;
  /** Reset to use server env fallback (clears config) */
  resetConfig: () => void;
  /** Get the active provider config (user config or null for env fallback) */
  getActiveConfig: () => AIProviderConfig | null;
};

// ── Helpers ───────────────────────────────────────────────────────

function getPreset(providerId: AIProviderId): ProviderPreset | undefined {
  return PRESET_PROVIDERS.find((p) => p.id === providerId);
}

function createDefaultConfig(providerId: AIProviderId): AIProviderConfig {
  const preset = getPreset(providerId);
  return {
    providerId,
    apiKey: "",
    baseURL: preset?.baseURL ?? "",
    model: preset?.models[0] ?? ""
  };
}

function isAIProviderConfigComplete(config: AIProviderConfig) {
  if (!config.apiKey.trim() || !config.model.trim()) return false;
  if (config.providerId !== "custom") return true;

  return /^https:\/\//i.test(config.baseURL.trim());
}

function sanitizeStoredAIProviderConfig(value: unknown): AIProviderConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.providerId !== "string" ||
    !getPreset(candidate.providerId as AIProviderId) ||
    typeof candidate.apiKey !== "string" ||
    typeof candidate.baseURL !== "string" ||
    typeof candidate.model !== "string"
  ) {
    return null;
  }

  return {
    providerId: candidate.providerId as AIProviderId,
    apiKey: candidate.apiKey,
    baseURL: candidate.baseURL,
    model: candidate.model,
    displayName:
      typeof candidate.displayName === "string" ? candidate.displayName : undefined
  };
}

// ── Store ─────────────────────────────────────────────────────────

export const useProviderStore = create<ProviderStoreState & ProviderStoreActions>()(
  persist(
    (set, get) => ({
      // State
      config: null,
      isConfigured: false,

      // Actions
      selectPreset: (providerId: AIProviderId) => {
        const existing = get().config;
        // If switching to the same provider, keep existing values
        if (existing?.providerId === providerId) return;

        set({
          config: createDefaultConfig(providerId),
          isConfigured: false
        });
      },

      setApiKey: (apiKey: string) => {
        const config = get().config ?? createDefaultConfig("openai");
        const nextConfig = { ...config, apiKey };
        set({
          config: nextConfig,
          isConfigured: isAIProviderConfigComplete(nextConfig)
        });
      },

      setBaseURL: (baseURL: string) => {
        const config = get().config ?? createDefaultConfig("custom");
        const nextConfig = { ...config, baseURL };
        set({
          config: nextConfig,
          isConfigured: isAIProviderConfigComplete(nextConfig)
        });
      },

      setModel: (model: string) => {
        const config = get().config ?? createDefaultConfig("openai");
        const nextConfig = { ...config, model };
        set({
          config: nextConfig,
          isConfigured: isAIProviderConfigComplete(nextConfig)
        });
      },

      setConfig: (config: AIProviderConfig) => {
        set({
          config,
          isConfigured: isAIProviderConfigComplete(config)
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
      name: "ai-provider-config",
      // Only persist config + isConfigured
      partialize: (state) => ({
        config: state.config,
        isConfigured: state.isConfigured
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { config?: unknown };
        const config = sanitizeStoredAIProviderConfig(persisted.config);

        return {
          ...currentState,
          config,
          isConfigured: Boolean(config && isAIProviderConfigComplete(config))
        };
      }
    }
  )
);
