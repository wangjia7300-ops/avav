import { describe, expect, it } from "vitest";
import { fitReferenceImageDimensions } from "@/lib/uploads/normalize-reference-image";

describe("reference image 1K normalization", () => {
  it("fits the longest edge to 1024px, preserves ratio, and never enlarges", () => {
    expect([
      fitReferenceImageDimensions(4_000, 3_000),
      fitReferenceImageDimensions(3_000, 4_000),
      fitReferenceImageDimensions(800, 600)
    ]).toEqual([
      { width: 1_024, height: 768, resized: true },
      { width: 768, height: 1_024, resized: true },
      { width: 800, height: 600, resized: false }
    ]);
  });

  it("rejects encoded dimensions that are unsafe to decode in the browser", () => {
    expect(() => fitReferenceImageDimensions(8_001, 1)).toThrow(
      "最大边长为8000px"
    );
    expect(() => fitReferenceImageDimensions(5_000, 5_000)).toThrow(
      "总像素不能超过2400万"
    );
  });
});
