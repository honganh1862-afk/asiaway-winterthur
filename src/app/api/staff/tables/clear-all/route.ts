import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { handleApiError } from '../../../../../server/http/api';
import { NO_STORE, notServedHere } from '../../../../../server/http/table-cart-api';
import { requireStaff } from '../../../../../server/staff/auth';
import { clearAllTables, listTables } from '../../../../../server/services/table-cart-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** End of the day: clears every table at once. */
export async function POST(request: Request) {
  const off = notServedHere();
  if (off) return off;
  try {
    const staff = requireStaff(request);
    const database = await db();
    const cleared = await clearAllTables(database, staff);
    return NextResponse.json({ cleared, tables: await listTables(database) }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
