'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LOCALE, type Locale, isLocale } from '../../i18n/locales';
import { createTranslator, type Translator } from '../../i18n';
import { RESTAURANT, hasStaffScreen } from '../../config/restaurant';
import { readTableCookie } from '../../domain/table';
import { scheduledMenus, type FoodMenus } from '../../domain/menu/menus';
import { restaurantWeekday } from '../../domain/menu/saturday';

/**
 * Guest-side state: chosen language and the cart.
 *
 * Where the restaurant has a staff screen (Winterthur) and the guest scanned a
 * table card, the cart is the table's: one list on the server that every phone
 * at the table reads and changes, and that the staff see on theirs. It is read
 * again every few seconds while the page is open, and a tap shows at once.
 *
 * Elsewhere the cart lives in localStorage, so a reload, an accidental tab
 * close or a phone locking itself mid-meal does not lose it, and it is a list
 * for the guest to show the waiter.
 *
 * Either way, nothing reaches the kitchen: the waiter takes the order at the
 * table and keys it into the POS.
 */
export type Course = 1 | 2 | 3;

export interface CartLine {
  readonly menuItemId: string;
  readonly name: string;
  readonly dishNumber: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
  /** 1 starter, 2 main course, 3 dessert; a cart on this phone only, and drinks, are 1. */
  readonly course?: Course;
  /** Known for a table's shared cart, which shows drinks apart. */
  readonly kind?: 'FOOD' | 'DRINK';
  /** How many the staff have confirmed (sent to the kitchen); a shared cart only. */
  readonly confirmedQuantity?: number;
  /** A special request for this dish. */
  readonly note?: string | null;
}

const courseOf = (line: { course?: Course }): Course => line.course ?? 1;

interface CustomerState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  cart: CartLine[];
  addToCart: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  setQuantity: (menuItemId: string, quantity: number, course?: Course) => void;
  removeFromCart: (menuItemId: string, course?: Course) => void;
  /** Moves a dish, all of it, to the other course (a table's shared cart only). */
  moveToCourse: (menuItemId: string, from: Course, to: Course) => void;
  /** The table wants everything at once rather than in courses. */
  allAtOnce: boolean;
  setAllAtOnce: (allAtOnce: boolean) => void;
  /** A special request for one dish, or for the whole table (shared cart only). */
  setLineNote: (menuItemId: string, course: Course, note: string) => void;
  tableNote: string | null;
  setTableNote: (note: string) => void;
  /** Items waiting for the staff to confirm them. */
  pending: number;
  clearCart: () => void;
  /** How many of one dish are in the cart, for the badge on its add button. */
  quantityOf: (menuItemId: string) => number;
  cartCount: number;
  cartTotalCents: number;
  /** The table whose shared cart this is, or null for a cart on this phone only. */
  sharedTable: string | null;
  /**
   * The food menus this guest sees: the table's, as the staff set it or the
   * day's schedule gives it (Winterthur), else everything served today.
   */
  foodMenus: FoodMenus;
}

const Context = createContext<CustomerState | null>(null);

const LOCALE_KEY = 'aw.locale';
const CART_KEY = 'aw.cart';
/** How often a phone looks for what others at the table have added. */
const SHARED_CART_POLL_MS = 4000;

interface ServerCart {
  allAtOnce: boolean;
  menus: FoodMenus;
  note: string | null;
  pending: number;
  lines: {
    menuItemId: string;
    name: string;
    dishNumber: string | null;
    unitPriceCents: number;
    quantity: number;
    course: Course;
    kind: 'FOOD' | 'DRINK';
    confirmedQuantity: number;
    note: string | null;
  }[];
}

function fromServer(cart: ServerCart): CartLine[] {
  return cart.lines.map((l) => ({
    menuItemId: l.menuItemId,
    name: l.name,
    dishNumber: l.dishNumber,
    unitPriceCents: l.unitPriceCents,
    quantity: l.quantity,
    course: l.course,
    kind: l.kind,
    confirmedQuantity: l.confirmedQuantity,
    note: l.note,
  }));
}

type CartChange =
  | { menuItemId: string; delta: number; course?: Course }
  | { menuItemId: string; quantity: number; course?: Course }
  | { menuItemId: string; from: Course; to: Course }
  | { menuItemId: string; course: Course; note: string }
  | { allAtOnce: boolean }
  | { tableNote: string };

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Private mode, blocked storage, or corrupt data: carry on without it.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience here, never a requirement.
  }
}

export function CustomerProvider({
  children,
  guestCart = true,
}: {
  children: ReactNode;
  /** False on the staff screens: a staff phone that once scanned a card is not a guest. */
  guestCart?: boolean;
}) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sharedTable, setSharedTable] = useState<string | null>(null);
  const [allAtOnce, setAllAtOnceState] = useState(false);
  // From the schedule at once, so the tabs are right before the server answers;
  // the server's answer (which knows what the staff set) then takes over.
  const [foodMenus, setFoodMenus] = useState<FoodMenus>('BOTH');
  const [tableNote, setTableNoteState] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const storedLocale = read<string>(LOCALE_KEY, DEFAULT_LOCALE);
    if (isLocale(storedLocale)) {
      setLocaleState(storedLocale);
      document.documentElement.lang = storedLocale;
    }
    const cardTable = readTableCookie(document.cookie);
    setFoodMenus(scheduledMenus(cardTable, RESTAURANT.menuSchedule, restaurantWeekday()));
    if (!guestCart) {
      setHydrated(true);
      return;
    }
    // This phone's own cart first; the table's shared cart once the server
    // confirms the table, which then takes this cart over (below). A table the
    // restaurant does not have (an old or mistyped link) stays a cart on this
    // phone, as where there is no staff screen.
    setCart(read<CartLine[]>(CART_KEY, []));
    setHydrated(true);
    const table = hasStaffScreen() ? readTableCookie(document.cookie) : null;
    if (!table) return;
    fetch(`/api/table/${encodeURIComponent(table)}/cart`, { cache: 'no-store' })
      .then((response) => {
        if (response.status !== 404) setSharedTable(table);
      })
      .catch(() => setSharedTable(table));
  }, [guestCart]);

  // A cart on this phone only is kept on this phone.
  useEffect(() => {
    if (hydrated && !sharedTable && guestCart) write(CART_KEY, cart);
  }, [cart, hydrated, sharedTable, guestCart]);

  // --- the table's shared cart -------------------------------------------
  // A read that started before the latest change on this phone is stale by the
  // time it lands, and is dropped; so is any read while a change is in flight.
  const changes = useRef(0);
  const inFlight = useRef(0);
  const apply = (data: ServerCart) => {
    setCart(fromServer(data));
    setAllAtOnceState(data.allAtOnce);
    setTableNoteState(data.note);
    setPending(data.pending);
  };

  const refresh = useCallback(async () => {
    if (!sharedTable) return;
    const seen = changes.current;
    try {
      const response = await fetch(`/api/table/${encodeURIComponent(sharedTable)}/cart?lang=${locale}`, {
        cache: 'no-store',
      });
      // A table the restaurant does not have (an old or mistyped link): this
      // phone keeps its own cart, as where there is no staff screen.
      if (response.status === 404) {
        setSharedTable(null);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as ServerCart;
      setFoodMenus(data.menus);
      if (seen === changes.current && inFlight.current === 0) apply(data);
    } catch {
      // Offline for a moment: keep showing the last list.
    }
  }, [sharedTable, locale]);

  const send = useCallback(
    async (change: CartChange) => {
      if (!sharedTable) return;
      changes.current += 1;
      inFlight.current += 1;
      try {
        const response = await fetch(
          `/api/table/${encodeURIComponent(sharedTable)}/cart?lang=${locale}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(change),
          },
        );
        inFlight.current -= 1;
        if (response.ok && inFlight.current === 0) {
          const data = (await response.json()) as ServerCart;
          apply(data);
          setFoodMenus(data.menus);
        } else if (!response.ok) await refresh();
      } catch {
        inFlight.current -= 1;
        await refresh();
      }
    },
    [sharedTable, locale, refresh],
  );

  // Moves a cart started on this phone, before the card was scanned, onto the
  // table's list, once.
  useEffect(() => {
    if (!sharedTable) return;
    const local = read<CartLine[]>(CART_KEY, []);
    write(CART_KEY, []);
    void (async () => {
      for (const line of local) await send({ menuItemId: line.menuItemId, delta: line.quantity });
      await refresh();
    })();
    // Only when the table is first known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTable]);

  useEffect(() => {
    if (!sharedTable) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, SHARED_CART_POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sharedTable, refresh]);

  // Keeps the pages, photos and menu a guest has seen on the phone, so a weak
  // signal at the table does not blank the menu (public/sw.js). Production
  // only: in development it would keep serving yesterday's code.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    write(LOCALE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  // A dish added from the menu starts in its own course (a starter as a
  // starter, a dessert as a dessert): the server decides, and the cart shows
  // it as soon as the server answers.
  const addToCart = useCallback(
    (line: Omit<CartLine, 'quantity'>, quantity = 1) => {
      setCart((current) => {
        const same = (l: CartLine) => l.menuItemId === line.menuItemId && (!sharedTable || !l.confirmedQuantity);
        const existing = current.find(same);
        if (existing) {
          return current.map((l) => (l === existing ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l));
        }
        return [...current, { ...line, quantity: Math.min(99, quantity) }];
      });
      void send({ menuItemId: line.menuItemId, delta: quantity });
    },
    [send, sharedTable],
  );

  const setQuantity = useCallback(
    (menuItemId: string, quantity: number, course: Course = 1) => {
      const same = (l: CartLine) => l.menuItemId === menuItemId && courseOf(l) === course;
      setCart((current) =>
        quantity <= 0
          ? current.filter((l) => !same(l))
          : current.map((l) => (same(l) ? { ...l, quantity: Math.min(99, quantity) } : l)),
      );
      void send({ menuItemId, quantity: Math.max(0, Math.min(99, quantity)), course });
    },
    [send],
  );

  const removeFromCart = useCallback(
    (menuItemId: string, course: Course = 1) => {
      setCart((current) => current.filter((l) => !(l.menuItemId === menuItemId && courseOf(l) === course)));
      void send({ menuItemId, quantity: 0, course });
    },
    [send],
  );

  const moveToCourse = useCallback(
    (menuItemId: string, from: Course, to: Course) => {
      if (!sharedTable || from === to) return;
      setCart((current) => {
        const moving = current.find((l) => l.menuItemId === menuItemId && courseOf(l) === from);
        if (!moving) return current;
        const rest = current.filter((l) => l !== moving);
        const there = rest.find((l) => l.menuItemId === menuItemId && courseOf(l) === to);
        return there
          ? rest.map((l) => (l === there ? { ...l, quantity: Math.min(99, l.quantity + moving.quantity) } : l))
          : [...rest, { ...moving, course: to }];
      });
      void send({ menuItemId, from, to });
    },
    [send, sharedTable],
  );

  const setLineNote = useCallback(
    (menuItemId: string, course: Course, note: string) => {
      if (!sharedTable) return;
      setCart((current) =>
        current.map((l) => (l.menuItemId === menuItemId && courseOf(l) === course ? { ...l, note } : l)),
      );
      void send({ menuItemId, course, note });
    },
    [send, sharedTable],
  );

  const setTableNote = useCallback(
    (note: string) => {
      if (!sharedTable) return;
      setTableNoteState(note);
      void send({ tableNote: note });
    },
    [send, sharedTable],
  );

  const setAllAtOnce = useCallback(
    (value: boolean) => {
      if (!sharedTable) return;
      setAllAtOnceState(value);
      void send({ allAtOnce: value });
    },
    [send, sharedTable],
  );

  // A shared cart is the whole table's: one guest cannot empty it for everyone.
  // The staff clear it once the table has paid.
  const clearCart = useCallback(() => {
    if (!sharedTable) setCart([]);
  }, [sharedTable]);

  const quantityOf = useCallback(
    (menuItemId: string) =>
      cart.filter((l) => l.menuItemId === menuItemId).reduce((n, l) => n + l.quantity, 0),
    [cart],
  );

  const value = useMemo<CustomerState>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
      cart,
      addToCart,
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
      quantityOf,
      cartCount: cart.reduce((n, l) => n + l.quantity, 0),
      cartTotalCents: cart.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0),
      sharedTable,
      foodMenus,
    }),
    [
      locale,
      setLocale,
      cart,
      addToCart,
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
      quantityOf,
      sharedTable,
      foodMenus,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCustomer(): CustomerState {
  const context = useContext(Context);
  if (!context) throw new Error('useCustomer must be used inside CustomerProvider');
  return context;
}
