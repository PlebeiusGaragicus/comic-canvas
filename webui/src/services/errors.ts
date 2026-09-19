/** Typed service error. `message` is human-readable and is what the UI shows
 *  via `formatRequestError`. `code` lets callers branch without parsing text. */

export type ServiceErrorCode =
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'unsupported'
  | 'provider'
  | 'offline'
  | 'storage';

export interface ServiceErrorOptions {
  code?: ServiceErrorCode;
  /** Structured extra data (e.g. blocking chat session ids). */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: ServiceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ServiceError';
    this.code = options.code ?? 'invalid';
    this.details = options.details;
  }
}

export function notFound(message: string): ServiceError {
  return new ServiceError(message, { code: 'not-found' });
}

export function conflict(message: string, details?: Record<string, unknown>): ServiceError {
  return new ServiceError(message, { code: 'conflict', details });
}

export function invalid(message: string): ServiceError {
  return new ServiceError(message, { code: 'invalid' });
}

export function isServiceError(value: unknown, code?: ServiceErrorCode): value is ServiceError {
  return value instanceof ServiceError && (code === undefined || value.code === code);
}
