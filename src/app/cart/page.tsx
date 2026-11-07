'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCustomer, type CartLine, type Course } from '../../components/customer/CustomerProvider';
import { GuestJourney, PayPrompt } from '../../components/customer/GuestJourney';
import { formatMoney } from '../../lib/format';
import type { MessageKey } from '../../i18n';

const COURSES: readonly Course[] = [1, 2, 3];

/**
 * The guest's cart.
 *
 * At a table with a staff screen it is the table's shared list: each dish is a
 * starter, a main course or a dessert (drinks apart), with a special request
 * if wanted, and one for the whole table. The staff come to the table, check
 * it and confirm it; confirmed dishes go to the kitchen and from then on only
 * the staff change them. Dish numbers are printed large: they are what the
 * staff type into the POS.
 *
 * Elsewhere it is a list on this phone, to show the waiter.
 */
export default function CartPage() {
  const {
    t,
    cart,
    setQuantity,
    removeFromCart,
    moveToCourse,
    allAtOnce,
    setAllAtOnce,
    setLineNote,
    tableNote,
    setTableNote,
    pending,
    clearCart,
    cartTotalCents,
    sharedTable,
  } = useCustomer();
  const router = useRouter();

  if (cart.length === 0) {
    return (
      <div className="space-y-4">
        <GuestJourney current={1} t={t} />
        <h1 className="h-section">{t('cart.title')}</h1>
        <p className="card p-4 text-sm text-ink-muted">{t('cart.empty')}</p>
        <Link href="/menu" className="btn-primary w-full">
          {t('cart.browse')}
        </Link>
        <PayPrompt t={t} />
      </div>
    );
  }

  // In courses: starter, main course, dessert, then drinks. All at once, or a
  // cart on this phone only: food, then drinks.
  const inCourses = Boolean(sharedTable) && !allAtOnce;
  const food = cart.filter((l) => l.kind !== 'DRINK');
  const drinks = cart.filter((l) => l.kind === 'DRINK');
  const groups: { key: string; title: string | null; lines: CartLine[] }[] = !sharedTable
    ? [{ key: 'all', title: null, lines: cart }]
    : [
        ...(inCourses
          ? COURSES.map((c) => ({
              key: `c${c}`,
              title: t(`course.${c}` as MessageKey),
              lines: food.filter((l) => (l.course ?? 1) === c),
            }))
          : [{ key: 'food', title: t('course.food'), lines: food }]),
        { key: 'drinks', title: t('course.drinks'), lines: drinks },
      ].filter((g) => g.lines.length > 0);
  const anyConfirmed = cart.some((l) => (l.confirmedQuantity ?? 0) > 0);

  return (
    <div className="space-y-4">
      <GuestJourney current={2} t={t} />
      <h1 className="h-section">{t('cart.title')}</h1>

      {/* Where the order stands: waiting for the staff, or on its way. */}
      <div className="border-l-4 border-brand-600 bg-brand-50 p-3 text-sm text-ink">
        {sharedTable ? (
          pending > 0 || !anyConfirmed ? (
            <>
              <p className="font-semibold">{t('cart.shared.title', { table: sharedTable })}</p>
              <p className="mt-0.5">{t('cart.status.waiting', { count: Math.max(pending, 1) })}</p>
            </>
          ) : (
            <p className="font-semibold">{t('cart.status.confirmed')}</p>
          )
        ) : (
          <>
            <p className="font-semibold">{t('cart.waiter.title')}</p>
            <p className="mt-0.5">{t('cart.waiter.body')}</p>
          </>
        )}
      </div>

      {sharedTable && (
        <fieldset className="space-y-2">
          <legend className="h-label">{t('cart.serve.title')}</legend>
          <div className="flex gap-2">
            {([false, true] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={allAtOnce === value}
                onClick={() => setAllAtOnce(value)}
                className={`min-h-tap flex-1 rounded-xl border px-3 text-sm font-semibold ${
                  allAtOnce === value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink/15 bg-surface text-ink'
                }`}
              >
                {value ? t('cart.serve.allAtOnce') : t('cart.serve.courses')}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-muted">
            {allAtOnce ? t('cart.serve.allHint') : t('cart.serve.coursesHint')}
          </p>
        </fieldset>
      )}

      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          {group.title && <h2 className="h-label">{group.title}</h2>}
          <ul className="card divide-y divide-ink/10">
            {group.lines.map((line) => (
              <Line
                key={`${line.menuItemId}:${line.course ?? 1}`}
                line={line}
                shared={Boolean(sharedTable)}
                inCourses={inCourses}
                onQuantity={(q) => setQuantity(line.menuItemId, q, line.course)}
                onRemove={() => removeFromCart(line.menuItemId, line.course)}
                onCourse={(to) => moveToCourse(line.menuItemId, line.course ?? 1, to)}
                onNote={(note) => setLineNote(line.menuItemId, line.course ?? 1, note)}
              />
            ))}
          </ul>
        </section>
      ))}

      {sharedTable && <TableNote value={tableNote} onSave={setTableNote} />}

      <div className="flex items-center justify-between text-lg font-semibold">
        <span>{t('cart.total')}</span>
        <span>{formatMoney(cartTotalCents)}</span>
      </div>
      <p className="text-xs text-ink-muted">{t('menu.vatNote')}</p>

      {/* Back to whichever menu, classic or modern, the guest came from. */}
      <button
        type="button"
        className="btn-primary w-full"
        onClick={() => (window.history.length > 1 ? router.back() : router.push('/menu'))}
      >
        {t('cart.continue')}
      </button>
      <PayPrompt t={t} />

      {/* A table's shared cart is everyone's: the staff clear it after paying. */}
      {!sharedTable && (
        <button
          type="button"
          className="min-h-tap w-full text-sm text-ink-muted underline underline-offset-4"
          onClick={() => {
            if (window.confirm(t('cart.clear.confirm'))) clearCart();
          }}
        >
          {t('cart.clear')}
        </button>
      )}
    </div>
  );
}

function Line({
  line,
  shared,
  inCourses,
  onQuantity,
  onRemove,
  onCourse,
  onNote,
}: {
  line: CartLine;
  shared: boolean;
  inCourses: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onCourse: (course: Course) => void;
  onNote: (note: string) => void;
}) {
  const { t } = useCustomer();
  const confirmed = shared ? (line.confirmedQuantity ?? 0) : 0;
  const waiting = line.quantity - confirmed;
  // A confirmed dish is the staff's to change: the guest can add more of it.
  const locked = confirmed > 0;

  return (
    <li className="space-y-2 p-3">
      <div className="flex items-start gap-3">
        {line.dishNumber && (
          <span className="min-w-[3.25rem] shrink-0 font-display text-xl font-bold text-brand-600">
            {line.dishNumber}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{line.name}</p>
          <p className="text-sm text-ink-muted">{formatMoney(line.unitPriceCents)}</p>
          {shared && confirmed > 0 && (
            <p className="text-xs font-semibold text-ok-500">{t('cart.confirmed', { count: confirmed })}</p>
          )}
          {shared && waiting > 0 && confirmed > 0 && (
            <p className="text-xs font-semibold text-brand-700">{t('cart.waiting', { count: waiting })}</p>
          )}
        </div>
        <p className="font-semibold">{formatMoney(line.unitPriceCents * line.quantity)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label={`− ${line.name}`}
          disabled={waiting <= 0}
          className="btn-secondary min-w-tap px-3 disabled:opacity-40"
          onClick={() => onQuantity(line.quantity - 1)}
        >
          −
        </button>
        <span className="min-w-8 text-center font-semibold" aria-live="polite">
          {line.quantity}
        </span>
        <button
          type="button"
          aria-label={`+ ${line.name}`}
          className="btn-secondary min-w-tap px-3"
          onClick={() => onQuantity(line.quantity + 1)}
        >
          +
        </button>
        {waiting > 0 && !locked && (
          <button type="button" className="ml-auto min-h-tap px-2 text-sm text-danger-500" onClick={onRemove}>
            {t('cart.remove')}
          </button>
        )}
      </div>

      {/* Starter, main course or dessert: the guest's choice until confirmed. */}
      {inCourses && line.kind !== 'DRINK' && !locked && (
        <div className="flex items-center gap-2" role="group" aria-label={t('cart.course.label')}>
          {COURSES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={(line.course ?? 1) === c}
              onClick={() => (line.course ?? 1) !== c && onCourse(c)}
              className={`min-h-tap flex-1 rounded-xl border px-2 text-xs font-semibold ${
                (line.course ?? 1) === c
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink/15 bg-surface text-ink'
              }`}
            >
              {c} · {t(`course.${c}` as MessageKey)}
            </button>
          ))}
        </div>
      )}

      {shared &&
        (locked ? (
          line.note && <p className="text-sm italic text-ink-muted">“{line.note}”</p>
        ) : (
          <NoteField value={line.note ?? ''} placeholder={t('cart.note.placeholder')} onSave={onNote} />
        ))}
    </li>
  );
}

/** A request typed by a guest, saved when they leave the field. */
function NoteField({
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
  // What others at the table (or the staff) wrote shows, unless the guest is typing.
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
    className: 'w-full rounded-xl border border-ink/20 bg-surface px-3 py-2 text-sm',
  };
  return multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />;
}

function TableNote({ value, onSave }: { value: string | null; onSave: (note: string) => void }) {
  const { t } = useCustomer();
  return (
    <label className="block space-y-2">
      <span className="h-label">{t('cart.note.table')}</span>
      <NoteField value={value ?? ''} placeholder={t('cart.note.tablePlaceholder')} onSave={onSave} multiline />
    </label>
  );
}
