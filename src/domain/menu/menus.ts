/**
 * Which printed menu a food category comes from.
 *
 * Winterthur serves the Vietnamese and the Thai menu, each on a tab of its own,
 * and which of them a table sees depends on its number and the weekday
 * (scheduledMenus), unless the staff set the table otherwise;
 * Oerlikon has no Thai categories, so it keeps a single food tab. The Thai categories are the ones whose slug starts with `thai-`
 * (CATEGORY_META in server/menu/import.ts).
 */
export const THAI_SLUG_PREFIX = 'thai-';

export function isThaiCategory(slug: string): boolean {
  return slug.startsWith(THAI_SLUG_PREFIX);
}

export type MenuTab = 'FOOD' | 'THAI' | 'DESSERT' | 'DRINK';

/**
 * Which food menus a table is given: the Vietnamese, the Thai, or both.
 * Drinks and desserts are on every table whatever it is given.
 */
export type FoodMenus = 'VIETNAMESE' | 'THAI' | 'BOTH';

export const FOOD_MENUS: readonly FoodMenus[] = ['VIETNAMESE', 'THAI', 'BOTH'];

/** One week, Monday first. */
type Week = readonly [FoodMenus, FoodMenus, FoodMenus, FoodMenus, FoodMenus, FoodMenus, FoodMenus];

/**
 * A restaurant's menu by table and weekday: for the first digit of a table
 * number, the menus that table gets each day, Monday first (see Winterthur in
 * config/restaurant.ts). The staff can set a table otherwise for its guests.
 */
export type MenuSchedule = Readonly<Record<string, Week>>;

function weekIndex(isoWeekday: number): number {
  return Math.min(6, Math.max(0, isoWeekday - 1));
}

/** Everything served anywhere in the restaurant that day. */
export function menusOfTheDay(schedule: MenuSchedule | null, isoWeekday: number): FoodMenus {
  if (!schedule) return 'BOTH';
  const day = Object.values(schedule).map((week) => week.at(weekIndex(isoWeekday))!);
  const vietnamese = day.some((m) => m !== 'THAI');
  const thai = day.some((m) => m !== 'VIETNAMESE');
  return vietnamese && thai ? 'BOTH' : thai ? 'THAI' : 'VIETNAMESE';
}

/**
 * The menus a table gets on a weekday (ISO: Monday 1 … Sunday 7). A guest with
 * no table, or at a table the schedule does not cover, sees what is served
 * anywhere that day. A restaurant with no schedule serves both.
 */
export function scheduledMenus(
  tableNumber: string | null,
  schedule: MenuSchedule | null,
  isoWeekday: number,
): FoodMenus {
  if (!schedule) return 'BOTH';
  const week = tableNumber ? schedule[tableNumber.trim().charAt(0)] : undefined;
  return week ? week.at(weekIndex(isoWeekday))! : menusOfTheDay(schedule, isoWeekday);
}

/**
 * The desserts follow either menu, so they have a tab of their own that every
 * table sees, between the food and the drinks.
 */
const DESSERT_SLUGS: ReadonlySet<string> = new Set(['dessert']);

export function menuTabFor(category: { slug: string; kind: 'FOOD' | 'DRINK' }): MenuTab {
  if (category.kind === 'DRINK') return 'DRINK';
  if (DESSERT_SLUGS.has(category.slug)) return 'DESSERT';
  return isThaiCategory(category.slug) ? 'THAI' : 'FOOD';
}

/** The categories shown on a tab, in menu order. */
export function categoriesOnTab<C extends { slug: string; kind: 'FOOD' | 'DRINK' }>(
  categories: readonly C[],
  tab: MenuTab,
): C[] {
  return categories.filter((c) => menuTabFor(c) === tab);
}
