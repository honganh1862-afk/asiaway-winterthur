/**
 * Which Asiaway restaurant this deployment serves.
 *
 * Each restaurant is its own deployment — its own database, its own address,
 * its own QR codes — built from the same code, so a fix reaches both. What
 * differs between them lives here and in its table list (data/), and nowhere
 * else.
 *
 * It is read from NEXT_PUBLIC_RESTAURANT_LOCATION at BUILD time, because the
 * guest's browser needs it as much as the server does. Changing it means a
 * rebuild, not just a restart.
 */
import type { MenuSchedule } from '../domain/menu/menus';

export const RESTAURANT_LOCATIONS = ['oerlikon', 'winterthur'] as const;
export type RestaurantLocation = (typeof RESTAURANT_LOCATIONS)[number];

export interface RestaurantProfile {
  /**
   * The Saturday category: the weekly special with its photo, and Bánh Mì.
   * Winterthur does not serve the Saturday special.
   */
  readonly saturdayMenu: boolean;
  /**
   * Where guests pay. "counter": they pay, and get the bill, at the counter
   * when they have finished. "table": they ask their waiter for the bill.
   */
  readonly payment: 'table' | 'counter';
  /** Where the counter is, when the room needs it said: Winterthur's is in front of the stairs. */
  readonly counterPlace: 'stairs' | null;
  /**
   * Whether the Thai menu is served beside the Vietnamese one. Winterthur has
   * both, each on its own tab; Oerlikon has the Vietnamese menu only.
   */
  readonly thaiMenu: boolean;
  /**
   * Which food menus each table gets on each weekday, by the first digit of its
   * number (domain/menu/menus.ts). The staff can set a table otherwise for its
   * guests. Null: every table gets every menu served (Oerlikon: Vietnamese).
   */
  readonly menuSchedule: MenuSchedule | null;
  /** The dessert card, n° 130–137. Served in both restaurants. */
  readonly dessertMenu: boolean;
  /**
   * The wine list (sparkling, white, rosé and red, by the glass and the bottle)
   * and the teas from the beverage book. Served in both restaurants.
   */
  readonly wineAndTea: boolean;
  /**
   * Where a guest who enjoyed the visit can leave a review: the restaurant's
   * Google Maps listing. Null where none has been supplied, and then the menu
   * asks for none.
   */
  readonly reviewUrl: string | null;
  /**
   * The staff who sign in on their phones to see each table's shared cart, take
   * orders and clear tables. Empty where the restaurant has no staff screen:
   * there each phone keeps its own cart, as before. The PIN is not here (this
   * repository is public): it is the STAFF_PIN setting of the deployment.
   */
  readonly staff: readonly string[];
}

export const RESTAURANT_PROFILES: Readonly<Record<RestaurantLocation, RestaurantProfile>> = {
  oerlikon: {
    saturdayMenu: true,
    payment: 'counter',
    counterPlace: null,
    thaiMenu: false,
    menuSchedule: null,
    dessertMenu: true,
    wineAndTea: true,
    // "Asiaway" in Zürich-Oerlikon on Google Maps.
    reviewUrl: 'https://maps.app.goo.gl/nFY8toA4d164p12q7',
    staff: ['Belle'],
  },
  winterthur: {
    saturdayMenu: false,
    payment: 'counter',
    counterPlace: 'stairs',
    thaiMenu: true,
    // Monday first. Monday, Friday and Saturday: Vietnamese only. Tuesday to
    // Thursday: 1xx Vietnamese, 2xx both, 3xx Thai. Sunday: Thai only.
    menuSchedule: {
      '1': ['VIETNAMESE', 'VIETNAMESE', 'VIETNAMESE', 'VIETNAMESE', 'VIETNAMESE', 'VIETNAMESE', 'THAI'],
      '2': ['VIETNAMESE', 'BOTH', 'BOTH', 'BOTH', 'VIETNAMESE', 'VIETNAMESE', 'THAI'],
      '3': ['VIETNAMESE', 'THAI', 'THAI', 'THAI', 'VIETNAMESE', 'VIETNAMESE', 'THAI'],
    },
    dessertMenu: true,
    wineAndTea: true,
    // "Asiaway Restaurant Winterthur" on Google Maps.
    reviewUrl: 'https://maps.app.goo.gl/2zNqQCJNHLKMi4WA8',
    staff: ['Edmond', 'Viet', 'Xuan', 'Tami', 'Yen', 'April', 'Mersi', 'Trung', 'Belle', 'Hong Anh'],
  },
};

/**
 * Unset means Oerlikon, so the deployment that existed before Winterthur keeps
 * working with no change. A misspelt value fails loudly rather than quietly
 * showing guests the wrong restaurant's menu.
 */
export function resolveLocation(value: string | undefined): RestaurantLocation {
  const key = (value ?? '').trim().toLowerCase();
  if (key === '') return 'oerlikon';

  const location = RESTAURANT_LOCATIONS.find((l) => l === key);
  if (!location) {
    throw new Error(
      `NEXT_PUBLIC_RESTAURANT_LOCATION must be one of ${RESTAURANT_LOCATIONS.join(', ')}, not "${value}"`,
    );
  }
  return location;
}

// Spelt out in full: Next.js only inlines NEXT_PUBLIC_ variables into the
// browser bundle when they are referenced literally.
export const RESTAURANT_LOCATION = resolveLocation(process.env.NEXT_PUBLIC_RESTAURANT_LOCATION);
export const RESTAURANT = RESTAURANT_PROFILES[RESTAURANT_LOCATION];

/** Whether this restaurant has the staff screen and, with it, one shared cart per table. */
export function hasStaffScreen(profile: Pick<RestaurantProfile, 'staff'> = RESTAURANT): boolean {
  return profile.staff.length > 0;
}
