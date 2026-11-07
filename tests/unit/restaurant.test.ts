import { describe, expect, it } from 'vitest';
import { RESTAURANT_PROFILES, resolveLocation } from '../../src/config/restaurant';

describe('which restaurant a deployment serves', () => {
  it('is Oerlikon when nothing is set, so the existing deployment is unchanged', () => {
    expect(resolveLocation(undefined)).toBe('oerlikon');
    expect(resolveLocation('')).toBe('oerlikon');
    expect(resolveLocation('  ')).toBe('oerlikon');
  });

  it('accepts either restaurant, however it is capitalised', () => {
    expect(resolveLocation('winterthur')).toBe('winterthur');
    expect(resolveLocation(' Winterthur ')).toBe('winterthur');
    expect(resolveLocation('OERLIKON')).toBe('oerlikon');
  });

  it('refuses a misspelt restaurant rather than showing the wrong room', () => {
    expect(() => resolveLocation('winterhur')).toThrow(/winterhur/);
    expect(() => resolveLocation('zurich')).toThrow();
    expect(() => resolveLocation('constructor')).toThrow();
  });

  it('serves the Saturday menu in Oerlikon only', () => {
    expect(RESTAURANT_PROFILES.oerlikon.saturdayMenu).toBe(true);
    expect(RESTAURANT_PROFILES.winterthur.saturdayMenu).toBe(false);
  });

  it('has guests pay at the counter in both, and says where only in Winterthur', () => {
    expect(RESTAURANT_PROFILES.winterthur).toMatchObject({ payment: 'counter', counterPlace: 'stairs' });
    expect(RESTAURANT_PROFILES.oerlikon).toMatchObject({ payment: 'counter', counterPlace: null });
  });

  it('serves the Thai menu in Winterthur only', () => {
    expect(RESTAURANT_PROFILES.winterthur.thaiMenu).toBe(true);
    expect(RESTAURANT_PROFILES.oerlikon.thaiMenu).toBe(false);
  });

  it('asks for Google reviews of each restaurant on its own listing', () => {
    expect(RESTAURANT_PROFILES.winterthur.reviewUrl).toBe('https://maps.app.goo.gl/2zNqQCJNHLKMi4WA8');
    expect(RESTAURANT_PROFILES.oerlikon.reviewUrl).toBe('https://maps.app.goo.gl/nFY8toA4d164p12q7');
  });
});

describe('the toilet notice', () => {
  it('tells Winterthur guests the floor and the code, and Oerlikon guests nothing', () => {
    expect(RESTAURANT_PROFILES.winterthur.toilet).toEqual({ floor: '−1', code: 'E2020' });
    expect(RESTAURANT_PROFILES.oerlikon.toilet).toBeNull();
  });
});
