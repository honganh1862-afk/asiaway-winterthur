import { NextResponse } from 'next/server';
import { DomainError } from '../../domain/errors';

/**
 * Headers for what a guest reads: the menu, a dish, the allergen legend.
 *
 * They change only when the restaurant loads the menu again, and at midnight,
 * when the Saturday dishes come and go. So Vercel keeps a copy for five minutes
 * and, past that, serves it while fetching a fresh one in the background for up
 * to a day: no guest waits for a database that has gone to sleep. A phone keeps
 * its own copy for a minute, and a stale one for ten while it checks again.
 */
export const MENU_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
  'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
} as const;

/** Stable error codes; localised text is chosen by the client from the code. */
const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  TABLE_NOT_FOUND: 404,
  TABLE_EXISTS: 409,
  TABLE_IN_USE: 409,
  LINE_CONFIRMED: 409,
  ITEMS_UNAVAILABLE: 409,
};

export function apiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status?: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: status ?? STATUS_BY_CODE[code] ?? 400 },
  );
}

/**
 * Turns any thrown value into a safe response.
 *
 * Domain errors keep their code so the UI can react precisely. Anything else
 * becomes a generic 500: stack traces, SQL fragments and internal ids never
 * reach a caller.
 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.details);
  }
  console.error('[api] unhandled error', error);
  return apiError('INTERNAL_ERROR', 'An unexpected error occurred', undefined, 500);
}
