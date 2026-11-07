import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { handleApiError } from '../../../../../server/http/api';
import {
  CartChangeBody,
  NO_STORE,
  invalidBody,
  notServedHere,
} from '../../../../../server/http/table-cart-api';
import { changeCartLine, getTableCart, setAllAtOnce, setTableNote } from '../../../../../server/services/table-cart-service';
import { parseLocale } from '../../../../../i18n/locales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The table's shared cart, as every phone at the table sees it. Open: the table
 * card's link is the only key, and nothing here reaches the kitchen, the
 * waiter checks the list with the guests at the table.
 */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const off = notServedHere();
  if (off) return off;
  try {
    const { number } = await params;
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json(await getTableCart(await db(), number, locale), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const off = notServedHere();
  if (off) return off;
  try {
    const { number } = await params;
    const body = CartChangeBody.safeParse(await request.json().catch(() => null));
    if (!body.success) return invalidBody(body.error);
    const database = await db();
    if ('allAtOnce' in body.data) await setAllAtOnce(database, number, body.data.allAtOnce);
    else if ('tableNote' in body.data) await setTableNote(database, number, body.data.tableNote);
    else await changeCartLine(database, number, body.data, 'guest');
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json(await getTableCart(database, number, locale), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
