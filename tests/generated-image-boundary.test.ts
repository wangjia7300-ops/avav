import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/services/errors";
import {
  __imageGenerationTestUtils,
  generateImageFromPrompt
} from "@/lib/services/generate-image-from-prompt";

async function expectServiceError(
  action: () => Promise<unknown>,
  code: string
) {
  const caught = await action().then(
    () => null,
    (error: unknown) => error
  );
  expect(caught).toBeInstanceOf(ServiceError);
  expect((caught as ServiceError).code).toBe(code);
  return caught as ServiceError;
}

function asFormData(body: Record<string, unknown> | FormData) {
  expect(body).toBeInstanceOf(FormData);
  return body as FormData;
}

async function createSolidPng(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#f4efe7"
    }
  })
    .png()
    .toBuffer();
}

describe("image provider capability matrix", () => {
  const referenceImage = "data:image/png;base64,iVBORw0KGgo=";

  it("requests native 1440x2560 b64 output from Ark", () => {
    const built = __imageGenerationTestUtils.buildProviderRequest(
      "volcengine",
      [referenceImage],
      "ep-seedream"
    );

    expect(built.size).toBe("1440x2560");
    expect(built.request.path).toBe("/images/generations");
    expect(built.request.contentType).toBe("json");
    expect(built.request.body).toMatchObject({
      model: "ep-seedream",
      size: "1440x2560",
      response_format: "b64_json",
      stream: false,
      watermark: false,
      image: referenceImage
    });
  });

  it("always requests OpenAI's supported 1024x1536 source size without model-name guessing", () => {
    const built = __imageGenerationTestUtils.buildProviderRequest(
      "openai",
      [referenceImage],
      "unrecognized-official-model-name"
    );
    const form = asFormData(built.request.body);

    expect(built.size).toBe("1024x1536");
    expect(built.request.path).toBe("/images/edits");
    expect(form.get("size")).toBe("1024x1536");
    expect(form.get("model")).toBe("unrecognized-official-model-name");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("input_fidelity")).toBe("high");
  });

  it("uses the OpenAI-compatible source size for custom Images API without model-name guessing", () => {
    const built = __imageGenerationTestUtils.buildProviderRequest(
      "custom",
      [referenceImage],
      "vendor-model-with-arbitrary-name"
    );
    const form = asFormData(built.request.body);

    expect(built.size).toBe("1024x1536");
    expect(built.request.path).toBe("/images/edits");
    expect(form.get("size")).toBe("1024x1536");
    expect(form.get("model")).toBe("vendor-model-with-arbitrary-name");
    expect(form.get("output_format")).toBe("png");
    expect(form.has("input_fidelity")).toBe(false);
  });

  it("adds an explicit center-crop safe area for OpenAI-compatible providers only", () => {
    const openAI = __imageGenerationTestUtils.applyProviderFraming(
      "openai",
      "base prompt"
    );
    const custom = __imageGenerationTestUtils.applyProviderFraming(
      "custom",
      "base prompt"
    );
    const ark = __imageGenerationTestUtils.applyProviderFraming(
      "volcengine",
      "base prompt"
    );

    expect(openAI).toContain("central 84%");
    expect(openAI).toContain("x=8%–92%");
    expect(custom).toContain("central 84%");
    expect(ark).toBe("base prompt");
  });

  it("does not append a legacy negative prompt a second time for Seedream", () => {
    expect(
      __imageGenerationTestUtils.buildImagePrompt(
        "约束条件：不改变产品结构。",
        "不改变产品结构"
      )
    ).toBe("约束条件：不改变产品结构。");
  });
});

describe("image cancellation", () => {
  it("rejects an already-aborted caller signal before contacting a provider", async () => {
    const controller = new AbortController();
    controller.abort();

    await expectServiceError(
      () =>
        generateImageFromPrompt({
          prompt: "测试",
          imageType: "detail_page",
          referenceImages: ["data:image/png;base64,iVBORw0KGgo="],
          signal: controller.signal
        }),
      "IMAGE_GENERATION_ABORTED"
    );
  });
});

describe("bounded upstream image JSON", () => {
  it("rejects an oversized Content-Length before consuming the body", async () => {
    const response = new Response('{"data":[]}', {
      headers: {
        "content-type": "application/json",
        "content-length": String(
          __imageGenerationTestUtils.maxUpstreamJsonBytes + 1
        )
      }
    });

    await expectServiceError(
      () => __imageGenerationTestUtils.readUpstreamImagePayload(response),
      "IMAGE_RESPONSE_TOO_LARGE"
    );
    expect(response.bodyUsed).toBe(false);
  });

  it("enforces the same 32MiB limit when Content-Length is absent", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(0x20);
    let emitted = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
          emitted += chunk.byteLength;
          if (
            emitted >
            __imageGenerationTestUtils.maxUpstreamJsonBytes + chunk.byteLength
          ) {
            controller.close();
          }
        }
      })
    );

    await expectServiceError(
      () => __imageGenerationTestUtils.readUpstreamImagePayload(response),
      "IMAGE_RESPONSE_TOO_LARGE"
    );
  });

  it("rejects malformed JSON instead of passing an ambiguous payload downstream", async () => {
    await expectServiceError(
      () =>
        __imageGenerationTestUtils.readUpstreamImagePayload(
          new Response('{"data":[}')
        ),
      "IMAGE_RESPONSE_INVALID"
    );
  });
});

describe("generated image decoding and normalization", () => {
  it("fully decodes, strips metadata, and center-crops OpenAI 1024x1536 to exact 864x1536", async () => {
    const source = await sharp({
      create: {
        width: 1_024,
        height: 1_536,
        channels: 3,
        background: "#d11b24"
      }
    })
      .composite([
        {
          input: {
            create: {
              width: 864,
              height: 1_536,
              channels: 3,
              background: "#18b85a"
            }
          },
          left: 80,
          top: 0
        }
      ])
      .withExif({
        IFD0: {
          Artist: "upstream-private-metadata"
        }
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    const asset = await __imageGenerationTestUtils.parseGeneratedImage(
      {
        model: "official-image-model",
        data: [
          {
            b64_json: source.toString("base64"),
            size: "1024x1536"
          }
        ]
      },
      "openai"
    );
    const output = Buffer.from(
      asset.imageUrl.replace(/^data:image\/webp;base64,/, ""),
      "base64"
    );
    const metadata = await sharp(output).metadata();
    const firstPixel = await sharp(output)
      .extract({ left: 0, top: 500, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect(asset.mimeType).toBe("image/webp");
    expect(asset.size).toBe("864x1536");
    expect(asset.width).toBe(864);
    expect(asset.height).toBe(1_536);
    expect(metadata.width).toBe(864);
    expect(metadata.height).toBe(1_536);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(firstPixel[1]).toBeGreaterThan(firstPixel[0] * 2);
  }, 15_000);

  it("normalizes custom OpenAI-compatible output to exact 9:16", async () => {
    const source = await sharp({
      create: {
        width: 1_024,
        height: 1_536,
        channels: 3,
        background: "#ffffff"
      }
    })
      .png()
      .toBuffer();

    const asset = await __imageGenerationTestUtils.parseGeneratedImage(
      {
        data: [
          {
            b64_json: source.toString("base64"),
            size: "1024x1536"
          }
        ]
      },
      "custom"
    );

    expect(asset.size).toBe("864x1536");
    expect(asset.width).toBe(864);
    expect(asset.height).toBe(1_536);
  }, 15_000);

  it("accepts a provider's near-9:16 941x1672 output and normalizes it to the delivery size", async () => {
    const source = await createSolidPng(941, 1_672);

    const asset = await __imageGenerationTestUtils.parseGeneratedImage(
      {
        data: [
          {
            b64_json: source.toString("base64")
          }
        ]
      },
      "custom"
    );

    expect({
      size: asset.size,
      width: asset.width,
      height: asset.height
    }).toEqual({
      size: "864x1536",
      width: 864,
      height: 1_536
    });
  }, 15_000);

  it("accepts custom size metadata when it reports either actual or requested pixels", async () => {
    const source = await createSolidPng(941, 1_672);

    for (const size of ["941x1672", "1024x1536"]) {
      const asset = await __imageGenerationTestUtils.parseGeneratedImage(
        {
          data: [
            {
              b64_json: source.toString("base64"),
              size
            }
          ]
        },
        "custom"
      );

      expect(asset.size).toBe("864x1536");
    }

    await expectServiceError(
      () =>
        __imageGenerationTestUtils.parseGeneratedImage(
          {
            data: [
              {
                b64_json: source.toString("base64"),
                size: "1000x1600"
              }
            ]
          },
          "custom"
        ),
      "IMAGE_SIZE_MISMATCH"
    );
  }, 15_000);

  it("rejects custom output that would need enlargement or excessive cropping", async () => {
    for (const [width, height] of [
      [863, 1_536],
      [1_536, 1_536]
    ] as const) {
      const source = await createSolidPng(width, height);
      await expectServiceError(
        () =>
          __imageGenerationTestUtils.parseGeneratedImage(
            {
              data: [
                {
                  b64_json: source.toString("base64")
                }
              ]
            },
            "custom"
          ),
        "IMAGE_SIZE_MISMATCH"
      );
    }
  });

  it("keeps exact source-size validation for official image providers", async () => {
    const source = await createSolidPng(941, 1_672);

    await expectServiceError(
      () =>
        __imageGenerationTestUtils.parseGeneratedImage(
          {
            data: [
              {
                b64_json: source.toString("base64")
              }
            ]
          },
          "openai"
        ),
      "IMAGE_SIZE_MISMATCH"
    );

    await expectServiceError(
      () =>
        __imageGenerationTestUtils.parseGeneratedImage(
          {
            data: [
              {
                b64_json: source.toString("base64")
              }
            ]
          },
          "volcengine"
        ),
      "IMAGE_SIZE_MISMATCH"
    );
  });

  it("preserves Ark's valid native 9:16 delivery dimensions", async () => {
    const source = await createSolidPng(1_440, 2_560);
    const asset = await __imageGenerationTestUtils.parseGeneratedImage(
      {
        data: [
          {
            b64_json: source.toString("base64"),
            size: "1440x2560"
          }
        ]
      },
      "volcengine"
    );

    expect({
      size: asset.size,
      width: asset.width,
      height: asset.height
    }).toEqual({
      size: "1440x2560",
      width: 1_440,
      height: 2_560
    });
  });

  it("validates official source dimensions after applying EXIF orientation", async () => {
    const source = await sharp({
      create: {
        width: 1_536,
        height: 1_024,
        channels: 3,
        background: "#f4efe7"
      }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const asset = await __imageGenerationTestUtils.parseGeneratedImage(
      {
        data: [
          {
            b64_json: source.toString("base64"),
            size: "1024x1536"
          }
        ]
      },
      "openai"
    );

    expect({
      size: asset.size,
      width: asset.width,
      height: asset.height
    }).toEqual({
      size: "864x1536",
      width: 864,
      height: 1_536
    });
  });

  it("rejects a malformed image even when its base64 encoding is syntactically valid", async () => {
    await expectServiceError(
      () =>
        __imageGenerationTestUtils.parseGeneratedImage(
          {
            data: [
              {
                b64_json: Buffer.from("not-an-image").toString("base64")
              }
            ]
          },
          "volcengine"
        ),
      "IMAGE_RESULT_DECODE_FAILED"
    );
  });

  it("rejects output above the 24MP decoded-pixel ceiling before re-encoding", async () => {
    const overPixelLimit = await sharp({
      create: {
        width: 5_000,
        height: 5_000,
        channels: 3,
        background: "#f4f4f4"
      }
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expectServiceError(
      () =>
        __imageGenerationTestUtils.parseGeneratedImage(
          {
            data: [
              {
                b64_json: overPixelLimit.toString("base64")
              }
            ]
          },
          "volcengine"
        ),
      "IMAGE_RESULT_DIMENSIONS_EXCEEDED"
    );
  });
});
