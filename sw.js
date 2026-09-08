/* Service worker ของ "สมุดเก็บรายจ่ายของฉัน" — ทำหน้าที่รับ push แจ้งเตือนอย่างเดียว
   ไม่แคชไฟล์ใดๆ เพื่อให้เวอร์ชันใหม่ขึ้นทันทีเหมือนเดิม */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (ev) { ev.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (ev) {
  var data = {};
  try { data = ev.data ? ev.data.json() : {}; } catch (e) { data = { title: 'AmPayPay', body: ev.data ? ev.data.text() : '' }; }
  var title = data.title || '🔔 AmPayPay';
  var opts = {
    body: data.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: data.tag || 'expense-book',
    renotify: true,
    data: { url: data.url || './#bell' }
  };
  ev.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    /* ถ้าแอปเปิดอยู่ ให้ซิงก์ทันทีจะได้เห็นกระดิ่งขึ้นเลข */
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) { c.postMessage({ type: 'push', title: title, body: opts.body }); });
    })
  ]));
});

self.addEventListener('notificationclick', function (ev) {
  ev.notification.close();
  var target = new URL((ev.notification.data && ev.notification.data.url) || './#bell', self.location.href).href;
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var open = list[0];
    if (open) {
      open.postMessage({ type: 'open-bell' });
      return open.focus ? open.focus() : null;
    }
    return self.clients.openWindow(target);
  }));
});
