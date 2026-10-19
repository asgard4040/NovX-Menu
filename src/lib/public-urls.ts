import { menuQrUrl } from './qr-tables';

export const MENU_ORIGIN = 'https://menu.ordova.cc';
export const STAFF_ORIGIN = 'https://rest.ordova.cc';

export function customerMenuUrl(restaurantId: string, table?: number): string {
  return menuQrUrl(MENU_ORIGIN, restaurantId, table);
}

export function staffPortalUrl(restaurantId: string, portal?: 'restaurant' | 'waiter' | 'kitchen'): string {
  const url = new URL('/', STAFF_ORIGIN);
  url.searchParams.set('loginRestaurantId', restaurantId);
  if (portal) url.searchParams.set('portal', portal);
  return url.toString();
}

// Keep printed QR codes and existing staff bookmarks usable after the split.
// Localhost and Vercel preview deployments are deliberately unaffected.
export function canonicalPortalRedirect(href: string): string | null {
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  const menuId = url.searchParams.get('restaurantId');
  const staffId = url.searchParams.get('loginRestaurantId');
  let destination: string | null = null;

  if (menuId && host !== 'menu.ordova.cc' && [
    'menu.novx-team.com', 'rest.ordova.cc', 'ordova.cc', 'www.ordova.cc',
  ].includes(host)) destination = MENU_ORIGIN;
  else if (staffId && host !== 'rest.ordova.cc' && [
    'menu.novx-team.com', 'menu.ordova.cc', 'ordova.cc', 'www.ordova.cc',
  ].includes(host)) destination = STAFF_ORIGIN;
  else if (host === 'menu.ordova.cc' && !menuId) destination = 'https://ordova.cc';

  if (!destination) return null;
  url.protocol = 'https:';
  url.host = new URL(destination).host;
  url.pathname = '/';
  if (menuId) url.searchParams.delete('loginRestaurantId');
  else url.searchParams.delete('restaurantId');
  return url.toString();
}
