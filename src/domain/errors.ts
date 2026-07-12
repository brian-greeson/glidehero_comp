export type AppErrorCode = 'invalid_request' | 'unauthorized' | 'conflict' | 'server_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
  }
}
