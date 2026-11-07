import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../../server/db/index';
import { handleApiError } from '../../../../../../server/http/api';
import { NO_STORE, invalidBody, notServedHere } from '../../../../../../server/http/table-cart-api';
import { requireStaff } from '../../../../../../server/staff/auth';
import { getTableCart, setTableMenus } from '../../../../../../server/services/table-cart-service';
import { parseLocale } from '../../../../../../i18n/locales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ menus: z.enum(['SCHEDULE', 'VIETNAMESE', 'THAI', 'BOTH']) });

/**
 * Staff only: the food menus this table's guests see (Vietnamese, Thai or
 * both), or back to the day's schedule. Lasts until the table is cleared.
 */
export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const off = notServedHere();
  if (off) return off;
  try {
    requireStaff(request);
    const { number } = await params;
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return invalidBody(body.error);
    const database = await db();
    await setTableMenus(database, number, body.data.menus === 'SCHEDULE' ? null : body.data.menus);
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json(await getTableCart(database, number, locale), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
