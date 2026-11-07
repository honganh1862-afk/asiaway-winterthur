/**
 * Stable, machine-readable error codes. The HTTP layer maps these to status
 * codes; the UI maps them to localised text. Messages here are for logs and
 * developers, never shown raw to a guest.
 */
export type DomainErrorCode =
  | 'QR_INVALID'
  | 'SESSION_CLOSED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_OPEN'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_EDITABLE'
  /** The guest's 60-second window has closed; only staff can change it now. */
  | 'ORDER_WINDOW_CLOSED'
  /** This device has no claim on the order it is trying to change. */
  | 'FORBIDDEN'
  | 'ILLEGAL_ORDER_TRANSITION'
  | 'ILLEGAL_SESSION_TRANSITION'
  | 'ITEMS_UNAVAILABLE'
  | 'EMPTY_CART'
  | 'CART_TOO_LARGE'
  | 'INVALID_QUANTITY'
  | 'NOTE_TOO_LONG'
  | 'REVISION_CONFLICT'
  | 'REQUEST_IN_FLIGHT'
  | 'SESSION_HAS_UNRESOLVED_ORDERS'
  | 'REASON_REQUIRED'
  | 'VALIDATION_FAILED'
  /** No active table with that number. */
  | 'TABLE_NOT_FOUND'
  /** A table with that number is already in service. */
  | 'TABLE_EXISTS'
  /** A table with dishes on it cannot be taken out of service. */
  | 'TABLE_IN_USE'
  /** A guest tried to change a dish the staff have already confirmed. */
  | 'LINE_CONFIRMED'
  /** Too many wrong PINs from one place; try again later. */
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError(code, message, details);
}
