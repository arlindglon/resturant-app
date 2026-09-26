// 🔔 Tea and Treat — customer push service worker
// মেনু পেজের 🔔 বাটনে সাবস্ক্রাইব হলে এই worker push ইভেন্ট ধরে নোটিফিকেশন দেখায়।
self.addEventListener('push', (event) => {
  let data = { title: '🔔 Tea and Treat', body: 'নতুন আপডেট এসেছে!', url: '/menu' }
  try {
    const parsed = event.data ? event.data.json() : {}
    data = { ...data, ...parsed }
  } catch {
    if (event.data) data.body = event.data.text() || data.body
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '🔔 Tea and Treat', {
      body: data.body || '',
      icon: '/icon-64.png',
      badge: '/icon-64.png',
      tag: data.tag || 'treat',
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url: data.url || '/menu' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/menu'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(new URL(url, self.location.origin).pathname) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
