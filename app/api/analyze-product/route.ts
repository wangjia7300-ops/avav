import { NextResponse } from "next/server";
import { MAX_ANALYZE_REQUEST_BYTES, formatBytes } from "@/lib/config";
import { assertProviderCapability } from "@/lib/ai-providers";
import { analyzeProductImage } from "@/lib/services/analyze-product-image";
import { serializeApiError, ServiceError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_ANALYZE_REQUEST_BYTES) {
      throw new ServiceError(
        `上传图片请求过大，请减少图片数量或压缩后重试（当前接口限制 ${formatBytes(MAX_ANALYZE_REQUEST_BYTES)}）。`,
        {
          statusCode: 413,
          code: "REQUEST_BODY_TOO_LARGE"
        }
      );
    }

    const body = rawBody ? JSON.parse(rawBody) : {};
    const { providerConfig, ...input } = body;
    assertProviderCapability(providerConfig ?? null, "supportsVision", "当前模型不支持图片识别，请换用支持视觉理解的模型。");
    const analysis = await analyzeProductImage({ ...input, providerConfig: providerConfig ?? null });

    return NextResponse.json({ success: true, data: analysis });
  } catch (error) {
    const response = serializeApiError(error, "产品识别失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
