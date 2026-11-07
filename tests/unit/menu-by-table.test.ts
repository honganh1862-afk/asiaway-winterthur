import { describe, expect, it } from 'vitest';
import { categoriesOnTab, menusOfTheDay, menuTabFor, scheduledMenus } from '../../src/domain/menu/menus';
import { menuTabs, openTab, type Category } from '../../src/components/customer/useMenu';
import { RESTAURANT_PROFILES } from '../../src/config/restaurant';

const t = (key: string) => key;
const category = (slug: string, kind: 'FOOD' | 'DRINK' = 'FOOD'): Category => ({
  id: slug,
  slug,
  kind,
  name: slug,
  items: [],
});
const winterthurMenu = [
  category('appetizer'),
  category('dessert'),
  category('thai-curry'),
  category('beer', 'DRINK'),
];

const schedule = RESTAURANT_PROFILES.winterthur.menuSchedule;
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 7;

describe('the food menu a Winterthur table is given, by weekday', () => {
  it('serves Tuesday to Thursday: 1xx Vietnamese, 2xx both, 3xx Thai', () => {
    for (const day of [TUE, WED, THU]) {
      expect(scheduledMenus('110', schedule, day)).toBe('VIETNAMESE');
      expect(scheduledMenus('233', schedule, day)).toBe('BOTH');
      expect(scheduledMenus('310', schedule, day)).toBe('THAI');
    }
  });

  it('serves no Thai on Monday, Friday or Saturday', () => {
    for (const day of [MON, FRI, SAT]) {
      for (const table of ['110', '210', '333']) expect(scheduledMenus(table, schedule, day)).toBe('VIETNAMESE');
      expect(menusOfTheDay(schedule, day)).toBe('VIETNAMESE');
    }
  });

  it('serves only Thai on Sunday, at every table', () => {
    for (const table of ['110', '210', '333']) expect(scheduledMenus(table, schedule, SUN)).toBe('THAI');
    expect(menusOfTheDay(schedule, SUN)).toBe('THAI');
  });

  it('gives a guest with no table, or at a table the schedule does not cover, what is served that day', () => {
    expect(scheduledMenus(null, schedule, WED)).toBe('BOTH');
    expect(scheduledMenus('410', schedule, WED)).toBe('BOTH');
    expect(scheduledMenus(null, schedule, MON)).toBe('VIETNAMESE');
  });

  it('applies in Winterthur only', () => {
    expect(RESTAURANT_PROFILES.oerlikon.menuSchedule).toBeNull();
    expect(scheduledMenus('310', null, TUE)).toBe('BOTH');
  });
});

describe('the tabs each table sees', () => {
  const ids = (menus: Parameters<typeof menuTabs>[2]) => menuTabs(winterthurMenu, t, menus).map((x) => x.id);

  it('shows the Vietnamese menu at 1xx, both at 2xx and the Thai menu at 3xx, with desserts and drinks on all', () => {
    expect(ids('VIETNAMESE')).toEqual(['FOOD', 'DESSERT', 'DRINK']);
    expect(ids('BOTH')).toEqual(['FOOD', 'THAI', 'DESSERT', 'DRINK']);
    expect(ids('THAI')).toEqual(['THAI', 'DESSERT', 'DRINK']);
  });

  it('puts the desserts on a tab of their own, and nowhere else', () => {
    expect(menuTabFor(category('dessert'))).toBe('DESSERT');
    expect(categoriesOnTab(winterthurMenu, 'DESSERT').map((c) => c.slug)).toEqual(['dessert']);
    expect(categoriesOnTab(winterthurMenu, 'FOOD').map((c) => c.slug)).toEqual(['appetizer']);
    expect(categoriesOnTab(winterthurMenu, 'THAI').map((c) => c.slug)).toEqual(['thai-curry']);
  });

  it('opens the first tab when the remembered one is not at this table', () => {
    const thaiOnly = menuTabs(winterthurMenu, t, 'THAI');
    expect(openTab('FOOD', thaiOnly)).toBe('THAI');
    expect(openTab('DRINK', thaiOnly)).toBe('DRINK');
  });

  it('leaves a restaurant without the Thai menu as it was', () => {
    const oerlikon = [category('appetizer'), category('beer', 'DRINK')];
    expect(menuTabs(oerlikon, t, 'BOTH').map((x) => x.label)).toEqual(['menu.food', 'menu.drinks']);
    // No desserts loaded, no dessert tab.
    expect(menuTabs(oerlikon, t, 'BOTH').map((x) => x.id)).not.toContain('DESSERT');
  });
});
