import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import { menuItems, tableCarts } from '../../src/server/db/schema';
import { applyShippedMenu, loadShippedMenu } from '../../src/server/menu/sync-menu';
import { RESTAURANT_PROFILES } from '../../src/config/restaurant';
import {
  confirmOrder,
  setTableNote,
  clearAllTables,
  setTableMenus,
  addMissingTables,
  changeCartLine,
  setAllAtOnce,
  clearTable,
  createTable,
  getTableCart,
  listTables,
  updateTable,
} from '../../src/server/services/table-cart-service';
import type { AppDatabase } from '../../src/server/db/client';

let ctx: TestContext;
let db: AppDatabase;
let springRolls: string;
let pho: string;
let cola: string;

beforeAll(async () => {
  ctx = await createTestDatabase();
  db = ctx.db as unknown as AppDatabase;
  await applyShippedMenu(db, loadShippedMenu(resolve(process.cwd(), 'data'), RESTAURANT_PROFILES.winterthur));
  const items = await db.select().from(menuItems);
  springRolls = items.find((i) => i.dishNumber === '10')!.id;
  pho = items.find((i) => i.dishNumber?.startsWith('40'))!.id;
  cola = items.find((i) => i.nameEn === 'Coca Cola')!.id;
  await createTable(db, { tableNumber: '220', area: 'INSIDE' });
  await createTable(db, { tableNumber: '310' });
});

afterAll(async () => {
  await ctx.close();
});

describe('one shared cart per table', () => {
  it('starts empty, and two phones at the table add to the same list', async () => {
    expect((await getTableCart(db, '220', 'en')).lines).toEqual([]);

    await changeCartLine(db, '220', { menuItemId: springRolls, delta: 1 }, 'guest');
    await changeCartLine(db, '220', { menuItemId: springRolls, delta: 1 }, 'guest');
    await changeCartLine(db, '220', { menuItemId: pho, delta: 1 }, 'guest');

    const cart = await getTableCart(db, '220', 'de');
    expect(cart.lines.map((l) => [l.dishNumber, l.quantity])).toEqual([
      ['10', 2],
      [expect.stringMatching(/^40/), 1],
    ]);
    expect(cart.lines[0]!.name).toBe('Vegetarische Frühlingsrollen');
    expect(cart.count).toBe(3);
  });

  it('counts taps made at the same moment, rather than losing one', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => changeCartLine(db, '310', { menuItemId: pho, delta: 1 }, 'guest')),
    );
    expect((await getTableCart(db, '310', 'en')).lines[0]!.quantity).toBe(5);
  });

  it('lets staff add for a guest ordering from the printed card, and records who', async () => {
    await changeCartLine(db, '220', { menuItemId: pho, quantity: 3 }, { staff: 'Xuan' });
    const line = (await getTableCart(db, '220', 'en')).lines.find((l) => l.menuItemId === pho)!;
    expect(line).toMatchObject({ quantity: 3, changedBy: 'Xuan' });
  });

  it('removes a line taken down to nothing', async () => {
    await changeCartLine(db, '220', { menuItemId: pho, delta: -3 }, 'guest');
    expect((await getTableCart(db, '220', 'en')).lines.map((l) => l.menuItemId)).toEqual([springRolls]);
    // Taking away what is not there changes nothing.
    await changeCartLine(db, '220', { menuItemId: pho, delta: -1 }, 'guest');
    expect((await getTableCart(db, '220', 'en')).count).toBe(2);
  });

  it('stops a guest adding a sold-out dish, but not the staff', async () => {
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, pho));
    await expect(changeCartLine(db, '220', { menuItemId: pho, delta: 1 }, 'guest')).rejects.toMatchObject({
      code: 'ITEMS_UNAVAILABLE',
    });
    await changeCartLine(db, '220', { menuItemId: pho, delta: 1 }, { staff: 'Edmond' });
    await changeCartLine(db, '220', { menuItemId: pho, quantity: 0 }, 'guest');
    await db.update(menuItems).set({ isAvailable: true }).where(eq(menuItems.id, pho));
  });

  it('refuses a table that does not exist', async () => {
    await expect(getTableCart(db, '999', 'en')).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
    await expect(
      changeCartLine(db, '999', { menuItemId: pho, delta: 1 }, 'guest'),
    ).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
  });

  it('shows the staff which tables have dishes waiting', async () => {
    const tables = await listTables(db);
    expect(tables.find((t) => t.tableNumber === '220')!.cart).toMatchObject({ count: 2 });
    expect(tables.find((t) => t.tableNumber === '310')!.cart).toMatchObject({ count: 5 });
  });

  it('clears a table after paying: its next guests start an empty cart, and who cleared it is kept', async () => {
    expect(await clearTable(db, '220', 'Tami')).toBe(true);
    expect((await getTableCart(db, '220', 'en')).lines).toEqual([]);
    expect((await listTables(db)).find((t) => t.tableNumber === '220')!.cart).toBeNull();

    const closed = await db.select().from(tableCarts);
    expect(closed.find((c) => c.clearedBy === 'Tami')).toBeTruthy();

    await changeCartLine(db, '220', { menuItemId: springRolls, delta: 1 }, 'guest');
    expect((await getTableCart(db, '220', 'en')).count).toBe(1);
    expect(await clearTable(db, '220', 'Tami')).toBe(true);
    expect(await clearTable(db, '220', 'Tami')).toBe(false);
  });
});

describe('1. Gang and 2. Gang', () => {
  it('starts every dish in the first course, and keeps the same dish in both apart', async () => {
    await createTable(db, { tableNumber: '230' });
    await changeCartLine(db, '230', { menuItemId: springRolls, delta: 2 }, 'guest');
    await changeCartLine(db, '230', { menuItemId: springRolls, delta: 1, course: 2 }, 'guest');
    const lines = (await getTableCart(db, '230', 'en')).lines;
    expect(lines.map((l) => [l.course, l.quantity])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('moves a dish, all of it, to the other course, joining what is there', async () => {
    await changeCartLine(db, '230', { menuItemId: springRolls, from: 1, to: 2 }, 'guest');
    expect((await getTableCart(db, '230', 'en')).lines.map((l) => [l.course, l.quantity])).toEqual([[2, 3]]);
    await changeCartLine(db, '230', { menuItemId: springRolls, quantity: 1, course: 2 }, { staff: 'Viet' });
    expect((await getTableCart(db, '230', 'en')).lines[0]).toMatchObject({ course: 2, quantity: 1, changedBy: 'Viet' });
  });

  it('keeps drinks in the first course: they are served at once', async () => {
    await changeCartLine(db, '230', { menuItemId: cola, delta: 1, course: 2 }, 'guest');
    await changeCartLine(db, '230', { menuItemId: cola, from: 1, to: 2 }, 'guest');
    const drink = (await getTableCart(db, '230', 'en')).lines.find((l) => l.menuItemId === cola)!;
    expect(drink).toMatchObject({ course: 1, kind: 'DRINK', quantity: 1 });
  });

  it('lets a table ask for everything at once, and back, keeping each dish\'s course', async () => {
    await setAllAtOnce(db, '230', true);
    expect((await getTableCart(db, '230', 'en')).allAtOnce).toBe(true);
    expect((await listTables(db)).find((t) => t.tableNumber === '230')!.cart!.allAtOnce).toBe(true);
    await setAllAtOnce(db, '230', false);
    const cart = await getTableCart(db, '230', 'en');
    expect(cart.allAtOnce).toBe(false);
    expect(cart.lines.map((l) => [l.menuItemId === cola ? 'cola' : 'rolls', l.course])).toEqual([
      ['cola', 1],
      ['rolls', 2],
    ]);
  });

  it('starts the next guests with courses again', async () => {
    await setAllAtOnce(db, '230', true);
    await clearTable(db, '230', 'April');
    expect((await getTableCart(db, '230', 'en')).allAtOnce).toBe(false);
  });
});

describe('managing the tables', () => {
  it('adds a table, and refuses one already in service', async () => {
    await createTable(db, { tableNumber: '140', area: 'OUTSIDE' });
    expect((await listTables(db)).find((t) => t.tableNumber === '140')).toMatchObject({
      area: 'OUTSIDE',
      isActive: true,
    });
    await expect(createTable(db, { tableNumber: '140' })).rejects.toMatchObject({ code: 'TABLE_EXISTS' });
    await expect(createTable(db, { tableNumber: 'not a table!' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('changes a table, and will not remove one with dishes on it', async () => {
    await updateTable(db, '140', { area: 'INSIDE' });
    expect((await listTables(db)).find((t) => t.tableNumber === '140')!.area).toBe('INSIDE');

    await expect(updateTable(db, '310', { isActive: false })).rejects.toMatchObject({ code: 'TABLE_IN_USE' });
    await clearTable(db, '310', 'Yen');
    await updateTable(db, '310', { isActive: false });
    await expect(getTableCart(db, '310', 'en')).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' });
  });

  it('brings a removed table back under its number', async () => {
    await createTable(db, { tableNumber: '310' });
    expect((await listTables(db)).find((t) => t.tableNumber === '310')!.isActive).toBe(true);
  });
});

describe('tables from the restaurant\'s list', () => {
  it('adds a listed table the database has never seen, and leaves a removed one removed', async () => {
    await createTable(db, { tableNumber: '77' });
    await updateTable(db, '77', { isActive: false });

    const added = await addMissingTables(db, [
      { tableNumber: '33', area: 'OUTSIDE' },
      { tableNumber: '54', area: 'INSIDE' },
      { tableNumber: '77' },
      { tableNumber: '220' },
    ]);
    expect(added).toEqual(['33', '54']);

    const tables = await listTables(db);
    expect(tables.find((t) => t.tableNumber === '33')).toMatchObject({ area: 'OUTSIDE', isActive: true });
    expect(tables.find((t) => t.tableNumber === '77')!.isActive).toBe(false);
    expect(await addMissingTables(db, [{ tableNumber: '33' }])).toEqual([]);
  });

  it('gives Oerlikon the staff screen too, with its own staff', () => {
    expect(RESTAURANT_PROFILES.oerlikon.staff).toEqual(['Belle']);
    expect(RESTAURANT_PROFILES.winterthur.staff).toEqual(
      expect.arrayContaining(['Edmond', 'Belle', 'Hong Anh']),
    );
  });
});

describe('which menu a table gets', () => {
  // 10 November 2026 is a Tuesday, the 15th a Sunday (noon in Zurich).
  const schedule = RESTAURANT_PROFILES.winterthur.menuSchedule;
  const tuesday = { now: new Date('2026-11-10T11:00:00Z'), schedule };
  const sunday = { now: new Date('2026-11-15T11:00:00Z'), schedule };

  it('follows the day\'s schedule', async () => {
    await createTable(db, { tableNumber: '320' });
    expect(await getTableCart(db, '320', 'en', tuesday)).toMatchObject({ menus: 'THAI', menuOverride: null });
    expect((await getTableCart(db, '220', 'en', tuesday)).menus).toBe('BOTH');
    expect((await getTableCart(db, '220', 'en', sunday)).menus).toBe('THAI');
  });

  it('lets the staff set a table otherwise, until the table is cleared', async () => {
    await setTableMenus(db, '320', 'VIETNAMESE');
    expect(await getTableCart(db, '320', 'en', tuesday)).toMatchObject({
      menus: 'VIETNAMESE',
      scheduledMenus: 'THAI',
      menuOverride: 'VIETNAMESE',
    });

    await changeCartLine(db, '320', { menuItemId: springRolls, delta: 1 }, 'guest');
    await clearTable(db, '320', 'Mersi');
    expect(await getTableCart(db, '320', 'en', tuesday)).toMatchObject({ menus: 'THAI', menuOverride: null });
  });

  it('goes back to the schedule when the staff say so', async () => {
    await setTableMenus(db, '320', 'BOTH');
    await setTableMenus(db, '320', null);
    expect((await getTableCart(db, '320', 'en', tuesday)).menus).toBe('THAI');
  });
});

describe('end of the day', () => {
  it('clears every table at once, keeps who did it, and resets staff menu choices', async () => {
    await changeCartLine(db, '220', { menuItemId: springRolls, delta: 1 }, 'guest');
    await changeCartLine(db, '320', { menuItemId: pho, delta: 2 }, 'guest');
    await setTableMenus(db, '320', 'BOTH');

    expect(await clearAllTables(db, 'Edmond')).toEqual(expect.arrayContaining(['220', '320']));
    expect((await listTables(db)).filter((t) => t.cart)).toEqual([]);
    expect((await getTableCart(db, '320', 'en')).menuOverride).toBeNull();
    const closed = await db.select().from(tableCarts);
    expect(closed.filter((c) => c.clearedBy === 'Edmond').length).toBeGreaterThanOrEqual(2);

    expect(await clearAllTables(db, 'Edmond')).toEqual([]);
  });
});

describe('courses, confirmation and special requests', () => {
  let dessert: string;
  beforeAll(async () => {
    dessert = (await db.select().from(menuItems)).find((i) => i.dishNumber === '130')!.id;
    await createTable(db, { tableNumber: '240' });
  });

  it('starts a starter as a starter, a main dish as a main course, a dessert as a dessert', async () => {
    await changeCartLine(db, '240', { menuItemId: springRolls, delta: 1 }, 'guest');
    await changeCartLine(db, '240', { menuItemId: pho, delta: 1 }, 'guest');
    await changeCartLine(db, '240', { menuItemId: dessert, delta: 2 }, 'guest');
    await changeCartLine(db, '240', { menuItemId: cola, delta: 1 }, 'guest');
    const lines = (await getTableCart(db, '240', 'en')).lines;
    const courseOf = (id: string) => lines.find((l) => l.menuItemId === id)!.course;
    expect([courseOf(springRolls), courseOf(pho), courseOf(dessert), courseOf(cola)]).toEqual([1, 2, 3, 1]);
  });

  it('lets a guest move a dish to another course and add a request to it', async () => {
    await changeCartLine(db, '240', { menuItemId: pho, from: 2, to: 1 }, 'guest');
    await changeCartLine(db, '240', { menuItemId: pho, course: 1, note: '  no   coriander  ' }, 'guest');
    await setTableNote(db, '240', 'One guest is allergic to peanuts');
    const cart = await getTableCart(db, '240', 'en');
    expect(cart.lines.find((l) => l.menuItemId === pho)).toMatchObject({ course: 1, note: 'no coriander' });
    expect(cart.note).toBe('One guest is allergic to peanuts');
    // 5 items and the table's request wait for the staff.
    expect(cart.pending).toBe(6);
    expect((await listTables(db)).find((t) => t.tableNumber === '240')!.cart).toMatchObject({
      pending: 6,
      confirmed: false,
    });
  });

  it('confirms the order: nothing waits, and who confirmed it is kept', async () => {
    expect(await confirmOrder(db, '240', 'Hong Anh')).toBe(5);
    const cart = await getTableCart(db, '240', 'en');
    expect(cart).toMatchObject({ pending: 0, confirmedBy: 'Hong Anh' });
    expect(cart.lines.every((l) => l.confirmedQuantity === l.quantity)).toBe(true);
  });

  it('stops a guest changing what is confirmed, but lets them add more, which waits again', async () => {
    await changeCartLine(db, '240', { menuItemId: dessert, delta: -2 }, 'guest');
    await changeCartLine(db, '240', { menuItemId: dessert, quantity: 0, course: 3 }, 'guest');
    expect((await getTableCart(db, '240', 'en')).lines.find((l) => l.menuItemId === dessert)!.quantity).toBe(2);
    await expect(
      changeCartLine(db, '240', { menuItemId: pho, from: 1, to: 2 }, 'guest'),
    ).rejects.toMatchObject({ code: 'LINE_CONFIRMED' });
    await expect(
      changeCartLine(db, '240', { menuItemId: pho, course: 1, note: 'extra spicy' }, 'guest'),
    ).rejects.toMatchObject({ code: 'LINE_CONFIRMED' });

    await changeCartLine(db, '240', { menuItemId: dessert, delta: 1 }, 'guest');
    const cart = await getTableCart(db, '240', 'en');
    expect(cart.lines.find((l) => l.menuItemId === dessert)).toMatchObject({ quantity: 3, confirmedQuantity: 2 });
    expect(cart.pending).toBe(1);
    // The guest can take back what is not yet confirmed.
    await changeCartLine(db, '240', { menuItemId: dessert, delta: -1, course: 3 }, 'guest');
    expect((await getTableCart(db, '240', 'en')).pending).toBe(0);
  });

  it('lets the staff change anything, confirmed or not', async () => {
    await changeCartLine(db, '240', { menuItemId: pho, course: 1, note: 'extra spicy' }, { staff: 'Belle' });
    await changeCartLine(db, '240', { menuItemId: pho, from: 1, to: 2 }, { staff: 'Belle' });
    await changeCartLine(db, '240', { menuItemId: dessert, quantity: 1, course: 3 }, { staff: 'Belle' });
    const lines = (await getTableCart(db, '240', 'en')).lines;
    expect(lines.find((l) => l.menuItemId === pho)).toMatchObject({ course: 2, note: 'extra spicy', confirmedQuantity: 1 });
    expect(lines.find((l) => l.menuItemId === dessert)).toMatchObject({ quantity: 1, confirmedQuantity: 1 });
  });

  it('counts a new table request as waiting until it is confirmed', async () => {
    await setTableNote(db, '240', 'Birthday: candle on the dessert');
    expect((await getTableCart(db, '240', 'en')).pending).toBe(1);
    await confirmOrder(db, '240', 'Belle');
    expect((await getTableCart(db, '240', 'en')).pending).toBe(0);
  });
});
