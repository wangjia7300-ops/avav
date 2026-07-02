import { NextResponse } from "next/server";
import { generateDesignPlan } from "@/lib/services/generate-design-plan";
import { serializeApiError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerConfig, ...input } = body;
    const plan = await generateDesignPlan({ ...input, providerConfig: providerConfig ?? null });

    return NextResponse.json({ success: true, data: plan });
  } catch (error) {
    const response = serializeApiError(error, "视觉策划生成失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
