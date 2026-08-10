import { describe, expect, it, vi } from "vitest";

import { createChatCompletion } from "@/lib/ai-providers";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

describe("Gemini generateContent transport regression", () => {
  it("uses the stable generateContent endpoint instead of Interactions", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "OK" }] }
            }
          ],
          modelVersion: "gemini-3.6-flash"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createChatCompletion(
      {
        providerId: "gemini",
        apiKey: "test-key",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-flash-latest"
      },
      {
        model: "gemini-flash-latest",
        messages: [{ role: "user", content: "Return OK" }],
        maxTokens: 128,
        timeoutMs: 20_000,
        maxTransportRetries: 0
      }
    );

    expect(result.text).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
    );
  });
});
