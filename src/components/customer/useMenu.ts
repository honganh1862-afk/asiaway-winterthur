'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { menuTabFor, type FoodMenus, type MenuTab } from '../../domain/menu/menus';
import { useCustomer } from './CustomerProvider';
import type { Locale } from '../../i18n/locales';
import type { Translator } from '../../i18n';

export interface MenuItem {
  id: string;
  dishNumber: string | null;
  volume: string | null;
  name: string;
  /** The dish's Vietnamese name, printed under the translated one in the classic menu. */
  nameVi: string;
  description: string;
  priceCents: number;
  allergenCodes: string[];
  imagePath: string | null;
  isAvailable: boolean;
}

export interface Category {
  id: string;
  slug: string;
  kind: 'FOOD' | 'DRINK';
  name: string;
  items: MenuItem[];
}

/**
 * The guest menu in the guest's language, shared by the classic and the modern
 * view so both always show the same dishes and prices.
 *
 * The last copy is kept for the visit, so moving between the views, opening a
 * dish and coming back, or a weak signal for a moment never leaves the guest
 * looking at an empty page: the copy shows at once, and a fresh one replaces it
 * when it arrives. The menu only changes when the restaurant loads it again, so
 * it is fetched once per screen rather than polled.
 */
export function useMenu(locale: Locale) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState(false);

  // The page opens in the default language and switches to the guest's saved
  // one a moment later, so two loads can be in flight. Only the latest may land:
  // otherwise a German screen could end up listing English dishes.
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    const kept = readKeptMenu(locale);
    setError(false);
    setCategories(kept);
    fetch(`/api/menu?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
      .then((data) => {
        if (request !== latest.current) return;
        setCategories(data.categories);
        keepMenu(locale, data.categories);
      })
      // With a copy on screen, a failed refresh is not worth an error.
      .catch(() => request === latest.current && !kept && setError(true));
  }, [locale]);

  useEffect(load, [load]);

  return { categories, error, reload: load };
}

const keptKey = (locale: Locale) => `aw.menu.${locale}`;

function readKeptMenu(locale: Locale): Category[] | null {
  try {
    const raw = window.sessionStorage.getItem(keptKey(locale));
    return raw ? (JSON.parse(raw) as Category[]) : null;
  } catch {
    return null;
  }
}

function keepMenu(locale: Locale, categories: Category[]): void {
  try {
    window.sessionStorage.setItem(keptKey(locale), JSON.stringify(categories));
  } catch {
    // Full or blocked storage: the next screen simply fetches again.
  }
}

/**
 * The food menus this guest sees (Winterthur: by table and weekday, or as the
 * staff set the table), held by CustomerProvider.
 */
export function useFoodMenus(): FoodMenus {
  return useCustomer().foodMenus;
}

/**
 * The tabs a guest sees. Where both printed menus are served (Winterthur) each
 * gets its own: Vietnamesisch · Thai, or just the one the table is given. Then
 * the desserts, for every table, and the drinks. Elsewhere it stays
 * Speisen · Getränke.
 */
export function menuTabs(
  categories: Category[] | null,
  t: Translator,
  menus: FoodMenus = 'BOTH',
): { id: MenuTab; label: string }[] {
  const has = (tab: MenuTab) => (categories ?? []).some((c) => menuTabFor(c) === tab);
  const food: { id: MenuTab; label: string }[] = !has('THAI')
    ? [{ id: 'FOOD', label: t('menu.food') }]
    : [
        ...(menus !== 'THAI' ? [{ id: 'FOOD' as const, label: t('menu.vietnamese') }] : []),
        ...(menus !== 'VIETNAMESE' ? [{ id: 'THAI' as const, label: t('menu.thai') }] : []),
      ];
  return [
    ...food,
    ...(has('DESSERT') ? [{ id: 'DESSERT' as const, label: t('menu.desserts') }] : []),
    { id: 'DRINK', label: t('menu.drinks') },
  ];
}

/** The tab to open: the one the guest last had, if this table has it, else the first. */
export function openTab(chosen: MenuTab, tabs: readonly { id: MenuTab }[]): MenuTab {
  return tabs.some((x) => x.id === chosen) ? chosen : tabs[0]!.id;
}

/** The tab a guest last had open, kept for the visit so switching views keeps their place. */
const TAB_KEY = 'aw.menuTab';

export function readMenuTab(): MenuTab {
  try {
    const stored = window.sessionStorage.getItem(TAB_KEY);
    if (stored === 'FOOD' || stored === 'THAI' || stored === 'DESSERT' || stored === 'DRINK') return stored;
  } catch {
    // Blocked storage: start on the first tab.
  }
  return 'FOOD';
}

export function writeMenuTab(tab: MenuTab): void {
  try {
    window.sessionStorage.setItem(TAB_KEY, tab);
  } catch {
    // A convenience only.
  }
}
