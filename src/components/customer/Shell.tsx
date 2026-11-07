'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useCustomer } from './CustomerProvider';
import { readTableCookie } from '../../domain/table';
import { RESTAURANT } from '../../config/restaurant';
import { LOCALE_LABELS, LOCALES, type Locale } from '../../i18n/locales';
import { formatMoney } from '../../lib/format';

/**
 * The guest shell: a compact header with the table and language, and the cart
 * within thumb reach at the bottom.
 *
 * Designed for one-handed use on a phone — every target is at least 44px, and
 * the cart is reachable from every menu screen without scrolling.
 *
 * The classic menu is a book that fills the screen and turns its own pages, so
 * there the frame is exactly one screen tall and the cart bar sits in the flow
 * under it rather than floating over a page.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale, cartCount, cartTotalCents } = useCustomer();
  const pathname = usePathname();
  const [table, setTable] = useState<string | null>(null);

  // Set by the link on the table card; without one the header just has no table.
  useEffect(() => setTable(readTableCookie(document.cookie)), []);

  const immersive = pathname === '/menu/classic';
  // Not on the cart itself, nor once the guest is paying, and not on a dish's
  // own page: its add bar sits in the same place, and the cart bar would cover
  // the very button the guest came to press.
  const showCartBar =
    cartCount > 0 &&
    pathname !== '/cart' &&
    pathname !== '/pay' &&
    !(pathname.startsWith('/menu/') && !['/menu/classic', '/menu/modern'].includes(pathname));

  const cartBar = showCartBar && (
    <Link href="/cart" className="btn-primary flex w-full items-center justify-between shadow-lg">
      <span className="flex items-center gap-2">
        {CART_ICON}
        {t('nav.cart')} · {cartCount}
      </span>
      <span>{formatMoney(cartTotalCents)}</span>
    </Link>
  );

  return (
    <div
      className={`guest-frame mx-auto flex max-w-md flex-col ${
        immersive ? 'h-[100dvh] overflow-hidden bg-book-table' : 'min-h-screen'
      }`}
    >
      <header
        className="sticky top-0 z-30 shrink-0 border-b border-ink/10 bg-surface/95 px-4 backdrop-blur"
        style={{ height: 'var(--guest-header)', paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-full items-center justify-between gap-3">
          <Link href="/menu" className="flex min-h-tap min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/asiaway-logo.png" alt={t('app.name')} className="h-7 w-auto" />
            {table && (
              <span className="truncate text-sm font-medium text-ink-muted">
                {t('table.label', { table })}
              </span>
            )}
          </Link>
          <label className="sr-only" htmlFor="lang">
            {t('lang.choose')}
          </label>
          <select
            id="lang"
            className="min-h-tap rounded-xl border border-ink/20 bg-surface px-3 py-2 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* On every guest page: where the toilets are and their door code. */}
      {RESTAURANT.toilet && (
        <p
          role="note"
          className="shrink-0 border-b border-ink/10 bg-brand-50 px-4 py-1.5 text-center text-xs text-ink"
        >
          {/* The code in bold: the words around it come from the translation. */}
          {t('toilet.notice', RESTAURANT.toilet)
            .split(RESTAURANT.toilet.code)
            .flatMap((part, i) => (i === 0 ? [part] : [<b key={i} className="font-bold tracking-wide">{RESTAURANT.toilet!.code}</b>, part]))}
        </p>
      )}

      {immersive ? (
        <>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          {cartBar && (
            <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
              {cartBar}
            </div>
          )}
        </>
      ) : (
        <>
          <main
            className="flex-1 px-4 pt-4"
            style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
          >
            {children}
          </main>
          {cartBar && (
            <div
              className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-4 pt-2"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              {cartBar}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A line-drawn tray, drawn in the text colour. */
const CART_ICON = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </svg>
);
