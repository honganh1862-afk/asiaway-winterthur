'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The staff screens' access to the server.
 *
 * Every call carries the staff cookie; a 401 means the sign-in has expired (or
 * the name was taken off the list), and the screen goes back to sign-in.
 */
export class StaffApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function staffFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401 && path !== '/api/staff/session') {
    window.location.href = '/staff';
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new StaffApiError(response.status, data?.error?.code ?? 'ERROR');
  return data as T;
}

export interface StaffSession {
  name: string | null;
  staff: string[];
  configured: boolean;
}

export function useStaffSession() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const reload = useCallback(async () => {
    setSession(await staffFetch<StaffSession>('/api/staff/session'));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { session, reload };
}

/** Runs `load` now and every few seconds while the screen is visible. */
export function usePolling(load: () => Promise<void>, everyMs = 4000) {
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, everyMs);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, everyMs]);
}

export interface TableOverview {
  tableNumber: string;
  area: 'INSIDE' | 'OUTSIDE' | null;
  isActive: boolean;
  cart: {
    count: number;
    totalCents: number;
    updatedAt: string;
    allAtOnce: boolean;
    pending: number;
    confirmed: boolean;
  } | null;
}

export interface TableCart {
  tableNumber: string;
  count: number;
  totalCents: number;
  updatedAt: string | null;
  allAtOnce: boolean;
  note: string | null;
  pending: number;
  confirmedAt: string | null;
  confirmedBy: string | null;
  menus: 'VIETNAMESE' | 'THAI' | 'BOTH';
  scheduledMenus: 'VIETNAMESE' | 'THAI' | 'BOTH';
  menuOverride: 'VIETNAMESE' | 'THAI' | 'BOTH' | null;
  lines: {
    menuItemId: string;
    dishNumber: string | null;
    name: string;
    nameVi: string;
    volume: string | null;
    unitPriceCents: number;
    quantity: number;
    isAvailable: boolean;
    changedBy: string;
    course: 1 | 2 | 3;
    kind: 'FOOD' | 'DRINK';
    confirmedQuantity: number;
    note: string | null;
  }[];
}

export function minutesAgo(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}
