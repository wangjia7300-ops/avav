import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GeneratedImageAsset,
  ImageProviderConfig
} from "@/lib/types";
import { createSampleProject } from "@/tests/fixtures/synthetic-project";

vi.mock("@/lib/services/generate-image-from-prompt", () => ({
  generateImageFromPrompt: vi.fn()
}));

import { POST } from "@/app/api/skill-suite/image/route";
import { generateImageFromPrompt } from "@/lib/services/generate-image-from-prompt";

const imageProviderConfig: ImageProviderConfig = {
  scope: "image_generation",
  providerId: "volcengine",
  apiKey: "test-only-key",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  imageModel: "test-image-endpoint"
};

const generatedImage: GeneratedImageAsset = {
  imageUrl: "data:image/webp;base64,UklGRg==",
  mimeType: "image/webp",
  model: "test-image-endpoint",
  size: "1440x2560",
  width: 1440,
  height: 2560,
  referenceImagesUsed: 1,
  createdAt: "2026-07-27T00:00:00.000Z"
};

function imageRequest(
  requestId: string,
  patch: Record<string, unknown> = {}
) {
  const project = createSampleProject();
  const screen = project.plan!.screens[0];
  const execution = project.executions[screen.id];
  const body = JSON.stringify({
    requestId,
    screen,
    execution,
    facts: project.research!.facts,
    referenceImages: ["data:image/png;base64,iVBORw0KGgo="],
    imageProviderConfig,
    ...patch
  });

  return new Request("http://127.0.0.1:3000/api/skill-suite/image", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    },
    body
  });
}

describe("image request idempotency", () => {
  beforeEach(() => {
    vi.mocked(generateImageFromPrompt).mockReset();
    vi.mocked(generateImageFromPrompt).mockResolvedValue(generatedImage);
  });

  it("replays the completed result for the same request id without a second charge", async () => {
    const requestId = `img_idempotency_${crypto.randomUUID().replace(/-/g, "")}`;
    const first = await POST(imageRequest(requestId));
    const second = await POST(imageRequest(requestId));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      data: generatedImage,
      meta: { replayed: true }
    });
    expect(generateImageFromPrompt).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of one request id with different generation input", async () => {
    const requestId = `img_conflict_${crypto.randomUUID().replace(/-/g, "")}`;
    const first = await POST(imageRequest(requestId));
    const conflict = await POST(
      imageRequest(requestId, {
        referenceImages: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="]
      })
    );

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      success: false,
      code: "IMAGE_IDEMPOTENCY_CONFLICT"
    });
    expect(generateImageFromPrompt).toHaveBeenCalledTimes(1);
  });

  it("rejects an execution compiled from older copy before calling the image provider", async () => {
    const project = createSampleProject();
    const screen = structuredClone(project.plan!.screens[0]);
    const execution = structuredClone(project.executions[screen.id]);
    screen.copy.headline = "现在这句才是定稿";

    const response = await POST(
      imageRequest(
        `img_stale_copy_${crypto.randomUUID().replace(/-/g, "")}`,
        { screen, execution }
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "IMAGE_PROMPT_STALE"
    });
    expect(generateImageFromPrompt).not.toHaveBeenCalled();
  });
});
