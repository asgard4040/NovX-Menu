export type StaffPortal = 'restaurant' | 'waiter' | 'kitchen';

export function updateHomeScreenLink() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const params = new URLSearchParams(window.location.search);
  const menuId = params.get('restaurantId');
  const staffId = params.get('loginRestaurantId');
  const portal = params.get('portal');
  if (menuId) {
    link.href = `/api/home-screen-manifest?restaurantId=${encodeURIComponent(menuId)}&portal=menu`;
    document.title = 'ORDOVA Menu';
  } else if (staffId) {
    const role = portal === 'waiter' || portal === 'kitchen' ? portal : 'restaurant';
    link.href = `/api/home-screen-manifest?restaurantId=${encodeURIComponent(staffId)}&portal=${role}`;
    document.title = role === 'waiter' ? 'ORDOVA Waiter' : role === 'kitchen' ? 'ORDOVA Kitchen' : 'ORDOVA Restaurant';
  } else {
    link.href = '/manifest.json';
    document.title = 'ORDOVA Admin';
  }
}

export function selectStaffPortal(role: StaffPortal, restaurantId: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete('restaurantId');
  url.searchParams.set('loginRestaurantId', restaurantId);
  url.searchParams.set('portal', role);
  window.history.replaceState(window.history.state, '', url);
  updateHomeScreenLink();
}
