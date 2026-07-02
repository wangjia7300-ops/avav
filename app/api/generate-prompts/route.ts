import { NextResponse } from "next/server";
import { generateImagePrompts } from "@/lib/services/generate-prompts";
import { serializeApiError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerConfig, ...input } = body;
    const prompts = await generateImagePrompts({ ...input, providerConfig: providerConfig ?? null });

    return NextResponse.json({ success: true, data: prompts });
  } catch (error) {
    const response = serializeApiError(error, "提示词生成失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
