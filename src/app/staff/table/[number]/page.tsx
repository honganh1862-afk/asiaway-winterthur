'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCustomer } from '../../../../components/customer/CustomerProvider';
import { useMenu, type MenuItem } from '../../../../components/customer/useMenu';
import { SignIn } from '../../../../components/staff/SignIn';
import { StaffShell } from '../../../../components/staff/StaffShell';
import {
  staffFetch,
  usePolling,
  useStaffSession,
  type TableCart,
} from '../../../../components/staff/useStaff';
import { formatMoney } from '../../../../lib/format';
import { RESTAURANT } from '../../../../config/restaurant';
import type { MessageKey } from '../../../../i18n';

/**
 * One table, for the member of staff at it: what the guests have put in the
 * shared cart, changed line by line; dishes added for a guest ordering from
 * the printed menu; and, once the table has paid, clearing it for the next
 * guests. Read again every few seconds, so what a guest adds meanwhile shows.
 */
export default function StaffTablePage() {
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
      <Table />
    </StaffShell>
  );
}

type Course = 1 | 2 | 3;
const COURSES: readonly Course[] = [1, 2, 3];
type Change =
  | { menuItemId: string; delta: number; course?: Course }
  | { menuItemId: string; quantity: number; course?: Course }
  | { menuItemId: string; from: Course; to: Course }
  | { menuItemId: string; course: Course; note: string }
  | { allAtOnce: boolean }
  | { tableNote: string };

function Table() {
  const { t, locale } = useCustomer();
  const router = useRouter();
  const tableNumber = decodeURIComponent(String(useParams<{ number: string }>().number));
  const path = `/api/staff/tables/${encodeURIComponent(tableNumber)}`;
  const [cart, setCart] = useState<TableCart | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCart(await staffFetch<TableCart>(`${path}/cart?lang=${locale}`));
    } catch {
      setMissing(true);
    }
  }, [path, locale]);
  usePolling(load);

  const change = async (body: Change) => {
    setCart(await staffFetch<TableCart>(`${path}/cart?lang=${locale}`, { method: 'POST', body: JSON.stringify(body) }));
  };

  if (missing) {
    return (
      <Link href="/staff" className="btn-secondary w-full">
        ‹ {t('staff.table.back')}
      </Link>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link href="/staff" className="min-h-tap py-2 text-sm font-semibold text-brand-700">
          ‹ {t('staff.table.back')}
        </Link>
        <h1 className="font-display text-3xl font-bold">{t('staff.table.title', { table: tableNumber })}</h1>
      </div>

      {/* Staff only: which menus this table's guests see, until it is cleared. */}
      {cart && RESTAURANT.thaiMenu && (
        <section className="space-y-2">
          <h2 className="h-label">{t('staff.table.menu')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {(['SCHEDULE', 'VIETNAMESE', 'THAI', 'BOTH'] as const).map((value) => {
              const chosen = value === 'SCHEDULE' ? cart.menuOverride === null : cart.menuOverride === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={chosen}
                  onClick={async () =>
                    setCart(
                      await staffFetch<TableCart>(`${path}/menu?lang=${locale}`, {
                        method: 'POST',
                        body: JSON.stringify({ menus: value }),
                      }),
                    )
                  }
                  className={`min-h-tap rounded-xl border px-3 py-2 text-sm font-semibold ${
                    value === 'SCHEDULE' ? 'col-span-2' : ''
                  } ${chosen ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink/15 bg-surface text-ink'}`}
                >
                  {value === 'SCHEDULE'
                    ? t('staff.table.menu.schedule', { menu: t(`menus.${cart.scheduledMenus}` as MessageKey) })
                    : t(`menus.${value}` as MessageKey)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted">{t('staff.table.menu.hint')}</p>
        </section>
      )}

      {cart && (
        <div className="flex gap-2" role="group" aria-label={t('cart.serve.title')}>
          {([false, true] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={cart.allAtOnce === value}
              onClick={() => change({ allAtOnce: value })}
              className={`min-h-tap flex-1 rounded-xl border px-3 text-sm font-semibold ${
                cart.allAtOnce === value
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink/15 bg-surface text-ink'
              }`}
            >
              {value ? t('cart.serve.allAtOnce') : t('cart.serve.courses')}
            </button>
          ))}
        </div>
      )}

      {!cart ? (
        <p className="text-sm text-ink-muted">{t('common.loading')}</p>
      ) : cart.lines.length === 0 ? (
        <p className="card p-4 text-sm text-ink-muted">{t('staff.table.empty')}</p>
      ) : (
        <>
          {groupsOf(cart, t).map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="h-label">{group.title}</h2>
              <ul className="card divide-y divide-ink/10">
                {group.lines.map((line) => (
                  <li key={`${line.menuItemId}:${line.course}`} className="p-3">
                    <div className="flex items-start gap-3">
                      <span className="min-w-[3.25rem] shrink-0 font-display text-xl font-bold text-brand-600">
                        {line.dishNumber ?? '·'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">
                          {line.name}
                          {line.volume && <span className="text-ink-muted"> · {line.volume}</span>}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {formatMoney(line.unitPriceCents)} ·{' '}
                          {t('staff.table.by', {
                            who: line.changedBy === 'guest' ? t('staff.table.guest') : line.changedBy,
                          })}
                          {!line.isAvailable && (
                            <span className="ml-1 font-semibold text-danger-500">· {t('staff.table.soldOut')}</span>
                          )}
                        </p>
                        {line.quantity > line.confirmedQuantity ? (
                          <p className="mt-0.5 inline-block rounded bg-brand-600 px-1.5 text-xs font-bold text-white">
                            {t('staff.table.new', { count: line.quantity - line.confirmedQuantity })}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs font-semibold text-ok-500">✓ {t('staff.board.confirmed')}</p>
                        )}
                      </div>
                      <span className="font-semibold">{formatMoney(line.unitPriceCents * line.quantity)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        aria-label={`− ${line.name}`}
                        className="btn-secondary min-w-tap px-3"
                        onClick={() => change({ menuItemId: line.menuItemId, delta: -1, course: line.course })}
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-lg font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`+ ${line.name}`}
                        className="btn-secondary min-w-tap px-3"
                        onClick={() => change({ menuItemId: line.menuItemId, delta: 1, course: line.course })}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="ml-auto min-h-tap px-2 text-sm text-danger-500"
                        onClick={() => change({ menuItemId: line.menuItemId, quantity: 0, course: line.course })}
                      >
                        {t('cart.remove')}
                      </button>
                    </div>
                    {!cart.allAtOnce && line.kind !== 'DRINK' && (
                      <div className="mt-2 flex gap-2">
                        {COURSES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={line.course === c}
                            onClick={() =>
                              line.course !== c && change({ menuItemId: line.menuItemId, from: line.course, to: c })
                            }
                            className={`min-h-tap flex-1 rounded-xl border px-2 text-xs font-semibold ${
                              line.course === c
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-ink/15 bg-surface text-ink'
                            }`}
                          >
                            {c} · {t(`course.${c}` as MessageKey)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2">
                      <StaffNote
                        value={line.note ?? ''}
                        placeholder={t('cart.note.placeholder')}
                        onSave={(note) => change({ menuItemId: line.menuItemId, course: line.course, note })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex items-center justify-between text-lg font-semibold">
            <span>{t('staff.table.total')}</span>
            <span>{formatMoney(cart.totalCents)}</span>
          </div>
        </>
      )}

      {cart && (
        <label className="block space-y-2">
          <span className="h-label">{t('cart.note.table')}</span>
          <StaffNote
            value={cart.note ?? ''}
            placeholder={t('cart.note.tablePlaceholder')}
            onSave={(note) => change({ tableNote: note })}
            multiline
          />
        </label>
      )}

      {/* Checked with the guests: it goes to the kitchen. */}
      {cart &&
        cart.lines.length > 0 &&
        (cart.pending > 0 ? (
          <button
            type="button"
            // Green, as "confirmed" is everywhere: never mistaken for the red "Paid – clear table".
            className="min-h-tap w-full rounded-xl bg-ok-500 px-4 py-4 text-base font-semibold text-white"
            onClick={async () =>
              setCart(await staffFetch<TableCart>(`${path}/confirm?lang=${locale}`, { method: 'POST' }))
            }
          >
            {t('staff.table.confirm', { count: cart.pending })}
          </button>
        ) : (
          <p className="rounded-xl bg-ok-50 p-3 text-center text-sm font-semibold text-ok-500">
            ✓ {t('staff.table.allConfirmed', { by: cart.confirmedBy ? ` · ${cart.confirmedBy}` : '' })}
          </p>
        ))}

      <AddDish
        courses={!(cart?.allAtOnce ?? false)}
        onAdd={(menuItemId, course) => change({ menuItemId, delta: 1, course })}
      />

      {cart && cart.lines.length > 0 && (
        <button
          type="button"
          className="min-h-tap w-full rounded-xl bg-danger-500 px-4 py-3 font-semibold text-white"
          onClick={async () => {
            if (!window.confirm(t('staff.table.clear.confirm', { table: tableNumber }))) return;
            await staffFetch(`${path}/clear`, { method: 'POST' });
            router.push('/staff');
          }}
        >
          {t('staff.table.clear', { table: tableNumber })}
        </button>
      )}
    </>
  );
}

/** In courses: starter, main course, dessert, drinks. All at once: food, drinks. */
function groupsOf(cart: TableCart, t: ReturnType<typeof useCustomer>['t']) {
  const food = cart.lines.filter((l) => l.kind !== 'DRINK');
  const drinks = cart.lines.filter((l) => l.kind === 'DRINK');
  const groups = cart.allAtOnce
    ? [{ key: 'food', title: `${t('course.food')} · ${t('cart.serve.allAtOnce')}`, lines: food }]
    : COURSES.map((c) => ({
        key: `c${c}`,
        title: `${c} · ${t(`course.${c}` as MessageKey)}`,
        lines: food.filter((l) => l.course === c),
      }));
  return [...groups, { key: 'drinks', title: t('course.drinks'), lines: drinks }].filter((g) => g.lines.length > 0);
}

/** A request typed by the staff, saved when they leave the field. */
function StaffNote({
  value,
  placeholder,
  onSave,
  multiline = false,
}: {
  value: string;
  placeholder: string;
  onSave: (note: string) => void;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  const props = {
    value: text,
    placeholder,
    maxLength: multiline ? 300 : 200,
    onFocus: () => setEditing(true),
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      setEditing(false);
      if (text.trim() !== value.trim()) onSave(text);
    },
    className: `w-full rounded-xl border px-3 py-2 text-sm ${
      value ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-ink/20 bg-surface'
    }`,
  };
  return multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />;
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Finds a dish by its number or name, for an order taken from the printed menu. */
function AddDish({
  courses,
  onAdd,
}: {
  courses: boolean;
  onAdd: (menuItemId: string, course: Course | undefined) => Promise<void>;
}) {
  const { t, locale } = useCustomer();
  // Undefined: the dish's own course (a starter as a starter, a dessert as a dessert).
  const [course, setCourse] = useState<Course | undefined>(undefined);
  const { categories } = useMenu(locale);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  const items = useMemo(() => (categories ?? []).flatMap((c) => c.items), [categories]);
  const found = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return [];
    return items
      .filter(
        (item: MenuItem) =>
          (item.dishNumber ?? '').startsWith(q) ||
          normalise(item.name).includes(q) ||
          normalise(item.nameVi).includes(q),
      )
      .slice(0, 25);
  }, [items, query]);

  return (
    <section className="space-y-2">
      <h2 className="h-label">{t('staff.table.add')}</h2>
      {courses && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">{t('staff.table.addTo')}</span>
          {([undefined, 1, 2, 3] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={course === value}
              onClick={() => setCourse(value)}
              className={`min-h-tap flex-1 rounded-xl border px-2 text-xs font-semibold ${
                course === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink/15 bg-surface text-ink'
              }`}
            >
              {value === undefined ? t('staff.table.addAuto') : `${value} · ${t(`course.${value}` as MessageKey)}`}
            </button>
          ))}
        </div>
      )}
      <input
        type="search"
        inputMode="search"
        placeholder={t('staff.table.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-tap w-full rounded-xl border border-ink/20 bg-surface px-4 py-3"
      />
      {found.length > 0 && (
        <ul className="card divide-y divide-ink/10">
          {found.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 p-3 text-left"
                onClick={async () => {
                  await onAdd(item.id, courses ? course : undefined);
                  setAdded(item.id);
                  window.setTimeout(() => setAdded(null), 1200);
                }}
              >
                <span className="min-w-[3.25rem] font-display font-bold text-brand-600">
                  {item.dishNumber ?? '·'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-snug">
                    {item.name}
                    {item.volume && <span className="text-ink-muted"> · {item.volume}</span>}
                  </span>
                  <span className="block text-xs text-ink-muted">{formatMoney(item.priceCents)}</span>
                </span>
                <span className="min-w-tap rounded-xl bg-brand-50 px-3 py-2 text-center text-lg font-bold text-brand-700">
                  {added === item.id ? '✓' : '+'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
