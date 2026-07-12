export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_invite"
  | "already_joined"
  | "not_joined"
  | "game_not_joinable"
  | "location_rejected"
  | "not enough players"
  | "server_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

export const invalidRequest = (message: string, details: Record<string, unknown> | null = null) =>
  new ApiError(422, "invalid_request", message, details);

export const unauthorized = (message = "Authentication is required.") =>
  new ApiError(401, "unauthorized", message);

export const forbidden = (message = "The authenticated player is not allowed to perform this action.") =>
  new ApiError(403, "forbidden", message);

export const notFound = (message = "Resource was not found.") => new ApiError(404, "not_found", message);

export const serverError = (message = "Server error.") => new ApiError(404, "server_error", message);

