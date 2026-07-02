import { NextResponse } from "next/server";
import { researchProductOnline } from "@/lib/services/ai";
import { serializeApiError } from "@/lib/services/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const research = await researchProductOnline(body);

    return NextResponse.json({ success: true, data: research });
  } catch (error) {
    const response = serializeApiError(error, "市场分析失败。");

    return NextResponse.json(response.body, { status: response.status });
  }
}
