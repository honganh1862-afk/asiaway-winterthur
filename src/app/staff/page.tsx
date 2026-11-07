'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { SignIn } from '../../components/staff/SignIn';
import { StaffShell } from '../../components/staff/StaffShell';
import {
  minutesAgo,
  staffFetch,
  usePolling,
  useStaffSession,
  type TableOverview,
} from '../../components/staff/useStaff';
import { formatMoney } from '../../lib/format';

/**
 * The staff overview: which tables have something in their cart, newest
 * activity first, and every table to open — also to take an order from the
 * printed menu. Read again every few seconds.
 */
export default function StaffHomePage() {
  const { session, reload } = useStaffSession();
  if (!session) return <StaffShell name={null}>{null}</StaffShell>;
  if (!session.name) {
    return (
      <StaffShell name={null}>
        <SignIn session={session} onSignedIn={reload} />
      </StaffShell>
    );
  }
  return (
    <StaffShell name={session.name}>
      <Board />
    </StaffShell>
  );
}

function Board() {
  const { t } = useCustomer();
  const [tables, setTables] = useState<TableOverview[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const data = await staffFetch<{ tables: TableOverview[] }>('/api/staff/tables');
    setTables(data.tables);
    setTick((n) => n + 1);
  }, []);
  usePolling(load);

  if (!tables) return <p className="text-sm text-ink-muted">{t('common.loading')}</p>;

  const active = tables.filter((x) => x.isActive);
  const waiting = active
    .filter((x) => x.cart)
    // Tables waiting for confirmation first, then the most recent change.
    .sort(
      (a, b) =>
        Number(b.cart!.pending > 0) - Number(a.cart!.pending > 0) ||
        b.cart!.updatedAt.localeCompare(a.cart!.updatedAt),
    );

  return (
    <>
      <section className="space-y-2">
        <h1 className="h-label">{t('staff.board.waiting')}</h1>
        {waiting.length === 0 ? (
          <p className="card p-4 text-sm text-ink-muted">{t('staff.board.none')}</p>
        ) : (
          <ul className="space-y-2">
            {waiting.map((table) => {
              const ago = minutesAgo(table.cart!.updatedAt);
              return (
                <li key={table.tableNumber}>
                  <Link
                    href={`/staff/table/${encodeURIComponent(table.tableNumber)}`}
                    className="card flex items-center gap-4 border-l-4 border-brand-600 p-4"
                  >
                    <span className="font-display text-3xl font-bold text-brand-600">
                      {table.tableNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {t('staff.board.dishes', {
                          count: table.cart!.count,
                          total: formatMoney(table.cart!.totalCents),
                        })}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        {ago === 0 ? t('staff.ago.now') : t('staff.ago.minutes', { n: ago })}
                        {table.cart!.allAtOnce && (
                          <span className="ml-2 font-semibold text-brand-700">· {t('cart.serve.allAtOnce')}</span>
                        )}
                      </span>
                    </span>
                    {table.cart!.pending > 0 ? (
                      <span className="shrink-0 rounded-xl bg-brand-600 px-2 py-1 text-center text-xs font-bold text-white">
                        {t('staff.board.toConfirm', { count: table.cart!.pending })}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-xl bg-ok-50 px-2 py-1 text-xs font-bold text-ok-500">
                        ✓ {t('staff.board.confirmed')}
                      </span>
                    )}
                    <span aria-hidden="true" className="text-2xl text-ink-muted">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="h-label">{t('staff.board.all')}</h2>
        <p className="text-sm text-ink-muted">{t('staff.board.allHint')}</p>
        <div className="grid grid-cols-4 gap-2">
          {active.map((table) => (
            <Link
              key={table.tableNumber}
              href={`/staff/table/${encodeURIComponent(table.tableNumber)}`}
              className={`flex min-h-tap items-center justify-center rounded-xl border py-3 font-display text-lg font-bold ${
                table.cart
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink/15 bg-surface text-ink'
              }`}
            >
              {table.tableNumber}
            </Link>
          ))}
        </div>
      </section>

      <Link href="/staff/tables" className="btn-secondary w-full">
        {t('staff.board.manage')}
      </Link>

      {/* End of the day: every table at once, instead of one by one. */}
      {waiting.length > 0 && (
        <button
          type="button"
          className="min-h-tap w-full rounded-xl border-2 border-danger-500 px-4 py-3 font-semibold text-danger-500"
          onClick={async () => {
            if (!window.confirm(t('staff.board.clearAll.confirm', { count: waiting.length }))) return;
            const result = await staffFetch<{ cleared: string[]; tables: TableOverview[] }>(
              '/api/staff/tables/clear-all',
              { method: 'POST' },
            );
            setTables(result.tables);
            setNotice(t('staff.board.clearAll.done', { tables: result.cleared.join(', ') || '–' }));
          }}
        >
          {t('staff.board.clearAll')}
        </button>
      )}
      {notice && (
        <p role="status" className="text-center text-sm font-semibold text-ink-muted">
          {notice}
        </p>
      )}
    </>
  );
}
