export interface ApiErrorDetails {
  code?: string;
  details?: unknown;
  traceId?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  traceId?: string;

  constructor(message: string, status: number, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = details?.code;
    this.details = details?.details;
    this.traceId = details?.traceId;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。'): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  const record = toRecord(error);
  if (record) {
    const message = record.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  return fallback;
}
