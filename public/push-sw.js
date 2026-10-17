self.addEventListener('push', (event) => {
  const message = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(message.title || 'NovX', {
    body: message.body || '',
    tag: message.requestId ? `waiter-request-${message.requestId}` : message.orderId ? `order-${message.orderId}` : undefined,
    data: { url: message.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
