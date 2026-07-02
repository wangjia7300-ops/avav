import { NextResponse } from "next/server";
import { generateVisualStyleSystem } from "@/lib/services/generate-visual-style-system";
import { serializeApiError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const visualStyleSystem = await generateVisualStyleSystem(body);

    return NextResponse.json({ success: true, data: visualStyleSystem });
  } catch (error) {
    const response = serializeApiError(error, "视觉风格体系生成失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
