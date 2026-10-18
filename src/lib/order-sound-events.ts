import type { Order } from '../types';

export type SoundRole = 'waiter' | 'kitchen';

export function hasNewRelevantOrder(seen: ReadonlySet<string> | null, orders: Pick<Order, 'id' | 'status'>[], role: SoundRole) {
  if (!seen) return false;
  return orders.some((order) => !seen.has(order.id) && (role === 'waiter' ? order.status === 'pending' : order.status === 'preparing'));
}
