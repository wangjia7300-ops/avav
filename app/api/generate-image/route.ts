import { NextResponse } from "next/server";
import { generateImageFromPrompt } from "@/lib/services/generate-image-from-prompt";
import { serializeApiError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerConfig, ...input } = body;
    const image = await generateImageFromPrompt({
      ...input,
      providerConfig: providerConfig ?? null
    });

    return NextResponse.json({ success: true, data: image });
  } catch (error) {
    const response = serializeApiError(error, "生图失败。");
    return NextResponse.json(response.body, { status: response.status });
  }
}
