export function tableFromQrSearch(search: string): string | null {
  const table = new URLSearchParams(search).get('table');
  return table && /^[1-9][0-9]{0,2}$/.test(table) ? table : null;
}

export function menuQrUrl(origin: string, restaurantId: string, table?: number): string {
  const url = new URL('/', origin);
  url.searchParams.set('restaurantId', restaurantId);
  if (table !== undefined) url.searchParams.set('table', String(table));
  return url.toString();
}
