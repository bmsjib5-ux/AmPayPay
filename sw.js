/* Service worker ของ AmPayPay
   1) รับ push แจ้งเตือนตอนปิดแอป
   2) แคชไฟล์แอปไว้ให้เปิดใช้งานได้ตอนเน็ตหลุด (network-first: ออนไลน์ได้ของใหม่เสมอ ออฟไลน์ใช้ของที่แคชไว้)
   ข้อมูลรายจ่ายอยู่ใน localStorage/IndexedDB ของเบราว์เซอร์อยู่แล้ว จึงใช้งานต่อได้เต็มรูปแบบตอนออฟไลน์ */
var CACHE = 'ampaypay-v81';
var SHELL = [
  './assets/design.css?v=77', './assets/design.js?v=77', './assets/app.js?v=77',
  './', './index.html', './manifest.webmanifest',
  './assets/styles.css', './assets/mobile.css', './assets/mobile.css?v=77', './assets/styles.css?v=77', './assets/config.js', './assets/parser.js', './assets/store.js',
  './assets/sync.js', './assets/promptpay.js', './assets/ocr-paths.js', './assets/app.js',
  './assets/vendor/qrcode.js',
  './assets/icon-32.png', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', function (ev) {
  self.skipWaiting();
  ev.waitUntil(caches.open(CACHE).then(function (c) {
    /* ใบไหนโหลดไม่ได้ก็ข้ามไป ไม่ให้ทั้งชุดล้ม */
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // ข้ามไฟล์จาก CDN และการเรียก Supabase
  /* ชุดภาษา OCR ก้อนละหลายเมกะไบต์ tesseract.js แคชไว้ใน IndexedDB ให้อยู่แล้ว
     ไม่ต้องเก็บซ้ำใน Cache Storage อีกชุด */
  if (/\/assets\/tessdata\//.test(url.pathname)) return;
  ev.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        /* เปิดหน้าเว็บตอนออฟไลน์ → คืนหน้าแอปที่แคชไว้ */
        if (req.mode === 'navigate') return caches.match('./index.html') || caches.match('./');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

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

/* ปุ่ม "ทดสอบแบบปิดแอป" ในแอปสั่งมาทางนี้ — หน่วงไว้ก่อนแล้วค่อยเด้ง
   ผู้ใช้จะได้มีเวลาปิดแอป/ล็อกจอ แล้วดูว่าแจ้งเตือนขึ้นจริงไหมตอนไม่ได้เปิดแอป
   ห่อด้วย waitUntil เพื่อไม่ให้เบราว์เซอร์พัก service worker ระหว่างรอ */
self.addEventListener('message', function (ev) {
  var msg = ev.data || {};
  if (msg.type !== 'test-notify') return;
  var wait = Math.max(0, Math.min(25000, Number(msg.delay) || 0));
  ev.waitUntil(new Promise(function (resolve) {
    setTimeout(function () {
      self.registration.showNotification(msg.title || '🔔 ทดสอบแจ้งเตือน AmPayPay', {
        body: msg.body || 'ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนตอนปิดแอปใช้งานได้',
        icon: 'assets/icon-192.png',
        badge: 'assets/icon-192.png',
        tag: 'push-test',
        renotify: true,
        data: { url: './#bell' }
      }).then(resolve, resolve);
    }, wait);
  }));
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
