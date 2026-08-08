import { expect } from "vitest";
import { ServiceError } from "@/lib/services/errors";

/**
 * 断言异步操作抛出指定 code 的 ServiceError。
 * 返回错误对象以便进一步断言（如检查 statusCode）。
 */
export async function expectServiceError(
  action: (() => Promise<unknown>) | Promise<unknown>,
  code: string
): Promise<ServiceError> {
  const promise = typeof action === "function" ? action() : action;
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error
  );
  if (!(thrown instanceof ServiceError)) {
    // 抛出实际错误以便 vitest 展示差异
    if (thrown instanceof Error) throw thrown;
    throw new Error(
      `Expected ServiceError with code "${code}" but promise resolved without throwing`
    );
  }
  expect(thrown.code).toBe(code);
  return thrown;
}
