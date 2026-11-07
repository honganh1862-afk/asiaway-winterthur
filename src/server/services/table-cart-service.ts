import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { generateQrToken } from '../../domain/session/qr-token';
import { isTableNumber } from '../../domain/table';
import {
  FOOD_MENUS,
  defaultCourse,
  scheduledMenus,
  type Course,
  type FoodMenus,
  type MenuSchedule,
} from '../../domain/menu/menus';
import { restaurantWeekday } from '../../domain/menu/saturday';
import { RESTAURANT } from '../../config/restaurant';
import type { Locale } from '../../i18n/locales';
import type { AppDatabase as Db } from '../db/client';
import { menuCategories, menuItems, restaurantTables, tableCartLines, tableCarts } from '../db/schema';

/**
 * One shared cart per table.
 *
 * Every phone that scans a table's card reads and changes the same list, and
 * the staff see it on their phones. A guest adds a dish with +, chooses its
 * course in the cart (1 starter, 2 main course, 3 dessert; drinks have none)
 * and may type a special request for a dish or for the whole table. The staff
 * come to the table, check the list, change what is needed (and type requests
 * for guests ordering from the printed card), then confirm it: confirmed is
 * what goes to the kitchen. Clearing the table after paying closes the cart
 * (who and when are kept) and the table's next guests start a new one.
 *
 * Confirmation is kept per line as a confirmed quantity. What is above it is
 * new and waits; a guest can add to a line but never take it below what is
 * confirmed, nor move or re-word a confirmed dish. The staff can change
 * anything, and confirm again.
 *
 * Changes are made line by line, each a single statement, so two guests
 * tapping at the same moment both count rather than one overwriting the other.
 */

/** Who changed a line: a guest's phone, or the member of staff by name. */
export type CartActor = 'guest' | { staff: string };

export const MAX_NOTE = 200;

export interface TableCartLine {
  readonly menuItemId: string;
  readonly dishNumber: string | null;
  readonly name: string;
  readonly nameVi: string;
  readonly volume: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
  /** How many of them the staff have confirmed; the rest wait. */
  readonly confirmedQuantity: number;
  readonly isAvailable: boolean;
  /** 'guest', or the name of the member of staff who last changed the line. */
  readonly changedBy: string;
  readonly course: Course;
  readonly kind: 'FOOD' | 'DRINK';
  /** A special request for this dish, or null. */
  readonly note: string | null;
}

export interface TableCart {
  readonly tableNumber: string;
  readonly lines: TableCartLine[];
  readonly count: number;
  readonly totalCents: number;
  /** When the cart last changed; null for a table with no open cart. */
  readonly updatedAt: string | null;
  /** Everything served at once: no course held back. */
  readonly allAtOnce: boolean;
  /** A special request for the whole table, or null. */
  readonly note: string | null;
  /** Items waiting for the staff's confirmation (plus 1 for a new table request). */
  readonly pending: number;
  readonly confirmedAt: string | null;
  readonly confirmedBy: string | null;
  /** The food menus this table's guests see now: staff's choice, else the schedule. */
  readonly menus: FoodMenus;
  /** What the day's schedule gives this table, whatever staff chose. */
  readonly scheduledMenus: FoodMenus;
  /** The menus staff set for this table, or null for the schedule. */
  readonly menuOverride: FoodMenus | null;
}

function isFoodMenus(value: unknown): value is FoodMenus {
  return typeof value === 'string' && (FOOD_MENUS as readonly string[]).includes(value);
}

/** Staff's choice for the table, else what the schedule gives it today. */
function menusOf(
  table: { tableNumber: string; menuOverride: string | null },
  now: Date,
  schedule: MenuSchedule | null,
) {
  const scheduled = scheduledMenus(table.tableNumber, schedule, restaurantWeekday(now));
  const override = isFoodMenus(table.menuOverride) ? table.menuOverride : null;
  return { menus: override ?? scheduled, scheduledMenus: scheduled, menuOverride: override };
}

export const MAX_QUANTITY = 99;

function actorName(actor: CartActor): string {
  return actor === 'guest' ? 'guest' : actor.staff;
}

function localised(row: { nameEn: string; nameDe: string; nameVi: string }, locale: Locale): string {
  return locale === 'de' ? row.nameDe : locale === 'vi' ? row.nameVi : row.nameEn;
}

/** A request as typed: trimmed, at most MAX_NOTE characters, or null when blank. */
export function cleanNote(note: string | null | undefined, max = MAX_NOTE): string | null {
  const text = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text.length > 0 ? text : null;
}

function asCourse(value: number): Course {
  return value === 2 ? 2 : value === 3 ? 3 : 1;
}

async function activeTable(db: Db, tableNumber: string) {
  if (!isTableNumber(tableNumber)) throw domainError('TABLE_NOT_FOUND', 'No such table');
  const [table] = await db
    .select()
    .from(restaurantTables)
    .where(and(eq(restaurantTables.tableNumber, tableNumber), eq(restaurantTables.isActive, true)));
  if (!table) throw domainError('TABLE_NOT_FOUND', 'No such table', { tableNumber });
  return table;
}

async function openCartId(db: Db, tableId: string): Promise<string | null> {
  const [cart] = await db
    .select({ id: tableCarts.id })
    .from(tableCarts)
    .where(and(eq(tableCarts.tableId, tableId), isNull(tableCarts.clearedAt)));
  return cart?.id ?? null;
}

/** Opens the table's cart if it has none, and returns its id. */
async function ensureCart(tx: Db, tableId: string): Promise<string> {
  // The partial unique index allows one open cart per table: a second phone
  // opening it at the same moment finds the first one's.
  await tx.insert(tableCarts).values({ tableId }).onConflictDoNothing();
  return (await openCartId(tx, tableId))!;
}

export async function getTableCart(
  db: Db,
  tableNumber: string,
  locale: Locale,
  /** For tests: the moment, and the restaurant's schedule. */
  options: { now?: Date; schedule?: MenuSchedule | null } = {},
): Promise<TableCart> {
  const table = await activeTable(db, tableNumber);
  const menus = menusOf(table, options.now ?? new Date(), options.schedule ?? RESTAURANT.menuSchedule);
  const [cart] = await db
    .select()
    .from(tableCarts)
    .where(and(eq(tableCarts.tableId, table.id), isNull(tableCarts.clearedAt)));
  if (!cart) {
    return {
      tableNumber,
      lines: [],
      count: 0,
      totalCents: 0,
      updatedAt: null,
      allAtOnce: false,
      note: null,
      pending: 0,
      confirmedAt: null,
      confirmedBy: null,
      ...menus,
    };
  }

  const rows = await db
    .select({ line: tableCartLines, item: menuItems, kind: menuCategories.kind })
    .from(tableCartLines)
    .innerJoin(menuItems, eq(menuItems.id, tableCartLines.menuItemId))
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(eq(tableCartLines.cartId, cart.id))
    .orderBy(asc(tableCartLines.course), asc(tableCartLines.addedAt), asc(menuItems.sortOrder));

  const lines = rows
    .filter(({ line }) => line.quantity > 0)
    .map(({ line, item, kind }) => ({
      menuItemId: item.id,
      dishNumber: item.dishNumber,
      name: localised(item, locale),
      nameVi: item.nameVi,
      volume: item.volume,
      unitPriceCents: item.priceCents,
      quantity: line.quantity,
      confirmedQuantity: Math.min(line.confirmedQuantity, line.quantity),
      isAvailable: item.isAvailable,
      changedBy: line.changedBy,
      course: asCourse(line.course),
      kind,
      note: line.note,
    }));

  const newRequest = (cart.note ?? null) !== (cart.confirmedNote ?? null) && cart.note !== null;
  return {
    tableNumber,
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    totalCents: lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0),
    updatedAt: cart.updatedAt.toISOString(),
    allAtOnce: cart.allAtOnce,
    note: cart.note,
    pending: lines.reduce((n, l) => n + l.quantity - l.confirmedQuantity, 0) + (newRequest ? 1 : 0),
    confirmedAt: cart.confirmedAt?.toISOString() ?? null,
    confirmedBy: cart.confirmedBy,
    ...menus,
  };
}

export type CartChange =
  /** Adds (or takes away) some of a dish; no course = the dish's own default. */
  | { readonly menuItemId: string; readonly delta: number; readonly course?: Course }
  | { readonly menuItemId: string; readonly quantity: number; readonly course?: Course }
  /** Moves a dish, all of it, to another course. */
  | { readonly menuItemId: string; readonly from: Course; readonly to: Course }
  /** A special request for one dish in one course; empty removes it. */
  | { readonly menuItemId: string; readonly course: Course; readonly note: string };

/**
 * Adds to, takes from, sets, moves or annotates one line of a table's cart,
 * opening the cart if the table has none. A guest cannot add a dish that is
 * sold out (the staff can, since they are the ones who know), nor change what
 * the staff have already confirmed.
 */
export async function changeCartLine(db: Db, tableNumber: string, change: CartChange, actor: CartActor) {
  const table = await activeTable(db, tableNumber);
  const by = actorName(actor);
  const guest = actor === 'guest';

  const [item] = await db
    .select({
      id: menuItems.id,
      isActive: menuItems.isActive,
      isAvailable: menuItems.isAvailable,
      kind: menuCategories.kind,
      slug: menuCategories.slug,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(eq(menuItems.id, change.menuItemId));
  if (!item || !item.isActive) throw domainError('ITEMS_UNAVAILABLE', 'No such dish on the menu');

  const adding = 'delta' in change ? change.delta > 0 : 'quantity' in change ? change.quantity > 0 : false;
  if (adding && guest && !item.isAvailable) {
    throw domainError('ITEMS_UNAVAILABLE', 'That dish is sold out', { menuItemId: item.id });
  }
  // A drink has no course: it is served at once. A dish added with none named
  // starts in its own (a starter as a starter, a dessert as a dessert).
  const courseOf = (c: Course | undefined): Course =>
    item.kind === 'DRINK' ? 1 : c === undefined ? defaultCourse(item) : asCourse(c);

  await db.transaction(async (tx: Db) => {
    const cartId = await ensureCart(tx, table.id);
    const lineIn = (course: Course) =>
      and(
        eq(tableCartLines.cartId, cartId),
        eq(tableCartLines.menuItemId, item.id),
        eq(tableCartLines.course, course),
      );
    const current = async (course: Course) =>
      (await tx.select().from(tableCartLines).where(lineIn(course)))[0] ?? null;
    const target = [tableCartLines.cartId, tableCartLines.menuItemId, tableCartLines.course];
    // A guest never takes a line below what is confirmed; the staff can.
    const floor = guest ? sql`${tableCartLines.confirmedQuantity}` : sql`0`;

    let touched: Course[];
    if ('from' in change) {
      const from = courseOf(change.from);
      const to = courseOf(change.to);
      touched = [from, to];
      const line = await current(from);
      if (from !== to && line) {
        if (guest && line.confirmedQuantity > 0) {
          throw domainError('LINE_CONFIRMED', 'Ask the staff to change a confirmed dish');
        }
        // Taken whole out of one course and added to the other, in one step:
        // its confirmed part and its request go with it.
        await tx.delete(tableCartLines).where(lineIn(from));
        await tx
          .insert(tableCartLines)
          .values({
            cartId,
            menuItemId: item.id,
            course: to,
            quantity: line.quantity,
            confirmedQuantity: line.confirmedQuantity,
            note: line.note,
            changedBy: by,
          })
          .onConflictDoUpdate({
            target,
            set: {
              quantity: sql`least(${MAX_QUANTITY}, ${tableCartLines.quantity} + ${line.quantity})`,
              confirmedQuantity: sql`least(${MAX_QUANTITY}, ${tableCartLines.confirmedQuantity} + ${line.confirmedQuantity})`,
              note: sql`coalesce(${tableCartLines.note}, ${line.note})`,
              changedBy: by,
            },
          });
      }
    } else if ('note' in change) {
      const course = courseOf(change.course);
      touched = [];
      const line = await current(course);
      if (!line) throw domainError('VALIDATION_FAILED', 'That dish is not in the cart');
      if (guest && line.confirmedQuantity > 0) {
        throw domainError('LINE_CONFIRMED', 'Ask the staff to change a confirmed dish');
      }
      await tx.update(tableCartLines).set({ note: cleanNote(change.note), changedBy: by }).where(lineIn(course));
    } else if ('delta' in change) {
      const course = courseOf(change.course);
      touched = [course];
      const delta = Math.trunc(change.delta);
      await tx
        .insert(tableCartLines)
        .values({ cartId, menuItemId: item.id, course, quantity: clamp(delta), changedBy: by })
        .onConflictDoUpdate({
          target,
          set: {
            quantity: sql`least(${MAX_QUANTITY}, greatest(${floor}, ${tableCartLines.quantity} + ${delta}))`,
            changedBy: by,
          },
        });
    } else {
      const course = courseOf(change.course);
      touched = [course];
      const quantity = clamp(change.quantity);
      await tx
        .insert(tableCartLines)
        .values({ cartId, menuItemId: item.id, course, quantity, changedBy: by })
        .onConflictDoUpdate({
          target,
          set: { quantity: sql`greatest(${floor}, ${quantity})`, changedBy: by },
        });
    }

    // The staff taking a line below what they confirmed confirm the lower amount.
    for (const course of touched) {
      await tx
        .update(tableCartLines)
        .set({ confirmedQuantity: sql`least(${tableCartLines.confirmedQuantity}, ${tableCartLines.quantity})` })
        .where(lineIn(course));
      await tx.delete(tableCartLines).where(and(lineIn(course), eq(tableCartLines.quantity, 0)));
    }
    await tx.update(tableCarts).set({ updatedAt: new Date() }).where(eq(tableCarts.id, cartId));
  });
}

/** A special request for the whole table, from a guest or the staff; empty removes it. */
export async function setTableNote(db: Db, tableNumber: string, note: string): Promise<void> {
  const table = await activeTable(db, tableNumber);
  await db.transaction(async (tx: Db) => {
    const cartId = await ensureCart(tx, table.id);
    await tx
      .update(tableCarts)
      .set({ note: cleanNote(note, MAX_TABLE_NOTE), updatedAt: new Date() })
      .where(eq(tableCarts.id, cartId));
  });
}

export const MAX_TABLE_NOTE = 300;

/**
 * The staff have checked the list with the guests: everything on it, and the
 * table's request, is confirmed and goes to the kitchen. Returns how many items
 * were newly confirmed.
 */
export async function confirmOrder(db: Db, tableNumber: string, staffName: string): Promise<number> {
  const table = await activeTable(db, tableNumber);
  return db.transaction(async (tx: Db) => {
    const cartId = await openCartId(tx, table.id);
    if (!cartId) return 0;
    const [row] = await tx
      .select({ n: sql<number>`coalesce(sum(${tableCartLines.quantity} - ${tableCartLines.confirmedQuantity}), 0)::int` })
      .from(tableCartLines)
      .where(eq(tableCartLines.cartId, cartId));
    await tx
      .update(tableCartLines)
      .set({ confirmedQuantity: sql`${tableCartLines.quantity}` })
      .where(eq(tableCartLines.cartId, cartId));
    await tx
      .update(tableCarts)
      .set({ confirmedNote: sql`${tableCarts.note}`, confirmedAt: new Date(), confirmedBy: staffName, updatedAt: new Date() })
      .where(eq(tableCarts.id, cartId));
    return Number(row?.n ?? 0);
  });
}

/**
 * Staff set the menus for a table's guests (Vietnamese, Thai or both), or null
 * to go back to the day's schedule. Lasts until the table is cleared.
 */
export async function setTableMenus(db: Db, tableNumber: string, menus: FoodMenus | null): Promise<void> {
  const table = await activeTable(db, tableNumber);
  await db.update(restaurantTables).set({ menuOverride: menus }).where(eq(restaurantTables.id, table.id));
}

/** Everything at once, or courses: the table's choice, kept on its open cart. */
export async function setAllAtOnce(db: Db, tableNumber: string, allAtOnce: boolean): Promise<void> {
  const table = await activeTable(db, tableNumber);
  await db.transaction(async (tx: Db) => {
    await tx.insert(tableCarts).values({ tableId: table.id }).onConflictDoNothing();
    await tx
      .update(tableCarts)
      .set({ allAtOnce, updatedAt: new Date() })
      .where(and(eq(tableCarts.tableId, table.id), isNull(tableCarts.clearedAt)));
  });
}

function clamp(quantity: number): number {
  return Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(quantity)));
}

/** After paying: closes the table's cart, so its next guests start an empty one. */
export async function clearTable(db: Db, tableNumber: string, staffName: string): Promise<boolean> {
  const table = await activeTable(db, tableNumber);
  const cleared = await db
    .update(tableCarts)
    .set({ clearedAt: new Date(), clearedBy: staffName })
    .where(and(eq(tableCarts.tableId, table.id), isNull(tableCarts.clearedAt)))
    .returning({ id: tableCarts.id });
  // The next guests get the day's schedule again.
  if (table.menuOverride !== null) {
    await db.update(restaurantTables).set({ menuOverride: null }).where(eq(restaurantTables.id, table.id));
  }
  return cleared.length > 0;
}

/**
 * End of the day: clears every table at once, exactly as clearing each one
 * would (who and when are kept, staff menu choices go back to the schedule).
 * Returns the tables that had an open cart.
 */
export async function clearAllTables(db: Db, staffName: string): Promise<string[]> {
  return db.transaction(async (tx: Db) => {
    const cleared = await tx
      .update(tableCarts)
      .set({ clearedAt: new Date(), clearedBy: staffName })
      .where(isNull(tableCarts.clearedAt))
      .returning({ tableId: tableCarts.tableId });
    await tx
      .update(restaurantTables)
      .set({ menuOverride: null })
      .where(sql`${restaurantTables.menuOverride} is not null`);
    if (cleared.length === 0) return [];
    const ids = new Set(cleared.map((c) => c.tableId));
    return (await tx.select().from(restaurantTables))
      .filter((t) => ids.has(t.id))
      .map((t) => t.tableNumber)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });
}

export interface TableOverview {
  readonly tableNumber: string;
  readonly area: 'INSIDE' | 'OUTSIDE' | null;
  readonly isActive: boolean;
  /** The open cart, or null for a free table. */
  readonly cart: {
    count: number;
    totalCents: number;
    updatedAt: string;
    allAtOnce: boolean;
    /** Items waiting for the staff's confirmation. */
    pending: number;
    /** Something has been confirmed (sent to the kitchen) at this table. */
    confirmed: boolean;
  } | null;
}

/** Every table, active or not, with a summary of its open cart. */
export async function listTables(db: Db): Promise<TableOverview[]> {
  const tables = await db.select().from(restaurantTables);
  const carts = await db
    .select({
      tableId: tableCarts.tableId,
      updatedAt: tableCarts.updatedAt,
      allAtOnce: tableCarts.allAtOnce,
      count: sql<number>`coalesce(sum(${tableCartLines.quantity}), 0)::int`,
      totalCents: sql<number>`coalesce(sum(${tableCartLines.quantity} * ${menuItems.priceCents}), 0)::int`,
      pendingItems: sql<number>`coalesce(sum(${tableCartLines.quantity} - ${tableCartLines.confirmedQuantity}), 0)::int`,
      note: tableCarts.note,
      confirmedNote: tableCarts.confirmedNote,
      confirmedAt: tableCarts.confirmedAt,
    })
    .from(tableCarts)
    .leftJoin(tableCartLines, eq(tableCartLines.cartId, tableCarts.id))
    .leftJoin(menuItems, eq(menuItems.id, tableCartLines.menuItemId))
    .where(isNull(tableCarts.clearedAt))
    .groupBy(
      tableCarts.tableId,
      tableCarts.updatedAt,
      tableCarts.allAtOnce,
      tableCarts.note,
      tableCarts.confirmedNote,
      tableCarts.confirmedAt,
    );
  const byTable = new Map(carts.map((c) => [c.tableId, c]));

  return tables
    .map((t) => {
      const cart = byTable.get(t.id);
      return {
        tableNumber: t.tableNumber,
        area: t.area,
        isActive: t.isActive,
        // An open cart emptied line by line is a free table again.
        cart:
          cart && Number(cart.count) > 0
            ? {
                count: Number(cart.count),
                totalCents: Number(cart.totalCents),
                updatedAt: cart.updatedAt.toISOString(),
                allAtOnce: cart.allAtOnce,
                pending:
                  Number(cart.pendingItems) +
                  (cart.note !== null && cart.note !== cart.confirmedNote ? 1 : 0),
                confirmed: cart.confirmedAt !== null,
              }
            : null,
      };
    })
    .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true }));
}

export async function createTable(
  db: Db,
  input: { tableNumber: string; area?: 'INSIDE' | 'OUTSIDE' | null },
): Promise<void> {
  if (!isTableNumber(input.tableNumber)) {
    throw domainError('VALIDATION_FAILED', 'A table number is 1–8 letters, digits or dashes');
  }
  const [existing] = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.tableNumber, input.tableNumber));
  if (existing?.isActive) throw domainError('TABLE_EXISTS', 'That table already exists');
  if (existing) {
    // A table removed earlier comes back with its number, its card still works.
    await db
      .update(restaurantTables)
      .set({ isActive: true, area: input.area ?? existing.area })
      .where(eq(restaurantTables.id, existing.id));
    return;
  }
  await db.insert(restaurantTables).values({
    tableNumber: input.tableNumber,
    displayName: `Table ${input.tableNumber}`,
    qrToken: generateQrToken(),
    area: input.area ?? null,
  });
}

/**
 * Changes a table's area, or takes it out of (or back into) service. A table is
 * never deleted: past carts still point at it, and its printed card may be on a
 * table again one day. A table with guests' dishes on it cannot be removed.
 */
export async function updateTable(
  db: Db,
  tableNumber: string,
  change: { area?: 'INSIDE' | 'OUTSIDE' | null; isActive?: boolean },
): Promise<void> {
  if (!isTableNumber(tableNumber)) throw domainError('TABLE_NOT_FOUND', 'No such table');
  const [table] = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.tableNumber, tableNumber));
  if (!table) throw domainError('TABLE_NOT_FOUND', 'No such table', { tableNumber });

  if (change.isActive === false && table.isActive) {
    const cartId = await openCartId(db, table.id);
    if (cartId) {
      const [line] = await db.select().from(tableCartLines).where(eq(tableCartLines.cartId, cartId)).limit(1);
      if (line) throw domainError('TABLE_IN_USE', 'Clear the table before removing it');
    }
  }

  await db
    .update(restaurantTables)
    .set({
      ...(change.area !== undefined ? { area: change.area } : {}),
      ...(change.isActive !== undefined ? { isActive: change.isActive } : {}),
    })
    .where(eq(restaurantTables.id, table.id));
}

/**
 * Adds every table on the restaurant's list (data/<restaurant>-tables.json)
 * that the database has never seen, so a table added to the list (and printed
 * on a card) works on the next deploy without anyone running setup. A table
 * the staff removed is known, and stays removed; nothing is ever deleted.
 */
export async function addMissingTables(
  db: Db,
  listed: readonly { tableNumber: string; area?: 'INSIDE' | 'OUTSIDE' | null }[],
): Promise<string[]> {
  const known = new Set((await db.select({ n: restaurantTables.tableNumber }).from(restaurantTables)).map((r) => r.n));
  const added: string[] = [];
  for (const table of listed) {
    if (known.has(table.tableNumber) || !isTableNumber(table.tableNumber)) continue;
    await db
      .insert(restaurantTables)
      .values({
        tableNumber: table.tableNumber,
        displayName: `Table ${table.tableNumber}`,
        qrToken: generateQrToken(),
        area: table.area ?? null,
      })
      .onConflictDoNothing();
    added.push(table.tableNumber);
  }
  return added;
}
