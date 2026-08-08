import { createHash } from "node:crypto";
import type { AIProviderConfig } from "@/lib/types";

export function researchProviderFingerprint(config: AIProviderConfig) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        providerId: config.providerId.trim(),
        baseURL: config.baseURL.trim().replace(/\/+$/u, ""),
        model: config.model.trim(),
        apiKey: config.apiKey.trim()
      })
    )
    .digest("hex");
}

