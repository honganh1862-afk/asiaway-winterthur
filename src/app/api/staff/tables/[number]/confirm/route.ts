import { NextResponse } from 'next/server';
import { db } from '../../../../../../server/db/index';
import { handleApiError } from '../../../../../../server/http/api';
import { NO_STORE, notServedHere } from '../../../../../../server/http/table-cart-api';
import { requireStaff } from '../../../../../../server/staff/auth';
import { confirmOrder, getTableCart } from '../../../../../../server/services/table-cart-service';
import { parseLocale } from '../../../../../../i18n/locales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The staff have checked the list with the guests: it goes to the kitchen. */
export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const off = notServedHere();
  if (off) return off;
  try {
    const staff = requireStaff(request);
    const { number } = await params;
    const database = await db();
    await confirmOrder(database, number, staff);
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json(await getTableCart(database, number, locale), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
