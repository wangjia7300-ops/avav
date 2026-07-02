export class ServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, options?: { statusCode?: number; code?: string }) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "SERVICE_ERROR";
  }
}

export function serializeApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ServiceError) {
    return {
      body: {
        success: false,
        error: error.message,
        code: error.code
      },
      status: error.statusCode
    };
  }

  return {
    body: {
      success: false,
      error: error instanceof Error ? error.message : fallbackMessage,
      code: "UNKNOWN_ERROR"
    },
    status: 500
  };
}
