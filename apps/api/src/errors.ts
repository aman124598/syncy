import type { ErrorCode } from "@syncy/shared";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;

  public constructor(code: ErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
