import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { generateQrToken } from '../../domain/session/qr-token';
import { isTableNumber } from '../../domain/table';
import { FOOD_MENUS, scheduledMenus, type FoodMenus, type MenuSchedule } from '../../domain/menu/menus';
import { restaurantWeekday } from '../../domain/menu/saturday';
import { RESTAURANT } from '../../config/restaurant';
import type { Locale } from '../../i18n/locales';
import type { AppDatabase as Db } from '../db/client';
import { menuCategories, menuItems, restaurantTables, tableCartLines, tableCarts } from '../db/schema';

/**
 * One shared cart per table.
 *
 * Every phone that scans a table's card reads and changes the same list, and
 * the staff see it on their phones: they go to the table, take the order from
 * it, add what a guest orders from the printed card, and clear the table once
 * the guests have paid. Clearing closes the cart (who and when are kept) and
 * the table's next guests start a new one.
 *
 * Changes are made line by line — add one, take one away, set a quantity — and
 * each is a single statement, so two guests tapping at the same moment both
 * count rather than one overwriting the other.
 *
 * Each line belongs to a course: the first (1. Gang), entered in the POS at
 * once, or the second (2. Gang), held until the staff release it. A dish
 * starts in the first; the same dish can be in both. Drinks have no course
 * and always count as the first: they are served as soon as they are ordered.
 * A table can also ask for everything at once; its lines keep their courses,
 * so switching back restores the split.
 */

export type Course = 1 | 2;

/** Who changed a line: a guest's phone, or the member of staff by name. */
export type CartActor = 'guest' | { staff: string };

export interface TableCartLine {
  readonly menuItemId: string;
  readonly dishNumber: string | null;
  readonly name: string;
  readonly nameVi: string;
  readonly volume: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly isAvailable: boolean;
  /** 'guest', or the name of the member of staff who last changed the line. */
  readonly changedBy: string;
  readonly course: Course;
  readonly kind: 'FOOD' | 'DRINK';
}

export interface TableCart {
  readonly tableNumber: string;
  readonly lines: TableCartLine[];
  readonly count: number;
  readonly totalCents: number;
  /** When the cart last changed; null for a table with no open cart. */
  readonly updatedAt: string | null;
  /** Everything served at once: no second course held back. */
  readonly allAtOnce: boolean;
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
  if (!cart) return { tableNumber, lines: [], count: 0, totalCents: 0, updatedAt: null, allAtOnce: false, ...menus };

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
      isAvailable: item.isAvailable,
      changedBy: line.changedBy,
      course: (line.course === 2 ? 2 : 1) as Course,
      kind,
    }));

  return {
    tableNumber,
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    totalCents: lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0),
    updatedAt: cart.updatedAt.toISOString(),
    allAtOnce: cart.allAtOnce,
    ...menus,
  };
}

export type CartChange =
  | { readonly menuItemId: string; readonly delta: number; readonly course?: Course }
  | { readonly menuItemId: string; readonly quantity: number; readonly course?: Course }
  /** Moves a dish, all of it, from one course to the other. */
  | { readonly menuItemId: string; readonly from: Course; readonly to: Course };

/**
 * Adds to, takes from, sets or moves one line of a table's cart, opening the
 * cart if the table has none. A guest cannot add a dish that is sold out; the
 * staff can, since they are the ones who know.
 */
export async function changeCartLine(db: Db, tableNumber: string, change: CartChange, actor: CartActor) {
  const table = await activeTable(db, tableNumber);
  const by = actorName(actor);

  const [item] = await db
    .select({ id: menuItems.id, isActive: menuItems.isActive, isAvailable: menuItems.isAvailable, kind: menuCategories.kind })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(eq(menuItems.id, change.menuItemId));
  if (!item || !item.isActive) throw domainError('ITEMS_UNAVAILABLE', 'No such dish on the menu');

  const adding = 'delta' in change ? change.delta > 0 : 'quantity' in change ? change.quantity > 0 : false;
  if (adding && actor === 'guest' && !item.isAvailable) {
    throw domainError('ITEMS_UNAVAILABLE', 'That dish is sold out', { menuItemId: item.id });
  }
  // A drink has no course: it is served at once.
  const courseOf = (c: Course | undefined): Course => (item.kind === 'DRINK' ? 1 : c === 2 ? 2 : 1);

  await db.transaction(async (tx: Db) => {
    // The partial unique index allows one open cart per table: a second phone
    // opening it at the same moment finds the first one's.
    await tx.insert(tableCarts).values({ tableId: table.id }).onConflictDoNothing();
    const cartId = (await openCartId(tx, table.id))!;
    const lineIn = (course: Course) =>
      and(
        eq(tableCartLines.cartId, cartId),
        eq(tableCartLines.menuItemId, item.id),
        eq(tableCartLines.course, course),
      );
    const target = [tableCartLines.cartId, tableCartLines.menuItemId, tableCartLines.course];
    const addTo = async (course: Course, delta: number) => {
      await tx
        .insert(tableCartLines)
        .values({ cartId, menuItemId: item.id, course, quantity: clamp(delta), changedBy: by })
        .onConflictDoUpdate({
          target,
          set: {
            quantity: sql`least(${MAX_QUANTITY}, greatest(0, ${tableCartLines.quantity} + ${delta}))`,
            changedBy: by,
          },
        });
    };

    let touched: Course[];
    if ('from' in change) {
      const from = courseOf(change.from);
      const to = courseOf(change.to);
      touched = [from, to];
      if (from !== to) {
        // Taken whole out of one course and added to the other, in one step.
        const moved = await tx.delete(tableCartLines).where(lineIn(from)).returning({ quantity: tableCartLines.quantity });
        const quantity = moved[0]?.quantity ?? 0;
        if (quantity > 0) await addTo(to, quantity);
      }
    } else if ('delta' in change) {
      const course = courseOf(change.course);
      touched = [course];
      await addTo(course, Math.trunc(change.delta));
    } else {
      const course = courseOf(change.course);
      touched = [course];
      if (change.quantity <= 0) {
        await tx.delete(tableCartLines).where(lineIn(course));
      } else {
        const quantity = clamp(change.quantity);
        await tx
          .insert(tableCartLines)
          .values({ cartId, menuItemId: item.id, course, quantity, changedBy: by })
          .onConflictDoUpdate({ target, set: { quantity, changedBy: by } });
      }
    }

    for (const course of touched) {
      await tx.delete(tableCartLines).where(and(lineIn(course), eq(tableCartLines.quantity, 0)));
    }
    await tx.update(tableCarts).set({ updatedAt: new Date() }).where(eq(tableCarts.id, cartId));
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

export interface TableOverview {
  readonly tableNumber: string;
  readonly area: 'INSIDE' | 'OUTSIDE' | null;
  readonly isActive: boolean;
  /** The open cart, or null for a free table. */
  readonly cart: {
    count: number;
    totalCents: number;
    updatedAt: string;
    secondCourse: number;
    allAtOnce: boolean;
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
      secondCourse: sql<number>`coalesce(sum(${tableCartLines.quantity}) filter (where ${tableCartLines.course} = 2), 0)::int`,
    })
    .from(tableCarts)
    .leftJoin(tableCartLines, eq(tableCartLines.cartId, tableCarts.id))
    .leftJoin(menuItems, eq(menuItems.id, tableCartLines.menuItemId))
    .where(isNull(tableCarts.clearedAt))
    .groupBy(tableCarts.tableId, tableCarts.updatedAt, tableCarts.allAtOnce);
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
                secondCourse: Number(cart.secondCourse),
                allAtOnce: cart.allAtOnce,
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
