self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { /* Always display a visible fallback. */ }
  const notice = message.notification || message;
  event.waitUntil(self.registration.showNotification(notice.title || 'NovX', {
    body: notice.body || '',
    tag: message.requestId ? `waiter-request-${message.requestId}` : message.orderId ? `order-${message.orderId}` : undefined,
    data: { url: message.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
