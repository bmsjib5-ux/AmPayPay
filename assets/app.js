/* สมุดเก็บรายจ่าย — อ่านใบเสร็จด้วย OCR แล้วบันทึกเป็นรายจ่าย */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var CATS = ReceiptParser.categories;
  var money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 });
  var moneyShort = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

  function fmtMoney(n) { return money.format(Number(n) || 0); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthKey(iso) { return (iso || '').slice(0, 7); }
  function monthLabel(key) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, 1);
    return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  }
  function monthLabelShort(key) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, 1);
    return d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  }
  function dateLabel(iso) {
    var p = (iso || '').split('-');
    if (p.length !== 3) return iso || '-';
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function shiftMonth(key, delta) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function catOptions(selected) {
    return CATS.map(function (c) {
      return '<option value="' + c.key + '"' + (c.key === selected ? ' selected' : '') + '>' +
        c.icon + '  ' + esc(c.label) + '</option>';
    }).join('');
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* ---------------- ธีม ---------------- */
  (function initTheme() {
    var mode = ExpenseStore.theme.get();
    if (mode !== 'system') document.documentElement.setAttribute('data-theme', mode);
    $('#themeBtn').addEventListener('click', function () {
      var order = ['system', 'light', 'dark'];
      var next = order[(order.indexOf(ExpenseStore.theme.get()) + 1) % order.length];
      ExpenseStore.theme.set(next);
      if (next === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', next);
      toast(next === 'system' ? 'ธีม: ตามระบบ' : next === 'light' ? 'ธีม: สว่าง' : 'ธีม: มืด');
    });
  })();

  /* ---------------- เพื่อน + ใบแจ้งหนี้ระหว่างกัน ----------------
     ฝั่งเจ้าหนี้: กด "ส่งให้เพื่อน" ในแท็บลูกหนี้ → สร้างใบแจ้งหนี้ในเซิร์ฟเวอร์
     ฝั่งลูกหนี้: เห็นใน "หนี้ที่ฉันต้องจ่าย" → กด "จ่ายแล้ว" พร้อมข้อความ
     ฝั่งเจ้าหนี้: เห็นว่าเพื่อนแจ้งจ่ายแล้ว → กด "ยืนยันได้รับ" → ตัดยอดในรายการจริง */
  var CLAIM_LABEL = {
    pending:   { text: 'รอจ่าย',           chip: 'is-warn' },
    paid:      { text: 'เพื่อนแจ้งว่าจ่ายแล้ว', chip: 'is-warn' },
    confirmed: { text: 'ได้รับเงินแล้ว',    chip: 'is-ok' },
    cancelled: { text: 'ยกเลิกแล้ว',        chip: '' }
  };

  function syncReady() {
    return CloudSync.isConfigured() && !!CloudSync.user();
  }
  function myEmail() { return (CloudSync.email() || '').toLowerCase(); }

  function claimsFor(kind) {
    var me = myEmail();
    return ExpenseStore.claims.all().filter(function (c) {
      return kind === 'out' ? c.toEmail !== me || c.fromEmail === me && c.toEmail === me
                            : c.toEmail === me && c.fromEmail !== me;
    });
  }
  function outgoingClaims() {
    var me = myEmail();
    return ExpenseStore.claims.all().filter(function (c) { return c.fromEmail === me; });
  }
  function incomingClaims() {
    var me = myEmail();
    return ExpenseStore.claims.all().filter(function (c) { return c.toEmail === me && c.fromEmail !== me; });
  }
  function claimOfPerson(expenseId, personId) {
    return outgoingClaims().filter(function (c) {
      return c.expenseId === expenseId && c.personId === personId && c.status !== 'cancelled';
    })[0] || null;
  }

  /* ---------- แท็บเพื่อน: บัตรของฉัน (QR) + รายชื่อเพื่อน ---------- */
  var PROFILE_KEY = 'expense-book:profile:v1';
  function profile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveProfile(patch) {
    var cur = profile();
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(cur)); } catch (e) {}
  }
  function myName() { return String(profile().name || '').trim(); }
  function myPromptPay() { return String(profile().promptpay || '').trim(); }

  /* ลิงก์ในบัตร: เพื่อนสแกนแล้วเปิดแอป จะเพิ่มเราเป็นเพื่อนให้ทันที */
  function friendLink(email, name) {
    return location.origin + location.pathname + '#addfriend=' + encodeURIComponent(email) +
      (name ? '&name=' + encodeURIComponent(name) : '');
  }
  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { return ''; }
  }

  function renderMeCard() {
    var body = $('#meBody');
    if (!syncReady()) {
      body.innerHTML = '<p class="banner is-warn" style="margin:0">ต้องล็อกอิน ☁️ ก่อน — อีเมลที่ใช้ล็อกอินคือรหัสประจำตัวของคุณ ' +
        'เพื่อนใช้อีเมลนี้ส่งยอดหนี้มาหาคุณได้</p>';
      return;
    }
    var email = myEmail();
    var name = myName();
    var link = friendLink(email, name);
    var svg = qrSvg(link);
    body.innerHTML = '<div class="me-body">' +
        '<div class="me-qr" aria-label="QR สำหรับเพิ่มเพื่อน">' + (svg || '<span class="muted">สร้าง QR ไม่ได้</span>') + '</div>' +
        '<div class="me-info">' +
          '<label class="field"><span class="field-label">ชื่อเล่นของฉัน (เพื่อนจะเห็นชื่อนี้)</span>' +
            '<input type="text" id="myNameInput" value="' + esc(name) + '" placeholder="เช่น แอน" maxlength="40"></label>' +
          '<div><span class="field-label">รหัสประจำตัว (อีเมลที่ล็อกอิน)</span>' +
            '<div class="me-id">' + esc(email) + '</div></div>' +
          '<label class="field"><span class="field-label">พร้อมเพย์ของฉัน (เบอร์โทร / เลขบัตร) — แนบ QR โอนคืนไปกับยอดหนี้</span>' +
            '<input type="text" id="myPromptPayInput" inputmode="tel" value="' + esc(myPromptPay()) + '" placeholder="เช่น 0812345678" maxlength="20"></label>' +
          (myPromptPay() ? '<div class="muted" id="myPromptPayNote" style="font-size:12.5px">' +
            (PromptPay.normalizeId(myPromptPay()) ? '✅ ' + esc(PromptPay.normalizeId(myPromptPay()).label) + ' — เพื่อนจะได้ QR โอนคืนพร้อมยอด'
                                                   : '⚠️ รูปแบบไม่ถูกต้อง ใส่เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก') + '</div>' : '') +
          '<div class="row-actions">' +
            '<button class="btn btn-sm" id="shareMeBtn" type="button">📤 แชร์ลิงก์เพิ่มเพื่อน</button>' +
            '<button class="btn btn-ghost btn-sm" id="copyMeBtn" type="button">คัดลอกอีเมล</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('#myNameInput').addEventListener('change', function () {
      saveProfile({ name: this.value.trim() });
      /* ชื่อเล่นติดไปกับแถวเพื่อนบนเซิร์ฟเวอร์ จึงต้องส่งแถวเพื่อนขึ้นไปใหม่ทั้งหมด */
      ExpenseStore.friends.all().forEach(function (f) { ExpenseStore.friends.save(f.email, f.name); });
      renderMeCard();
      toast('บันทึกชื่อเล่นแล้ว');
    });
    $('#myPromptPayInput').addEventListener('change', function () {
      var v = this.value.trim();
      if (v && !PromptPay.normalizeId(v)) { toast('พร้อมเพย์ไม่ถูกต้อง — ใส่เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก'); }
      saveProfile({ promptpay: v });
      renderMeCard();
      if (v && PromptPay.normalizeId(v)) toast('บันทึกพร้อมเพย์แล้ว ยอดที่ส่งให้เพื่อนครั้งต่อไปจะมี QR โอนคืน');
    });
    $('#shareMeBtn').addEventListener('click', function () {
      var text = 'เพิ่มฉันเป็นเพื่อนในสมุดรายจ่าย: ' + link;
      if (navigator.share) {
        navigator.share({ title: 'เพิ่มเพื่อน', text: text, url: link }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย'); });
      } else { prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน', link); }
    });
    $('#copyMeBtn').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).then(function () { toast('คัดลอกอีเมลแล้ว'); });
      } else { prompt('อีเมลของคุณ', email); }
    });
  }

  /* ยอดค้างระหว่างเรากับเพื่อนแต่ละคน ไว้โชว์ในรายชื่อ */
  function friendBalance(email) {
    var me = myEmail();
    var theyOwe = 0, iOwe = 0;
    ExpenseStore.claims.all().forEach(function (c) {
      if (c.status === 'confirmed' || c.status === 'cancelled') return;
      if (c.fromEmail === me && c.toEmail === email) theyOwe += c.amount;
      if (c.toEmail === me && c.fromEmail === email) iOwe += c.amount;
    });
    return { theyOwe: theyOwe, iOwe: iOwe };
  }

  function renderFriendList() {
    var list = ExpenseStore.friends.all();
    $('#friendCount').textContent = list.length ? list.length + ' คน' : '';
    $('#friendList').innerHTML = list.length ? list.map(function (f) {
      var bal = friendBalance(f.email);
      var bits = [];
      if (bal.theyOwe > 0.005) bits.push('<span class="friend-owed">ค้างเรา ' + esc(fmtMoney(bal.theyOwe)) + '</span>');
      if (bal.iOwe > 0.005) bits.push('<span class="friend-owe">เราค้าง ' + esc(fmtMoney(bal.iOwe)) + '</span>');
      return '<div class="book-row friend-row" data-email="' + esc(f.email) + '">' +
        '<div class="book-info">' +
          '<span class="book-name">' + esc(f.name || f.email) + '</span>' +
          '<span class="book-count"><span>' + esc(f.email) + '</span>' + bits.join('') + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" data-friend="rename">เปลี่ยนชื่อ</button>' +
        '<button class="btn btn-ghost btn-sm btn-danger" data-friend="del">ลบ</button>' +
      '</div>';
    }).join('') : '<p class="empty"><span class="empty-icon" aria-hidden="true">👋</span>ยังไม่มีเพื่อนในรายชื่อ<br>' +
      '<span class="muted">ให้เพื่อนสแกน QR ของคุณ หรือใส่อีเมลเพื่อนด้านบน</span></p>';
  }

  function renderFriendsTab() { renderMeCard(); renderFriendList(); }

  function addFriendFromForm() {
    var res = ExpenseStore.friends.save($('#newFriendEmail').value, $('#newFriendName').value);
    if (!res.ok) { toast(res.error); return; }
    $('#newFriendEmail').value = ''; $('#newFriendName').value = '';
    renderFriendList();
    toast('เพิ่ม ' + (res.friend.name || res.friend.email) + ' เป็นเพื่อนแล้ว');
  }
  $('#addFriendBtn').addEventListener('click', addFriendFromForm);
  $('#newFriendEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') addFriendFromForm(); });

  /* วางลิงก์ที่ได้จาก QR ของเพื่อน (กรณีสแกนด้วยแอปอื่นแล้วคัดลอกมา) */
  $('#pasteFriendBtn').addEventListener('click', function () {
    var raw = prompt('วางลิงก์หรืออีเมลของเพื่อน');
    if (raw === null) return;
    var parsed = parseFriendLink(raw);
    if (!parsed) { toast('ไม่พบอีเมลในข้อความที่วาง'); return; }
    var res = ExpenseStore.friends.save(parsed.email, parsed.name);
    if (!res.ok) { toast(res.error); return; }
    renderFriendList();
    toast('เพิ่ม ' + (parsed.name || parsed.email) + ' เป็นเพื่อนแล้ว');
  });

  function parseFriendLink(text) {
    var str = String(text || '').trim();
    var m = str.match(/[#&?]addfriend=([^&\s]+)/);
    if (m) {
      var name = (str.match(/[#&?]name=([^&\s]+)/) || [])[1];
      return { email: decodeParam(m[1]).trim().toLowerCase(), name: name ? decodeParam(name).trim() : '' };
    }
    var e = str.match(/[^@\s]+@[^@\s]+\.[^@\s]+/);
    return e ? { email: e[0].toLowerCase(), name: '' } : null;
  }

  $('#friendList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-friend]');
    if (!btn) return;
    var row = btn.closest('.friend-row');
    var email = row ? row.dataset.email : '';
    if (btn.dataset.friend === 'rename') {
      var f = ExpenseStore.friends.get(email);
      var name = prompt('ชื่อเล่นของ ' + email, f ? f.name : '');
      if (name === null) return;
      ExpenseStore.friends.save(email, name);
      renderFriendList();
    } else if (btn.dataset.friend === 'del') {
      if (!confirm('ลบ ' + email + ' ออกจากรายชื่อเพื่อน?')) return;
      ExpenseStore.friends.remove(email);
      renderFriendList();
    }
  });

  $('#friendsBtn').addEventListener('click', function () {
    var tab = document.querySelector('.tab[data-tab="friends"]');
    if (tab) tab.click();
  });

  /* สแกน QR ของเพื่อนด้วยกล้องมือถือ → เปิดลิงก์ #addfriend= มาที่นี่ */
  function importFriendFromHash() {
    var hash = location.hash || '';
    if (!/[#&]addfriend=/.test(hash)) return;
    history.replaceState(null, '', location.pathname + location.search);
    var parsed = parseFriendLink(hash);
    if (!parsed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parsed.email)) { toast('ลิงก์เพิ่มเพื่อนไม่ถูกต้อง'); return; }
    if (parsed.email === myEmail()) { toast('นี่คือบัตรของคุณเอง 🙂'); return; }
    var already = ExpenseStore.friends.get(parsed.email);
    if (!already && !confirm('เพิ่ม ' + (parsed.name ? parsed.name + ' (' + parsed.email + ')' : parsed.email) + ' เป็นเพื่อนไหม?')) return;
    ExpenseStore.friends.save(parsed.email, parsed.name || (already ? already.name : ''));
    var tab = document.querySelector('.tab[data-tab="friends"]');
    if (tab) tab.click();
    toast(already ? (parsed.name || parsed.email) + ' อยู่ในรายชื่อเพื่อนอยู่แล้ว' : 'เพิ่ม ' + (parsed.name || parsed.email) + ' เป็นเพื่อนแล้ว');
  }

  /* ---------- กระดิ่ง: เหตุการณ์จากเพื่อน (ส่งยอดมา / แจ้งจ่ายแล้ว / ยืนยันรับเงิน) ---------- */
  function friendLabel(email) {
    var f = ExpenseStore.friends.get(email);
    return (f && f.name) || email;
  }
  function timeAgo(ts) {
    var d = Date.now() - (Number(ts) || 0);
    if (d < 60e3) return 'เมื่อกี้';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' นาทีที่แล้ว';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' ชม.ที่แล้ว';
    return dateLabel(new Date(Number(ts) || 0).toISOString().slice(0, 10));
  }
  function bellEvents() {
    var me = myEmail();
    if (!me) return [];
    var seen = ExpenseStore.claims.seen.get();
    var out = [];
    ExpenseStore.claims.all().forEach(function (c) {
      var ev = null;
      var who = c.fromName || friendLabel(c.fromEmail);
      if (c.toEmail === me && c.fromEmail !== me) {
        if (c.status === 'pending') ev = { icon: '🧾', title: who + ' ส่งยอด ' + fmtMoney(c.amount) + ' มาให้คุณ', sub: c.note };
        else if (c.status === 'confirmed') ev = { icon: '✅', title: who + ' ยืนยันรับเงิน ' + fmtMoney(c.amount) + ' แล้ว', sub: c.note };
        else if (c.status === 'cancelled') ev = { icon: '🚫', title: who + ' ยกเลิกยอด ' + fmtMoney(c.amount), sub: c.note };
      } else if (c.fromEmail === me && c.status === 'paid') {
        ev = { icon: '💸', title: friendLabel(c.toEmail) + ' แจ้งว่าจ่าย ' + fmtMoney(c.amount) + ' แล้ว', sub: (c.reply ? '“' + c.reply + '” · ' : '') + c.note };
      }
      if (!ev) return;
      ev.key = c.id + ':' + c.status;
      ev.at = c.updatedAt || 0;
      ev.unseen = !seen[ev.key];
      out.push(ev);
    });
    return out.sort(function (a, b) { return b.at - a.at; }).slice(0, 50);
  }
  var bellShownCount = -1;
  function renderBell() {
    var btn = $('#bellBtn'), badge = $('#bellCount');
    var list = bellEvents();
    var n = list.filter(function (e) { return e.unseen; }).length;
    badge.hidden = n === 0;
    badge.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
    btn.title = n ? 'มีแจ้งเตือนใหม่ ' + n + ' รายการ' : 'แจ้งเตือนจากเพื่อน';
    btn.setAttribute('aria-label', btn.title);
    if (n > bellShownCount && bellShownCount >= 0) {
      btn.classList.remove('has-new'); void btn.offsetWidth; btn.classList.add('has-new');
      toast('🔔 ' + list.filter(function (e) { return e.unseen; })[0].title);
    }
    bellShownCount = n;
    reflectBellOutside(n, list);
    if (!$('#bellModal').hidden) renderBellList();
  }

  /* ให้เห็นจำนวนแจ้งเตือนจากนอกหน้าแอปด้วย: ชื่อแท็บเบราว์เซอร์ (เดสก์ท็อป), ตัวเลขบนไอคอนแอปที่ติดตั้งไว้,
     และแจ้งเตือนของระบบเมื่อผู้ใช้อนุญาต (เด้งเฉพาะรายการที่ยังไม่เคยเด้ง) */
  var baseTitle = document.title;
  var systemNotified = {};
  try { systemNotified = JSON.parse(localStorage.getItem('expense-book:notified:v1') || '{}') || {}; } catch (e) {}
  function reflectBellOutside(n, list) {
    document.title = (n ? '(' + n + ') ' : '') + baseTitle;
    try {
      if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); }
    } catch (e) {}
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    /* เด้งแจ้งเตือนของระบบเฉพาะตอนแอปไม่ได้อยู่หน้าจอ และเครื่องนี้ไม่ได้เปิด push (push จะเด้งเองผ่าน sw.js ไม่ให้ซ้ำ) */
    if (document.visibilityState === 'visible') return;
    try { if (localStorage.getItem(PUSH_LOCAL_KEY)) return; } catch (e) {}
    var fresh = list.filter(function (e) { return e.unseen && !systemNotified[e.key]; });
    if (!fresh.length) return;
    fresh.forEach(function (e) { systemNotified[e.key] = Date.now(); });
    try { localStorage.setItem('expense-book:notified:v1', JSON.stringify(systemNotified)); } catch (e) {}
    try {
      var top = fresh[0];
      var body = fresh.length > 1 ? top.title + ' และอีก ' + (fresh.length - 1) + ' รายการ' : top.title + (top.sub ? '\n' + top.sub : '');
      var note = new Notification('🔔 AmPayPay', { body: body, icon: 'assets/icon-192.png', tag: 'expense-book-bell' });
      note.onclick = function () { window.focus(); openBell(); note.close(); };
    } catch (e) {}
  }
  /* ---------- push แจ้งเตือนตอนปิดแอป ----------
     เบราว์เซอร์สมัครรับ push กับผู้ให้บริการของมันเอง (Google/Apple/Mozilla) แล้วเราจด endpoint ไว้ใน Supabase
     เมื่อเพื่อนส่งยอด/ตอบกลับ Edge Function push-notify จะยิงแจ้งเตือนมาที่ service worker (sw.js) แม้ปิดแอปอยู่ */
  var PUSH_KEY = (window.PUSH_CONFIG && window.PUSH_CONFIG.vapidPublicKey) || '';
  var PUSH_LOCAL_KEY = 'expense-book:push:v1';
  function pushSupported() {
    return !!(PUSH_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
  function isStandalone() {
    return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function urlBase64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function swReady() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับ'));
    return navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; });
  }
  function currentPushSub() {
    if (!pushSupported()) return Promise.resolve(null);
    return swReady().then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  function enablePush() {
    if (!pushSupported()) { toast('เบราว์เซอร์นี้ยังไม่รองรับ push'); return Promise.resolve(false); }
    if (!syncReady()) { toast('ต้องล็อกอิน ☁️ ก่อน'); return Promise.resolve(false); }
    if (isIOS() && !isStandalone()) { toast('บน iPhone ต้องเพิ่มแอปไว้ที่หน้าจอโฮมก่อน แล้วเปิดจากไอคอนนั้น'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('ยังไม่ได้อนุญาตการแจ้งเตือน'); return false; }
      return swReady().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUSH_KEY) });
        });
      }).then(function (sub) {
        return CloudSync.savePushSubscription(sub).then(function () {
          try { localStorage.setItem(PUSH_LOCAL_KEY, JSON.stringify({ endpoint: sub.endpoint, at: Date.now() })); } catch (e) {}
          toast('เปิด push แจ้งเตือนบนเครื่องนี้แล้ว 🎉');
          return true;
        });
      });
    }).catch(function (e) { toast('เปิด push ไม่สำเร็จ: ' + (e && e.message || e)); return false; })
      .then(function (r) { renderPushBox(); return r; });
  }
  function disablePush() {
    return currentPushSub().then(function (sub) {
      if (!sub) return false;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return syncReady() ? CloudSync.removePushSubscription(endpoint).catch(function () {}) : null;
      }).then(function () {
        try { localStorage.removeItem(PUSH_LOCAL_KEY); } catch (e) {}
        toast('ปิด push บนเครื่องนี้แล้ว');
        return true;
      });
    }).catch(function (e) { toast('ปิดไม่สำเร็จ: ' + (e && e.message || e)); return false; })
      .then(function (r) { renderPushBox(); return r; });
  }
  /* เปิดแอปมาแล้วเคยเปิด push ไว้ → ต่ออายุแถวในตารางเงียบๆ (endpoint อาจเปลี่ยนได้) */
  function refreshPushSub() {
    if (!pushSupported() || !syncReady() || Notification.permission !== 'granted') return;
    var had = null;
    try { had = JSON.parse(localStorage.getItem(PUSH_LOCAL_KEY) || 'null'); } catch (e) {}
    if (!had) return;
    currentPushSub().then(function (sub) {
      if (!sub) return;
      if (had.endpoint === sub.endpoint && Date.now() - (had.at || 0) < 7 * 86400e3) return;
      return CloudSync.savePushSubscription(sub).then(function () {
        try { localStorage.setItem(PUSH_LOCAL_KEY, JSON.stringify({ endpoint: sub.endpoint, at: Date.now() })); } catch (e) {}
      });
    }).catch(function () {});
  }
  function renderPushBox() {
    var box = $('#pushBox');
    if (!box) return;
    if (!PUSH_KEY) { box.hidden = true; return; }
    box.hidden = false;
    if (!pushSupported()) {
      box.innerHTML = '<div class="push-state">📴 แจ้งเตือนตอนปิดแอป: เบราว์เซอร์นี้ไม่รองรับ</div>' +
        '<div class="push-hint">' + (isIOS() ? 'บน iPhone/iPad ต้องใช้ iOS 16.4 ขึ้นไป และเพิ่มแอปไว้ที่หน้าจอโฮม (แชร์ → เพิ่มไปยังหน้าจอโฮม) แล้วเปิดจากไอคอนนั้น'
                                             : 'ลองใช้ Chrome, Edge, Firefox หรือ Safari รุ่นใหม่') + '</div>';
      return;
    }
    if (!syncReady()) {
      box.innerHTML = '<div class="push-state">📴 แจ้งเตือนตอนปิดแอป</div><div class="push-hint">ต้องล็อกอิน ☁️ ก่อน จึงจะเปิดได้</div>';
      return;
    }
    if (Notification.permission === 'denied') {
      box.innerHTML = '<div class="push-state">🔕 แจ้งเตือนถูกปิดไว้ในเบราว์เซอร์</div>' +
        '<div class="push-hint">ไปที่ตั้งค่าเบราว์เซอร์ → การแจ้งเตือน แล้วอนุญาตให้เว็บนี้ก่อน</div>';
      return;
    }
    box.innerHTML = '<div class="push-state">⏳ กำลังตรวจสอบ…</div>';
    currentPushSub().then(function (sub) {
      var on = !!sub && Notification.permission === 'granted';
      box.innerHTML = '<div class="push-state">' + (on ? '✅ แจ้งเตือนตอนปิดแอป: เปิดอยู่บนเครื่องนี้' : '📴 แจ้งเตือนตอนปิดแอป: ยังไม่ได้เปิด') + '</div>' +
        '<div class="push-hint">' + (on ? 'เมื่อเพื่อนส่งยอดหนี้ แจ้งว่าจ่ายแล้ว หรือยืนยันรับเงิน จะเด้งแจ้งเตือนที่เครื่องนี้แม้ไม่ได้เปิดแอป'
          : 'เปิดแล้วจะได้รับแจ้งเตือนที่เครื่องนี้แม้ไม่ได้เปิดแอป' + (isIOS() && !isStandalone() ? ' — บน iPhone ต้องเพิ่มไว้ที่หน้าจอโฮมก่อน' : '')) + '</div>' +
        '<div class="row-actions">' + (on
          ? '<button class="btn btn-ghost btn-sm" type="button" id="pushOffBtn">ปิดบนเครื่องนี้</button>'
          : '<button class="btn btn-sm btn-primary" type="button" id="pushOnBtn">🔔 เปิดแจ้งเตือนตอนปิดแอป</button>') + '</div>';
      var onBtn = $('#pushOnBtn'), offBtn = $('#pushOffBtn');
      if (onBtn) onBtn.addEventListener('click', function () { onBtn.disabled = true; enablePush(); });
      if (offBtn) offBtn.addEventListener('click', function () { offBtn.disabled = true; disablePush(); });
      $('.row-actions', box).insertAdjacentHTML('beforeend',
        '<button class="btn btn-ghost btn-sm" type="button" id="pushCheckBtn">🩺 ตรวจการตั้งค่า</button>');
      $('#pushCheckBtn').addEventListener('click', function () {
        var b = this; b.disabled = true; b.textContent = '⏳ กำลังตรวจ…';
        var old = $('#pushCheck'); if (old) old.remove();
        CloudSync.checkPushSetup().then(function (r) {
          var rows = [
            [r.table, 'ตาราง push_subscriptions', r.table ? 'มีแล้ว' : 'ยังไม่มี — รันไฟล์ supabase/schema.sql ซ้ำใน SQL Editor'],
            [r.fn, 'Edge Function push-notify', r.fnDetail || ''],
            [Notification.permission === 'granted', 'สิทธิ์แจ้งเตือนของเบราว์เซอร์', Notification.permission === 'granted' ? 'อนุญาตแล้ว' : 'ยังไม่อนุญาต'],
            [r.mine, 'เครื่องนี้ลงทะเบียนรับ push', r.mine ? 'มีแถวของบัญชีนี้แล้ว' : 'ยังไม่มี — กด “เปิดแจ้งเตือนตอนปิดแอป” หลังแก้ข้อข้างบนแล้ว']
          ];
          box.insertAdjacentHTML('beforeend', '<div id="pushCheck" class="push-hint">' + rows.map(function (x) {
            return '<div>' + (x[0] ? '✅' : '❌') + ' <b>' + esc(x[1]) + '</b> — ' + esc(x[2]) + '</div>';
          }).join('') + '<div class="muted" style="margin-top:6px">ยังตรวจ Database Webhook จากในแอปไม่ได้ — ดูที่ Database → Webhooks ว่ามี hook ของตาราง debt_claims (Insert+Update) ชี้ไป push-notify และมี header x-webhook-secret</div></div>');
          b.disabled = false; b.textContent = '🩺 ตรวจการตั้งค่า';
        }).catch(function (e) { toast('ตรวจไม่สำเร็จ: ' + e.message); b.disabled = false; b.textContent = '🩺 ตรวจการตั้งค่า'; });
      });
    });
  }
  /* ข้อความจาก service worker: push มาตอนแอปเปิดอยู่ → ซิงก์ทันที · แตะแจ้งเตือน → เปิดกระดิ่ง */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.type === 'push' && syncReady() && !ownerConflict()) runSync(true);
      if (d.type === 'open-bell') openBell();
    });
  }

  function renderBellList() {
    var body = $('#bellBody');
    if (!syncReady()) {
      body.innerHTML = '<p class="banner is-warn" style="margin:0">ต้องล็อกอิน ☁️ ก่อน — แจ้งเตือนจะมาเมื่อเพื่อนส่งยอดหนี้ แจ้งว่าจ่ายแล้ว หรือยืนยันรับเงิน</p>';
      return;
    }
    var list = bellEvents();
    body.innerHTML = list.length ? '<div class="bell-list">' + list.map(function (e) {
      return '<button type="button" class="bell-item' + (e.unseen ? ' is-new' : '') + '" data-bell="open" data-key="' + esc(e.key) + '">' +
        '<span class="bell-ic" aria-hidden="true">' + e.icon + '</span>' +
        '<span class="bell-text"><span class="bell-title">' + esc(e.title) + '</span>' +
          (e.sub ? '<span class="bell-sub">' + esc(e.sub) + '</span>' : '') + '</span>' +
        '<span class="bell-time">' + esc(timeAgo(e.at)) + '</span>' +
      '</button>';
    }).join('') + '</div>'
    : '<p class="empty"><span class="empty-icon" aria-hidden="true">🔕</span>ยังไม่มีแจ้งเตือน<br>' +
      '<span class="muted">เมื่อเพื่อนส่งยอดหนี้มา แจ้งว่าจ่ายแล้ว หรือยืนยันรับเงิน จะมาขึ้นที่นี่</span></p>';
  }
  function openBell() {
    $('#bellModal').hidden = false;
    renderBellList();
    renderPushBox();
    if (syncReady() && !ownerConflict() && Date.now() - lastSyncFinished > 30e3) runSync(true);
  }
  function closeBell() {
    $('#bellModal').hidden = true;
    ExpenseStore.claims.seen.mark(bellEvents().map(function (e) { return e.key; }));   // เปิดดูแล้วถือว่าอ่านแล้ว
    renderBell();
    renderDebtBadge();
  }
  $('#bellBtn').addEventListener('click', openBell);
  $('#bellModal').addEventListener('click', function (ev) {
    if (ev.target === this) { closeBell(); return; }
    var btn = ev.target.closest('[data-bell]');
    if (!btn) return;
    if (btn.dataset.bell === 'close') closeBell();
    else if (btn.dataset.bell === 'open') {
      closeBell();
      var tab = document.querySelector('.tab[data-tab="debt"]');
      if (tab) tab.click();
    }
  });
  $('#bellReadAllBtn').addEventListener('click', function () {
    ExpenseStore.claims.seen.mark(bellEvents().map(function (e) { return e.key; }));
    renderBell(); renderBellList(); renderDebtBadge();
  });
  $('#bellRefreshBtn').addEventListener('click', function () {
    if (!syncReady()) { toast('ต้องล็อกอิน ☁️ ก่อน'); return; }
    var btn = this; btn.disabled = true;
    CloudSync.syncNow().then(function () { renderBellList(); toast('เช็กแล้ว'); })
      .catch(function (e) { toast('เช็กไม่สำเร็จ: ' + e.message); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- QR พร้อมเพย์: ลูกหนี้เปิดดู/บันทึกรูป แล้วสแกนจากรูปในแอปธนาคาร ---------- */
  function qrCanvas(text, size) {
    var qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
    var n = qr.getModuleCount(), margin = 4, cell = Math.floor(size / (n + margin * 2));
    var px = cell * (n + margin * 2);
    var cv = document.createElement('canvas'); cv.width = px; cv.height = px;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    return cv;
  }
  function openPayModal(claimId) {
    var c = ExpenseStore.claims.all().filter(function (x) { return x.id === claimId; })[0];
    if (!c || !c.promptpay) return;
    var text = PromptPay.payload(c.promptpay, c.amount);
    var idInfo = PromptPay.normalizeId(c.promptpay);
    if (!text || !idInfo) { toast('พร้อมเพย์ของเพื่อนไม่ถูกต้อง'); return; }
    var who = c.fromName || c.fromEmail;
    $('#payBody').innerHTML = '<div class="pay-body">' +
        '<div class="pay-amount">' + fmtMoney(c.amount) + '</div>' +
        '<div class="pay-to">โอนให้ <b>' + esc(who) + '</b>' + (c.note ? ' · ' + esc(c.note) : '') + '</div>' +
        '<div class="pay-qr" aria-label="QR พร้อมเพย์">' + qrSvg(text) + '</div>' +
        '<div class="pay-id">' + esc(idInfo.label) + '</div>' +
        '<div class="row-actions">' +
          '<button class="btn btn-primary btn-sm" type="button" id="payShareBtn">💾 บันทึกรูป QR</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="payCopyBtn">คัดลอกเลขพร้อมเพย์</button>' +
        '</div>' +
        '<p class="pay-hint">บันทึกรูปแล้วเปิดแอปธนาคาร → สแกน → เลือกรูปจากอัลบั้ม ยอดเงินจะถูกใส่ให้อัตโนมัติ<br>' +
          'โอนเสร็จแล้วกลับมากด “จ่ายแล้ว แจ้งเพื่อน”</p>' +
      '</div>';
    $('#payModal').hidden = false;
    $('#payCopyBtn').addEventListener('click', function () {
      var digits = idInfo.type === '01' ? '0' + idInfo.value.slice(4) : idInfo.value;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(digits).then(function () { toast('คัดลอก ' + digits + ' แล้ว'); });
      else prompt('เลขพร้อมเพย์', digits);
    });
    $('#payShareBtn').addEventListener('click', function () {
      var cv = qrCanvas(text, 640);
      var name = 'promptpay-' + Math.round(c.amount) + '.png';
      cv.toBlob(function (blob) {
        if (!blob) { toast('สร้างรูปไม่ได้'); return; }
        var file;
        try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'QR พร้อมเพย์ ' + fmtMoney(c.amount) }).catch(function () {});
          return;
        }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        toast('บันทึกรูป QR แล้ว เปิดในแอปธนาคารได้เลย');
      }, 'image/png');
    });
  }
  function closePayModal() { $('#payModal').hidden = true; }
  $('#payModal').addEventListener('click', function (ev) {
    if (ev.target === this || ev.target.closest('[data-pay="close"]')) closePayModal();
  });

  /* ---------- ฝั่งลูกหนี้: หนี้ที่เพื่อนส่งมา ---------- */
  function renderIncoming() {
    var card = $('#incomingCard');
    if (!syncReady()) { card.hidden = true; return; }
    var list = incomingClaims().filter(function (c) { return c.status !== 'cancelled'; });
    card.hidden = !list.length;
    if (!list.length) return;

    var owed = list.filter(function (c) { return c.status !== 'confirmed'; })
      .reduce(function (a, c) { return a + c.amount; }, 0);
    $('#incomingTotal').textContent = fmtMoney(owed);
    var pendingN = list.filter(function (c) { return c.status !== 'confirmed'; }).length;
    $('#incomingSub').textContent = owed > 0.005 ? 'รอจ่าย ' + pendingN + ' รายการ' : 'เคลียร์ครบแล้ว 🎉';

    $('#incomingList').innerHTML = list.map(function (c) {
      var who = c.fromName || c.fromEmail;
      var st = CLAIM_LABEL[c.status] || CLAIM_LABEL.pending;
      return '<div class="debt-item' + (c.status === 'confirmed' ? ' is-paid' : '') + '" data-cid="' + esc(c.id) + '">' +
        '<div class="debt-item-main">' +
          '<span class="debt-item-name">' + esc(who) + '</span>' +
          '<span class="debt-item-meta">' + esc(c.note || 'ไม่ได้ระบุรายการ') +
            ' · <span class="chip ' + st.chip + '">' + esc(c.status === 'paid' ? 'แจ้งว่าจ่ายแล้ว' : st.text) + '</span>' +
            (c.reply ? ' · “' + esc(c.reply) + '”' : '') + '</span>' +
        '</div>' +
        '<span class="debt-item-amount">' + fmtMoney(c.amount) + '</span>' +
        '<span class="debt-item-actions">' +
          (c.promptpay && c.status !== 'confirmed' && PromptPay.payload(c.promptpay, c.amount)
            ? '<button class="btn btn-sm btn-primary" data-claim="qr" title="QR พร้อมเพย์ของเพื่อน พร้อมยอดที่ต้องโอน">💳 QR โอนคืน</button>' : '') +
          (expenseOfClaim(c)
            ? '<span class="chip is-ok" title="อยู่ในรายการรายจ่ายของคุณแล้ว">✓ บันทึกแล้ว</span>'
            : '<button class="btn btn-sm" data-claim="save" title="บันทึกส่วนของคุณเป็นรายจ่ายในสมุดนี้">📥 บันทึกเป็นรายจ่าย</button>') +
          (c.status === 'pending'
            ? '<button class="btn btn-sm' + (c.promptpay ? '' : ' btn-primary') + '" data-claim="pay">จ่ายแล้ว แจ้งเพื่อน</button>'
            : c.status === 'paid'
              ? '<button class="btn btn-ghost btn-sm" data-claim="unpay">ยกเลิกการแจ้ง</button>'
              : '<span class="chip is-ok">เรียบร้อย</span>') +
        '</span>' +
      '</div>';
    }).join('');
  }

  /* ใบแจ้งหนี้ที่เพื่อนส่งมา = ส่วนที่เราต้องจ่ายจริง จึงบันทึกเป็นรายจ่ายของเราได้ (นับในรายการและสรุป)
     note ของใบมีรูป "ร้าน · 13 ส.ค. 2569" ตามที่ฝั่งส่งสร้างไว้ จึงแกะร้านกับวันที่กลับมาได้ */
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function parseClaimNote(c) {
    var note = String(c.note || '');
    var parts = note.split(' · ');
    var merchant = (parts[0] || '').trim() || (c.fromName ? 'หารกับ ' + c.fromName : 'หารกับเพื่อน');
    var date = '';
    var m = note.match(/(\d{1,2})\s+(\S+\.?)\s+(\d{4})/);
    if (m) {
      var mi = TH_MONTHS.indexOf(m[2]);
      if (mi < 0) mi = TH_MONTHS.findIndex(function (x) { return x.replace(/\./g, '') === m[2].replace(/\./g, ''); });
      var y = +m[3]; if (y > 2400) y -= 543;
      if (mi >= 0) date = y + '-' + String(mi + 1).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
    }
    if (!date) date = new Date(c.createdAt || Date.now()).toISOString().slice(0, 10);
    return { merchant: merchant, date: date };
  }
  function expenseOfClaim(c) {
    var byId = ExpenseStore.allWithDeleted().filter(function (e) { return !e.deleted && e.claimId === c.id; })[0];
    if (byId) return byId;
    var info = parseClaimNote(c);
    var dup = findDuplicate({ date: info.date, amount: c.amount, merchant: info.merchant });
    return dup ? dup.record : null;
  }
  function saveClaimAsExpense(id) {
    var c = ExpenseStore.claims.all().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    if (expenseOfClaim(c)) { toast('รายการนี้อยู่ในสมุดแล้ว'); renderIncoming(); return; }
    var info = parseClaimNote(c);
    var who = c.fromName || c.fromEmail;
    var res = ExpenseStore.add({
      date: info.date,
      merchant: info.merchant,
      amount: c.amount,
      category: ReceiptParser.guessCategory(info.merchant, ''),
      note: 'หารกับ ' + who + ' (เพื่อนออกให้ก่อน)',
      claimId: c.id
    });
    renderIncoming();
    renderList();
    renderBudgetAlert();
    if ($('#panel-summary').classList.contains('is-active')) renderSummary();
    toast('บันทึก ' + fmtMoney(c.amount) + ' ลงสมุด “' + ExpenseStore.currentBookName() + '” แล้ว' +
      (res && res.result && !res.result.ok ? ' (พื้นที่ใกล้เต็ม)' : ''));
  }

  $('#incomingList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-claim]');
    if (!btn) return;
    var id = btn.closest('.debt-item').dataset.cid;
    var act = btn.dataset.claim;
    if (act === 'save') { saveClaimAsExpense(id); return; }
    if (act === 'qr') { openPayModal(id); return; }
    if (act === 'pay') {
      var reply = prompt('ข้อความถึงเพื่อน (ไม่ใส่ก็ได้)', 'โอนคืนแล้วนะ');
      if (reply === null) return;
      btn.disabled = true;
      CloudSync.updateClaim(id, { status: 'paid', reply: reply })
        .then(function () { return CloudSync.syncNow(); })
        .then(function () { renderDebts(); toast('แจ้งเพื่อนแล้วว่าจ่ายคืนแล้ว'); })
        .catch(function (e) { btn.disabled = false; toast('ส่งไม่สำเร็จ: ' + e.message); });
    } else if (act === 'unpay') {
      btn.disabled = true;
      CloudSync.updateClaim(id, { status: 'pending', reply: '' })
        .then(function () { return CloudSync.syncNow(); })
        .then(function () { renderDebts(); toast('ยกเลิกการแจ้งแล้ว'); })
        .catch(function (e) { btn.disabled = false; toast('ส่งไม่สำเร็จ: ' + e.message); });
    }
  });

  /* ---------- ฝั่งเจ้าหนี้: ส่งยอดให้เพื่อน / ยืนยันรับเงิน ---------- */
  /* ส่งยอดให้เพื่อน: เลือกได้ว่าจะส่งในแอป (เพื่อนเห็นในกระดิ่ง) ส่งทางอีเมล หรือแชร์ไปแอปอื่น (LINE ฯลฯ) */
  var sendCtx = null;
  function sendClaimFor(expenseId, personId) {
    var exp = ExpenseStore.get(expenseId);
    if (!exp) return;
    var person = splitOf(exp).filter(function (p) { return p.id === personId; })[0];
    if (!person) return;
    var friends = ExpenseStore.friends.all();
    var guess = friends.filter(function (f) {
      return (f.name || '').trim() && (f.name || '').trim() === person.name.trim();
    })[0];
    var existing = claimOfPerson(expenseId, personId);
    sendCtx = { expenseId: expenseId, personId: personId, exp: exp, person: person, existing: existing };
    var email = person.email || (guess ? guess.email : '') || (existing ? existing.toEmail : '');
    var pp = myPromptPay();
    $('#sendBody').innerHTML = '<div class="send-body">' +
        '<div class="send-sum"><span>' + esc(person.name) + '</span><b>' + fmtMoney(person.amount) + '</b></div>' +
        '<div class="muted" style="font-size:12.5px">' + esc(exp.merchant) + ' · ' + esc(dateLabel(exp.date)) + '</div>' +
        '<label class="field"><span class="field-label">อีเมลของเพื่อน</span>' +
          '<input type="email" id="sendEmail" value="' + esc(email) + '" placeholder="friend@example.com" autocomplete="off" list="sendFriendList"></label>' +
        '<datalist id="sendFriendList">' + friends.map(function (f) { return '<option value="' + esc(f.email) + '">' + esc(f.name || f.email) + '</option>'; }).join('') + '</datalist>' +
        '<div class="send-options">' +
          '<button type="button" class="action-card" id="sendAppBtn"' + (syncReady() ? '' : ' disabled') + '><span class="ac-ic" aria-hidden="true">📲</span><span class="ac-label">ในแอป AmPayPay</span>' +
            '<span class="ac-sub">' + (syncReady() ? 'เพื่อนเห็นในกระดิ่ง กดจ่ายแล้ว/สแกน QR ได้' : 'ต้องล็อกอิน ☁️ ก่อน') + '</span></button>' +
          '<button type="button" class="action-card" id="sendMailBtn"><span class="ac-ic" aria-hidden="true">✉️</span><span class="ac-label">ทางอีเมล</span>' +
            '<span class="ac-sub">เปิดแอปอีเมลพร้อมข้อความ' + (pp ? ' + เลขพร้อมเพย์' : '') + '</span></button>' +
          (navigator.share ? '<button type="button" class="action-card" id="sendShareBtn"><span class="ac-ic" aria-hidden="true">📤</span><span class="ac-label">แชร์ไปแอปอื่น</span>' +
            '<span class="ac-sub">LINE · ข้อความ · อื่นๆ</span></button>' : '') +
        '</div>' +
        (existing ? '<p class="muted" style="font-size:12.5px;margin:0">เคยส่งในแอปไปแล้ว (' + esc((CLAIM_LABEL[existing.status] || {}).text || existing.status) + ') — ส่งซ้ำจะอัปเดตยอด/พร้อมเพย์ให้</p>' : '') +
      '</div>';
    $('#sendModal').hidden = false;
    setTimeout(function () { var el = $('#sendEmail'); if (el && !el.value) el.focus(); }, 50);
  }
  function closeSendModal() { $('#sendModal').hidden = true; sendCtx = null; }
  function sendEmailValue() {
    var email = String($('#sendEmail').value || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('ใส่อีเมลของเพื่อนก่อน'); $('#sendEmail').focus(); return ''; }
    return email;
  }
  function claimMessage(ctx, email) {
    var pp = myPromptPay();
    var ppInfo = pp ? PromptPay.normalizeId(pp) : null;
    var me = myName() || myEmail() || 'เพื่อนของคุณ';
    var lines = [
      'สวัสดี ' + ctx.person.name,
      me + ' ออกค่า ' + ctx.exp.merchant + ' ให้ก่อน (' + dateLabel(ctx.exp.date) + ')',
      'ยอดของคุณ: ' + fmtMoney(ctx.person.amount) + (ctx.exp.amount ? ' (บิลรวม ' + fmtMoney(ctx.exp.amount) + ')' : ''),
      ppInfo ? 'โอนคืนทางพร้อมเพย์: ' + ppInfo.label.replace(/^เบอร์ |^บัตรประชาชน |^e-Wallet /, '') : '',
      '',
      'ดูรายละเอียด / กดจ่ายแล้ว / สแกน QR โอนคืน ได้ในแอป AmPayPay: ' + location.origin + location.pathname +
        (email ? '#addfriend=' + encodeURIComponent(myEmail()) + (myName() ? '&name=' + encodeURIComponent(myName()) : '') : '')
    ].filter(function (l, i) { return l !== '' || i === 4; });
    return { subject: 'ยอดค้าง ' + fmtMoney(ctx.person.amount) + ' — ' + ctx.exp.merchant, body: lines.join('\n') };
  }
  function sendClaimInApp(ctx, email) {
    if (!syncReady()) { toast('ต้องเปิดซิงก์ ☁️ และล็อกอินก่อน จึงจะส่งในแอปได้'); return Promise.resolve(false); }
    ExpenseStore.friends.save(email, ctx.person.name);
    var existing = ctx.existing;
    return CloudSync.sendClaim({
      id: existing ? existing.id : ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      toEmail: email,
      amount: ctx.person.amount,
      note: ctx.exp.merchant + ' · ' + dateLabel(ctx.exp.date),
      expenseId: ctx.expenseId,
      personId: ctx.personId,
      fromName: myName(),
      promptpay: myPromptPay(),
      status: existing ? existing.status : 'pending'
    }).then(function () { return CloudSync.syncNow(); })
      .then(function () { renderDebts(); return true; })
      .catch(function (e) { toast('ส่งไม่สำเร็จ: ' + e.message); return false; });
  }
  $('#sendModal').addEventListener('click', function (ev) {
    if (ev.target === this || ev.target.closest('[data-send="close"]')) { closeSendModal(); return; }
    var ctx = sendCtx;
    if (!ctx) return;
    if (ev.target.closest('#sendAppBtn')) {
      var email = sendEmailValue(); if (!email) return;
      var btn = $('#sendAppBtn'); btn.disabled = true;
      sendClaimInApp(ctx, email).then(function (okk) {
        if (okk) { closeSendModal(); toast('ส่งยอดให้ ' + email + ' ในแอปแล้ว'); } else btn.disabled = false;
      });
    } else if (ev.target.closest('#sendMailBtn')) {
      var email2 = sendEmailValue(); if (!email2) return;
      ExpenseStore.friends.save(email2, ctx.person.name);
      var m = claimMessage(ctx, email2);
      var href = 'mailto:' + encodeURIComponent(email2) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
      document.body.dataset.lastMailto = href;        // ให้เทสต์อ่านได้ (เบราว์เซอร์ทดสอบเปิด mailto ไม่ได้)
      window.location.href = href;
      /* ส่งในแอปควบคู่ไปด้วยถ้าล็อกอินอยู่ จะได้ติดตามสถานะได้ */
      (syncReady() ? sendClaimInApp(ctx, email2) : Promise.resolve(false)).then(function (okk) {
        closeSendModal();
        toast(okk ? 'เปิดอีเมลแล้ว และส่งในแอปให้ด้วย' : 'เปิดแอปอีเมลพร้อมข้อความแล้ว');
      });
    } else if (ev.target.closest('#sendShareBtn')) {
      var email3 = String($('#sendEmail').value || '').trim().toLowerCase();
      var m2 = claimMessage(ctx, email3);
      navigator.share({ title: m2.subject, text: m2.body }).then(function () {
        if (email3 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email3)) ExpenseStore.friends.save(email3, ctx.person.name);
        closeSendModal(); toast('แชร์ข้อความแล้ว');
      }).catch(function () {});
    }
  });

  /* บันทึกรายจ่ายที่หารกับเพื่อนที่เลือกจากรายชื่อ → ส่งใบแจ้งหนี้ให้เขาเลยโดยไม่ต้องกดส่งเอง
     เครื่องเพื่อนจะได้กระดิ่งแจ้งเตือนตอนซิงก์ครั้งถัดไป */
  function autoSendClaims(expenseId) {
    if (!syncReady() || ownerConflict()) return Promise.resolve(0);
    var exp = ExpenseStore.get(expenseId);
    if (!exp) return Promise.resolve(0);
    var me = myEmail();
    var jobs = [];
    splitOf(exp).forEach(function (p) {
      if (!p.email || p.email === me) return;
      var existing = claimOfPerson(expenseId, p.id);
      if (existing && (existing.status !== 'pending' || Math.abs(existing.amount - p.amount) < 0.005)) return;
      if (!existing && p.paid) return;
      jobs.push({
        id: existing ? existing.id : ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
        toEmail: p.email,
        amount: p.amount,
        note: exp.merchant + ' · ' + dateLabel(exp.date),
        expenseId: expenseId,
        personId: p.id,
        fromName: myName(),
        promptpay: myPromptPay(),
      promptpay: myPromptPay(),
        status: existing ? existing.status : 'pending'
      });
    });
    if (!jobs.length) return Promise.resolve(0);
    return Promise.all(jobs.map(function (c) { return CloudSync.sendClaim(c); }))
      .then(function () { return CloudSync.syncNow(); })
      .then(function () {
        renderDebtBadge();
        if ($('#panel-debt').classList.contains('is-active')) renderDebts();
        toast('📨 ส่งแจ้งยอดให้เพื่อน ' + jobs.length + ' คนแล้ว');
        return jobs.length;
      })
      .catch(function (e) { toast('ส่งแจ้งยอดให้เพื่อนไม่สำเร็จ: ' + e.message); return 0; });
  }

  function confirmClaim(id) {
    var claim = ExpenseStore.claims.all().filter(function (c) { return c.id === id; })[0];
    if (!claim) return;
    CloudSync.updateClaim(id, { status: 'confirmed' }).then(function () {
      if (claim.expenseId && claim.personId) setPaid(claim.expenseId, claim.personId, true);
      return CloudSync.syncNow();
    }).then(function () {
      renderDebts(); renderList();
      toast('ยืนยันรับเงินแล้ว ตัดยอดค้างให้เรียบร้อย');
    }).catch(function (e) { toast('ยืนยันไม่สำเร็จ: ' + e.message); });
  }

  $('#claimSyncBtn').addEventListener('click', function () {
    if (!syncReady()) { toast('ต้องเปิดซิงก์ ☁️ และล็อกอินก่อน'); return; }
    var btn = this;
    btn.disabled = true;
    CloudSync.syncNow().then(function (res) {
      renderDebts();
      var n = res && res.claims ? res.claims.changed : 0;
      toast(n ? 'มีอัปเดตจากเพื่อน ' + n + ' รายการ' : 'อัปเดตแล้ว ยังไม่มีอะไรเปลี่ยน');
    }).catch(function (e) { toast('อัปเดตไม่สำเร็จ: ' + e.message); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------------- รับข้อความใบเสร็จจาก Shortcuts (iPhone) ----------------
     เว็บแอปเปิดอัลบั้มรูปเองไม่ได้ (เบราว์เซอร์ห้ามไว้) แต่ Shortcuts บน iPhone เปิดได้
     จึงให้ Shortcut หยิบรูปจากอัลบั้ม อ่านข้อความด้วย Live Text แล้วส่งมาที่
     https://<เว็บ>/#slip=<ข้อความ>  แอปจะแยกข้อมูลด้วยตัวแยกเดิมแล้ววางเป็นการ์ดรอบันทึกให้
     ใช้ hash (#) ไม่ใช่ query (?) เพราะข้อความหลัง # ไม่ถูกส่งไปที่เซิร์ฟเวอร์ */
  /* ตัวคั่นระหว่างใบเสร็จหลายใบในลิงก์เดียว
     ใช้ ###SLIP### เพราะแอปคำสั่งลัดใส่ตัวคั่นแบบขึ้นบรรทัดใหม่ไม่สะดวก
     และคำนี้ไม่มีทางโผล่ในใบเสร็จจริง — เคยรองรับเส้นขีดทั้งบรรทัดด้วย แต่เลิกแล้ว
     เพราะสลิปหลายแบบมีเส้นขีดคั่นอยู่ข้างใน ทำให้ใบเดียวถูกหั่นเป็นสองใบ */
  var SLIP_SEPARATOR = /\s*###\s*SLIP\s*###\s*/i;

  function decodeParam(v) {
    try { return decodeURIComponent(String(v).replace(/\+/g, ' ')); }
    catch (e) { return String(v); }
  }

  /* หาสมุดจากชื่อหรือรหัสที่ Shortcut ส่งมา — เทียบชื่อแบบไม่สนช่องว่างและตัวพิมพ์ */
  function findBookByHint(hint) {
    var want = String(hint || '').trim();
    if (!want) return null;
    var books = ExpenseStore.books();
    var norm = function (t) { return String(t).replace(/\s+/g, '').toLowerCase(); };
    var byId = books.filter(function (b) { return b.id === want; })[0];
    if (byId) return byId;
    return books.filter(function (b) { return norm(b.name) === norm(want); })[0] || null;
  }

  function importFromHash() {
    var hash = location.hash || '';
    var m = hash.match(/[#&]slips?=([^&]*)/);
    if (!m) return;
    var bookHint = (hash.match(/[#&]book=([^&]*)/) || [])[1];
    history.replaceState(null, '', location.pathname + location.search);   // กันนำเข้าซ้ำตอนรีเฟรช

    var bookNote = '';
    if (bookHint) {
      var want = decodeParam(bookHint);
      var book = findBookByHint(want);
      if (!book) {
        bookNote = ' · ไม่พบสมุด “' + want + '” จึงใส่ไว้ในสมุด “' + ExpenseStore.currentBookName() + '”';
      } else if (book.id !== ExpenseStore.currentBook()) {
        switchBook(book.id);                       // ต้องสลับก่อนสร้างการ์ด เพราะสลับสมุดแล้วคิวจะถูกล้าง
        bookNote = ' · เข้าสมุด “' + book.name + '”';
      } else {
        bookNote = ' · สมุด “' + book.name + '”';
      }
    }

    var raw;
    raw = decodeParam(m[1]).slice(0, 60000).trim();
    if (!raw) { toast('ไม่พบข้อความใบเสร็จในลิงก์'); return; }

    var chunks = raw.split(SLIP_SEPARATOR)
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length >= 8; })
      .slice(0, 30);
    if (!chunks.length) { toast('ข้อความสั้นเกินไป อ่านเป็นใบเสร็จไม่ได้'); return; }

    chunks.forEach(function (text) {
      var parsed = ReceiptParser.parse(text);
      if (!parsed.date) parsed.date = todayISO();
      var learned = categoryFromHistory(parsed.merchant);
      if (learned) parsed.category = learned;
      else if (parsed.category === 'other') parsed.category = ReceiptParser.guessCategory(parsed.merchant, parsed.note);

      var card = {
        status: 'done', thumb: null, file: null, parsed: parsed,
        statusText: parsed.amount != null
          ? '📲 รับจาก Shortcut แล้ว — ตรวจสอบข้อมูลก่อนบันทึก'
          : '📲 รับจาก Shortcut แล้ว แต่หายอดเงินไม่เจอ กรุณาใส่เอง'
      };
      card.dupHint = findDuplicate({ date: parsed.date, amount: parsed.amount, merchant: parsed.merchant, rawText: text });
      addCard(card);
    });

    var addTab = document.querySelector('.tab[data-tab="add"]');
    if (addTab) addTab.click();
    var found = chunks.filter(function (t) { return ReceiptParser.parse(t).amount != null; }).length;
    toast('รับใบเสร็จจาก Shortcut ' + chunks.length + ' ใบ' +
      (found < chunks.length ? ' · อ่านยอดได้ ' + found + ' ใบ' : '') + bookNote + ' — ตรวจแล้วกดบันทึกได้เลย');
  }

  /* ---------------- หารบิลกับเพื่อน / ลูกหนี้ ---------------- */
  function splitOf(exp) {
    return (exp && exp.split && Array.isArray(exp.split.people)) ? exp.split.people : [];
  }
  function owedOf(exp) {                                  // ยอดที่ยังไม่ได้คืน
    return splitOf(exp).reduce(function (sum, p) { return sum + (p.paid ? 0 : p.amount); }, 0);
  }
  function lentOf(exp) {                                  // ยอดที่ออกให้เพื่อนทั้งหมด (รวมที่คืนแล้ว)
    return splitOf(exp).reduce(function (sum, p) { return sum + p.amount; }, 0);
  }
  function myShare(exp) {
    return Math.max(0, (Number(exp.amount) || 0) - lentOf(exp));
  }

  /* กล่องหารบิลในฟอร์ม — ใช้ได้ทั้งตอนบันทึกใหม่และตอนแก้ไขรายการเดิม */
  function splitBox(exp, open) {
    var people = splitOf(exp);
    return '<details class="raw split-box"' + (open || people.length ? ' open' : '') + '>' +
      '<summary>➗ หารกับเพื่อน / ออกให้ก่อน' +
        (people.length ? ' <span class="pill">' + people.length + ' คน</span>' : '') + '</summary>' +
      '<div class="split-body">' +
        '<div class="row-actions split-tools">' +
          '<label class="field"><span class="field-label">หารกี่คน (รวมคุณ)</span>' +
            '<input type="number" class="split-n" min="2" max="20" step="1" value="' +
              (people.length ? people.length + 1 : 2) + '"></label>' +
          '<button type="button" class="btn btn-sm" data-split="even">แบ่งเท่ากัน</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-split="add">+ เพิ่มคน</button>' +
        '</div>' +
        '<div class="split-rows">' + people.map(splitRow).join('') + '</div>' +
        '<p class="split-foot muted"></p>' +
      '</div>' +
    '</details>';
  }
  function friendPicker(selected) {
    var friends = ExpenseStore.friends.all();
    if (!friends.length) return '';
    return '<select class="sp-pick" aria-label="เลือกจากรายชื่อเพื่อน" title="เลือกจากรายชื่อเพื่อน">' +
      '<option value="">👥 เลือกเพื่อน</option>' +
      friends.map(function (f) {
        return '<option value="' + esc(f.email) + '"' + (f.email === selected ? ' selected' : '') + '>' +
          esc(f.name || f.email) + '</option>';
      }).join('') +
    '</select>';
  }
  function splitRow(p) {
    p = p || {};
    return '<div class="split-row" data-pid="' + esc(p.id || '') + '" data-email="' + esc(p.email || '') + '">' +
      friendPicker(p.email || '') +
      '<input type="text" class="sp-name" placeholder="ชื่อเพื่อน (พิมพ์เองได้)" value="' + esc(p.name || '') + '">' +
      '<input type="number" class="sp-amt" min="0" step="0.01" placeholder="0.00" value="' +
        (p.amount != null ? p.amount : '') + '">' +
      '<label class="sp-paid"><input type="checkbox" class="sp-cb"' + (p.paid ? ' checked' : '') + '> คืนแล้ว</label>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-split="del" aria-label="ลบคนนี้">✕</button>' +
    '</div>';
  }
  function readSplit(scope) {
    var people = [];
    $$('.split-row', scope).forEach(function (row) {
      var amount = ReceiptParser.toNumber($('.sp-amt', row).value);
      if (!amount || amount <= 0) return;
      people.push({
        id: row.dataset.pid || '',
        name: $('.sp-name', row).value,
        email: row.dataset.email || '',
        amount: amount,
        paid: $('.sp-cb', row).checked
      });
    });
    return { people: people };
  }
  function totalInForm(scope) {
    var el = $('[data-f="amount"]', scope) || $('[data-ef="amount"]', scope);
    return el ? (ReceiptParser.toNumber(el.value) || 0) : 0;
  }
  function refreshSplitFoot(box) {
    var foot = $('.split-foot', box);
    if (!foot) return;
    var scope = box.closest('.rcard, .ecard') || box;
    var total = totalInForm(scope);
    var people = readSplit(box).people;
    var lent = people.reduce(function (a, p) { return a + p.amount; }, 0);
    var owed = people.reduce(function (a, p) { return a + (p.paid ? 0 : p.amount); }, 0);
    if (!people.length) { foot.textContent = 'ใส่ชื่อเพื่อนกับยอดที่เขาต้องคืน แล้วยอดค้างจะไปโผล่ในแท็บ “ลูกหนี้”'; return; }
    var mine = total - lent;
    foot.textContent = 'ส่วนของคุณ ' + fmtMoney(Math.max(0, mine)) + ' · ออกให้เพื่อน ' + fmtMoney(lent) +
      ' · ยังค้าง ' + fmtMoney(owed) + (mine < -0.005 ? ' ⚠️ ยอดหารเกินยอดบิล' : '');
  }
  function splitEven(box) {
    var scope = box.closest('.rcard, .ecard') || box;
    var total = totalInForm(scope);
    var n = Math.max(2, Math.min(20, parseInt($('.split-n', box).value, 10) || 2));
    var rowsEl = $('.split-rows', box);
    var rows = $$('.split-row', rowsEl);
    while (rows.length < n - 1) { rowsEl.insertAdjacentHTML('beforeend', splitRow({})); rows = $$('.split-row', rowsEl); }
    while (rows.length > n - 1) { rows.pop().remove(); }
    if (!total) { toast('ใส่จำนวนเงินก่อน แล้วกด “แบ่งเท่ากัน” อีกครั้ง'); refreshSplitFoot(box); return; }
    var each = Math.round((total / n) * 100) / 100;
    $$('.split-row', rowsEl).forEach(function (row) { $('.sp-amt', row).value = each; });
    refreshSplitFoot(box);
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-split]');
    if (!btn) return;
    var box = btn.closest('.split-box');
    if (!box) return;
    ev.preventDefault();
    var act = btn.dataset.split;
    if (act === 'even') splitEven(box);
    else if (act === 'add') { $('.split-rows', box).insertAdjacentHTML('beforeend', splitRow({})); refreshSplitFoot(box); }
    else if (act === 'del') { btn.closest('.split-row').remove(); refreshSplitFoot(box); }
  });
  /* เลือกเพื่อนจากรายชื่อ → ใส่ชื่อให้และจำอีเมลไว้ (ส่งยอดให้เพื่อนอัตโนมัติตอนบันทึก)
     พิมพ์ชื่อเองก็ได้ ถ้าชื่อตรงกับเพื่อนในรายชื่อพอดีจะจับคู่อีเมลให้เอง */
  document.addEventListener('change', function (ev) {
    if (!ev.target.matches || !ev.target.matches('.sp-pick')) return;
    var row = ev.target.closest('.split-row');
    var f = ev.target.value ? ExpenseStore.friends.get(ev.target.value) : null;
    row.dataset.email = f ? f.email : '';
    if (f) $('.sp-name', row).value = f.name || f.email;
  });
  document.addEventListener('input', function (ev) {
    if (!ev.target.matches || !ev.target.matches('.sp-name')) return;
    var row = ev.target.closest('.split-row');
    var typed = ev.target.value.trim().toLowerCase();
    var match = ExpenseStore.friends.all().filter(function (f) { return (f.name || '').trim().toLowerCase() === typed; })[0];
    var pick = $('.sp-pick', row);
    if (match) { row.dataset.email = match.email; if (pick) pick.value = match.email; }
    /* แก้ชื่อของคนที่เลือกไว้เล็กน้อย ยังถือว่าเป็นคนเดิม จึงไม่ล้างอีเมล */
  });
  ['input', 'change'].forEach(function (evt) {
    document.addEventListener(evt, function (ev) {
      var box = ev.target.closest && ev.target.closest('.split-box');
      if (box) { refreshSplitFoot(box); return; }
      if (ev.target.matches && ev.target.matches('[data-f="amount"], [data-ef="amount"]')) {
        var scope = ev.target.closest('.rcard, .ecard');
        var b = scope && $('.split-box', scope);
        if (b) refreshSplitFoot(b);
      }
    });
  });

  /* ---------------- แท็บลูกหนี้: รวมยอดค้างรายคน ---------------- */
  function debtGroups() {
    var byName = {};
    ExpenseStore.all().forEach(function (e) {
      splitOf(e).forEach(function (p) {
        var key = p.name.trim().toLowerCase() || 'เพื่อน';
        if (!byName[key]) byName[key] = { name: p.name.trim() || 'เพื่อน', owed: 0, paid: 0, items: [] };
        var g = byName[key];
        if (p.paid) g.paid += p.amount; else g.owed += p.amount;
        g.items.push({ expenseId: e.id, personId: p.id, date: e.date, merchant: e.merchant,
                       amount: p.amount, paid: p.paid, total: e.amount });
      });
    });
    return Object.keys(byName).map(function (k) { return byName[k]; })
      .map(function (g) {
        g.items.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        return g;
      })
      .sort(function (a, b) { return (b.owed - a.owed) || (b.paid - a.paid); });
  }

  function debtRow(it) {
    var claim = claimOfPerson(it.expenseId, it.personId);
    var claimBits = '';
    if (claim) {
      var st = CLAIM_LABEL[claim.status] || CLAIM_LABEL.pending;
      claimBits = ' · <span class="chip ' + st.chip + '">📨 ' + esc(st.text) + '</span>' +
        (claim.reply ? ' “' + esc(claim.reply) + '”' : '');
    }
    var extra = '';
    if (!it.paid && syncReady()) {
      extra = claim && claim.status === 'paid'
        ? '<button class="btn btn-sm btn-primary" data-debt="confirm" data-cid="' + esc(claim.id) + '">ยืนยันได้รับ</button>'
        : '<button class="btn btn-sm" data-debt="send">' + (claim ? 'ส่งซ้ำ' : '📨 ส่งให้เพื่อน') + '</button>';
    }
    return '<div class="debt-item' + (it.paid ? ' is-paid' : '') + '" data-eid="' + esc(it.expenseId) +
        '" data-pid="' + esc(it.personId) + '">' +
      '<div class="debt-item-main">' +
        '<span class="debt-item-name">' + esc(it.merchant) + '</span>' +
        '<span class="debt-item-meta">' + esc(dateLabel(it.date)) + ' · บิลรวม ' + esc(moneyShort.format(it.total)) +
          claimBits + '</span>' +
      '</div>' +
      '<span class="debt-item-amount">' + fmtMoney(it.amount) + '</span>' +
      '<span class="debt-item-actions">' + extra +
        '<button class="btn btn-sm' + (it.paid ? ' btn-ghost' : '') + '" data-debt="' +
          (it.paid ? 'unpay' : 'pay') + '">' + (it.paid ? 'ยกเลิก' : 'รับเงินแล้ว') + '</button>' +
      '</span>' +
    '</div>';
  }

  function renderDebts() {
    renderIncoming();
    var groups = debtGroups();
    var owing = groups.filter(function (g) { return g.owed > 0.005; });
    var totalOwed = groups.reduce(function (a, g) { return a + g.owed; }, 0);
    var totalPaid = groups.reduce(function (a, g) { return a + g.paid; }, 0);

    $('#debtTotal').textContent = fmtMoney(totalOwed);
    $('#debtPeople').textContent = String(owing.length);
    $('#debtPaid').textContent = fmtMoney(totalPaid);
    $('#debtFoot').textContent = owing.length
      ? 'ค้างมากสุด: ' + owing[0].name + ' ' + fmtMoney(owing[0].owed)
      : (totalPaid ? 'เคลียร์ครบแล้ว 🎉' : 'ยังไม่มีรายการที่ออกให้เพื่อน');

    if (!groups.length) {
      $('#debtList').innerHTML = '<p class="empty"><span class="empty-icon" aria-hidden="true">🧑‍🤝‍🧑</span>' +
        'ยังไม่มีลูกหนี้<br><span class="muted">ตอนบันทึกรายจ่าย เปิด “➗ หารกับเพื่อน / ออกให้ก่อน” ' +
        'ใส่ชื่อเพื่อนกับยอดที่เขาต้องคืน</span></p>';
      renderDebtBadge();
      return;
    }

    $('#debtList').innerHTML = groups.map(function (g) {
      var unpaid = g.items.filter(function (i) { return !i.paid; });
      var paidItems = g.items.filter(function (i) { return i.paid; });
      return '<section class="debt-card' + (g.owed > 0.005 ? '' : ' is-clear') + '" data-name="' + esc(g.name) + '">' +
        '<header class="debt-head">' +
          '<div>' +
            '<h3 class="debt-name">' + (g.owed > 0.005 ? '🧑‍🤝‍🧑 ' : '✅ ') + esc(g.name) + '</h3>' +
            '<p class="debt-sub">' + (g.owed > 0.005
              ? 'ค้าง ' + unpaid.length + ' รายการ'
              : 'จ่ายคืนครบแล้ว ' + paidItems.length + ' รายการ') +
              (g.paid > 0.005 && g.owed > 0.005 ? ' · คืนแล้ว ' + fmtMoney(g.paid) : '') + '</p>' +
          '</div>' +
          '<span class="debt-total' + (g.owed > 0.005 ? ' is-owed' : '') + '">' + fmtMoney(g.owed) + '</span>' +
          (g.owed > 0.005
            ? '<button class="btn btn-sm" data-debt="payall">รับครบแล้ว</button>'
            : '') +
        '</header>' +
        (unpaid.length ? '<div class="debt-items">' + unpaid.map(debtRow).join('') + '</div>' : '') +
        (paidItems.length
          ? '<details class="raw"><summary>ที่จ่ายคืนแล้ว ' + paidItems.length + ' รายการ (' + fmtMoney(g.paid) + ')</summary>' +
            '<div class="debt-items">' + paidItems.map(debtRow).join('') + '</div></details>'
          : '') +
      '</section>';
    }).join('');
    renderDebtBadge();
  }

  function setPaid(expenseId, personId, paid) {
    var exp = ExpenseStore.get(expenseId);
    if (!exp) return false;
    var people = splitOf(exp).map(function (p) {
      return p.id === personId ? Object.assign({}, p, { paid: paid, paidAt: paid ? Date.now() : null }) : p;
    });
    ExpenseStore.update(expenseId, { split: { people: people } });
    return true;
  }

  $('#debtList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-debt]');
    if (!btn) return;
    var act = btn.dataset.debt;
    if (act === 'payall') {
      var cardEl = btn.closest('.debt-card');
      var rows = $$('.debt-item:not(.is-paid)', cardEl);
      if (!rows.length) return;
      if (!confirm('บันทึกว่า "' + cardEl.dataset.name + '" จ่ายคืนครบทุกรายการแล้วใช่ไหม?')) return;
      rows.forEach(function (row) { setPaid(row.dataset.eid, row.dataset.pid, true); });
      toast('เคลียร์ยอดของ ' + cardEl.dataset.name + ' แล้ว 🎉');
    } else if (act === 'send') {
      var sendRow = btn.closest('.debt-item');
      sendClaimFor(sendRow.dataset.eid, sendRow.dataset.pid);
      return;
    } else if (act === 'confirm') {
      confirmClaim(btn.dataset.cid);
      return;
    } else {
      var row = btn.closest('.debt-item');
      if (!row) return;
      setPaid(row.dataset.eid, row.dataset.pid, act === 'pay');
      toast(act === 'pay' ? 'บันทึกว่าได้รับเงินคืนแล้ว' : 'ย้อนกลับเป็นยังค้างจ่าย');
    }
    renderDebts();
    renderList();
  });

  /* ป้ายตัวเลขบนแท็บ ให้เห็นยอดค้างโดยไม่ต้องเข้าไปดู */
  /* ป้ายบนแท็บลูกหนี้ = จำนวนรายการที่ยังค้างชำระ (เพื่อนค้างเรา + เราค้างเพื่อน) รายละเอียดยอดเงินอยู่ใน tooltip */
  function renderDebtBadge() {
    var badge = $('#debtBadge');
    if (!badge) return;
    var owed = 0, owedCount = 0;
    ExpenseStore.allWithDeleted().forEach(function (e) {
      if (e.deleted) return;
      splitOf(e).forEach(function (p) { if (!p.paid) { owed += p.amount; owedCount++; } });
    });
    var mine = 0, mineCount = 0;
    incomingClaims().forEach(function (c) {
      if (c.status === 'pending' || c.status === 'paid') { mine += c.amount; mineCount++; }
    });
    var news = bellEvents().filter(function (e) { return e.unseen; }).length;
    var count = owedCount + mineCount;
    badge.hidden = count === 0;
    badge.textContent = count ? (count > 99 ? '99+' : String(count)) : '';
    badge.classList.toggle('has-new', news > 0);
    badge.title = (owedCount ? 'เพื่อนค้างคุณ ' + owedCount + ' รายการ รวม ' + fmtMoney(owed) : '') +
      (owedCount && mineCount ? ' · ' : '') +
      (mineCount ? 'คุณค้างเพื่อน ' + mineCount + ' รายการ รวม ' + fmtMoney(mine) : '') +
      (news ? ' · มีอัปเดตจากเพื่อน ' + news + ' รายการ' : '');
    badge.setAttribute('aria-label', 'ค้างชำระ ' + count + ' รายการ');
  }

  /* ป้ายบนแท็บเพื่อน = จำนวนเพื่อนในรายชื่อ */
  function renderFriendBadge() {
    var badge = $('#friendBadge');
    if (!badge) return;
    var n = ExpenseStore.friends.all().length;
    badge.hidden = n === 0;
    badge.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
    badge.title = n ? 'เพื่อน ' + n + ' คน' : '';
    badge.setAttribute('aria-label', 'เพื่อน ' + n + ' คน');
  }

  /* ---------------- ดูรูปใบเสร็จแบบขยาย ---------------- */
  var viewerURL = '';
  function openViewer(src, alt) {
    var pic = $('#imgModalPic');
    pic.src = src;
    pic.alt = alt || 'รูปใบเสร็จขยาย';
    $('#imgModal').hidden = false;
  }
  function closeViewer() {
    $('#imgModal').hidden = true;
    $('#imgModalPic').removeAttribute('src');
    if (viewerURL) { URL.revokeObjectURL(viewerURL); viewerURL = ''; }
  }
  function zoomFrom(img) {
    var cardEl = img.closest('.rcard');
    var card = cardEl && queue.filter(function (c) { return c.el === cardEl; })[0];
    if (card && card.file) {                     // ใบที่ยังอยู่ในคิว มีไฟล์ต้นฉบับ จึงขยายได้เต็มความละเอียด
      if (viewerURL) URL.revokeObjectURL(viewerURL);
      viewerURL = URL.createObjectURL(card.file);
      openViewer(viewerURL, img.alt);
      return;
    }
    openViewer(img.src, img.alt);                // รายการที่บันทึกแล้ว ใช้รูปย่อที่เก็บไว้
  }
  document.addEventListener('click', function (ev) {
    var img = ev.target.closest('img.zoomable');
    if (img) { ev.preventDefault(); ev.stopPropagation(); zoomFrom(img); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var img = ev.target.closest && ev.target.closest('img.zoomable');
    if (img) { ev.preventDefault(); zoomFrom(img); }
  });
  $('#imgModal').addEventListener('click', function (ev) {
    if (ev.target === this || ev.target.closest('[data-img="close"]') || ev.target.id === 'imgModalPic') closeViewer();
  });

  /* ---------------- พื้นหลังของฉัน ----------------
     เก็บไว้ในเครื่องเท่านั้น (ไม่ซิงก์ขึ้นเซิร์ฟเวอร์ เหมือนรูปใบเสร็จ)
     รูปถูกย่อก่อนเก็บ เพราะ localStorage มีพื้นที่จำกัด */
  var BG_KEY = 'expense-book:bg:v2';
  var BG_KEY_OLD = 'expense-book:bg:v1';
  var BG_IMG_KEY = 'expense-book:bg-img:v1';       // ที่เก็บสำรอง ใช้เมื่อเครื่องไม่มี IndexedDB
  /* iOS Safari ให้พื้นที่ localStorage แค่ ~5 MB และนับเป็น UTF-16 (2 ไบต์ต่อตัวอักษร)
     รูปพื้นหลังจึงมักใส่ไม่ลงบน iPhone ทั้งที่ลงได้สบายบน Android
     เก็บรูปไว้ใน IndexedDB ซึ่งมีพื้นที่มากกว่ามาก แล้วเหลือแค่ค่าตั้งค่าเล็กๆ ไว้ใน localStorage */
  var BG_DB = 'expense-book-bg', BG_STORE = 'img', BG_ROW = 'current';

  function bgDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('เครื่องนี้ไม่รองรับ IndexedDB')); return; }
      var req;
      try { req = indexedDB.open(BG_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(BG_STORE)) req.result.createObjectStore(BG_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = req.onblocked = function () { reject(req.error || new Error('เปิดที่เก็บรูปไม่ได้')); };
    });
  }
  function bgIDB(mode, run) {
    return bgDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BG_STORE, mode);
        var out = run(tx.objectStore(BG_STORE));
        tx.oncomplete = function () { db.close(); resolve(out && 'result' in out ? out.result : true); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('เขียนที่เก็บรูปไม่สำเร็จ')); };
      });
    });
  }
  function bgImgPut(url) { return bgIDB('readwrite', function (st) { return st.put(url, BG_ROW); }); }
  function bgImgGet() { return bgIDB('readonly',  function (st) { return st.get(BG_ROW); }); }
  function bgImgDel() { return bgIDB('readwrite', function (st) { return st.delete(BG_ROW); }); }
  var BG_PRESETS = [
    { id: 'none',   label: 'ค่าเริ่มต้น', swatch: 'linear-gradient(135deg,#efe9ff,#ffeede)' },
    { id: 'mint',   label: 'มินต์',      css: 'linear-gradient(160deg,#d8f3e6 0%,#eef7ff 55%,#fdf1e3 100%)', swatch: 'linear-gradient(135deg,#d8f3e6,#fdf1e3)' },
    { id: 'sunset', label: 'พระอาทิตย์', css: 'linear-gradient(160deg,#ffe3d3 0%,#ffd9e8 52%,#e7e2ff 100%)', swatch: 'linear-gradient(135deg,#ffe3d3,#e7e2ff)' },
    { id: 'sky',    label: 'ท้องฟ้า',    css: 'linear-gradient(160deg,#dbe9ff 0%,#e8e2ff 50%,#fde9f3 100%)', swatch: 'linear-gradient(135deg,#dbe9ff,#fde9f3)' },
    { id: 'matcha', label: 'ชาเขียว',    css: 'linear-gradient(160deg,#e6f0d4 0%,#f6f2df 55%,#e3f1ec 100%)', swatch: 'linear-gradient(135deg,#e6f0d4,#e3f1ec)' }
  ];
  var bgState = { kind: 'none', image: '', preset: '', dim: 24, blur: 0, cardSolid: 88, cardBlur: 8 };

  function loadBg() {
    var embedded = '';
    try {
      var raw = localStorage.getItem(BG_KEY);
      var fresh = false;
      if (!raw) { raw = localStorage.getItem(BG_KEY_OLD); fresh = !!raw; }   // ย้ายจากรูปแบบเดิม
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          bgState.kind = v.kind === 'image' || v.kind === 'preset' ? v.kind : 'none';
          embedded = typeof v.image === 'string' ? v.image : '';    // รุ่นเก่าฝังรูปไว้ในนี้
          bgState.preset = typeof v.preset === 'string' ? v.preset : '';
          // ของเดิมตั้งค่าจางไว้มากจนแทบไม่เห็นรูป — ย้ายมาใช้ค่าใหม่ที่เห็นรูปชัด
          bgState.dim = fresh ? 24 : clampNum(v.dim, 0, 88, 24);
          bgState.blur = fresh ? 0 : clampNum(v.blur, 0, 16, 0);
          bgState.cardSolid = clampNum(v.cardSolid, 20, 100, 88);
          bgState.cardBlur = clampNum(v.cardBlur, 0, 40, 8);
          if (fresh) { try { localStorage.removeItem(BG_KEY_OLD); } catch (e2) {} }
        }
      }
      if (!embedded) embedded = localStorage.getItem(BG_IMG_KEY) || '';
    } catch (e) { /* อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }

    bgState.image = embedded;
    applyBg();                                   // ชุดสีสำเร็จรูปขึ้นทันที ไม่ต้องรอ

    if (embedded) saveBg();                      // เขียนกลับโดยไม่ฝังรูป คืนพื้นที่ localStorage
    if (bgState.kind !== 'image') return;

    bgImgGet().then(function (url) {
      if (url) { bgState.image = url; applyBg(); return; }
      if (embedded) return bgImgPut(embedded);   // ย้ายรูปเดิมเข้า IndexedDB
      bgState.kind = 'none'; applyBg(); saveBg();   // ไม่มีรูปให้ใช้แล้ว
    }).catch(function () { /* ไม่มี IndexedDB ก็ใช้รูปจากที่เก็บสำรองที่โหลดไว้แล้ว */ });
  }
  function clampNum(v, lo, hi, dflt) {
    var n = Number(v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  /* เก็บเฉพาะค่าตั้งค่า (ไม่กี่ร้อยไบต์) ส่วนรูปอยู่ใน IndexedDB */
  function saveBg() {
    try {
      localStorage.setItem(BG_KEY, JSON.stringify({
        kind: bgState.kind, preset: bgState.preset,
        dim: bgState.dim, blur: bgState.blur,
        cardSolid: bgState.cardSolid, cardBlur: bgState.cardBlur
      }));
      return true;
    } catch (e) { return false; }
  }

  function forgetBgImage() {
    bgImgDel().catch(function () {});
    try { localStorage.removeItem(BG_IMG_KEY); } catch (e) {}
  }

  /* ที่เก็บสำรองเมื่อไม่มี IndexedDB — ย่อลงเรื่อยๆ จนกว่าจะเขียนลง localStorage ได้จริง */
  function saveImageFallback(img) {
    var steps = [[1200, 0.62], [900, 0.55], [700, 0.5], [520, 0.45]];
    for (var i = 0; i < steps.length; i++) {
      var url = resizeToDataURL(img, steps[i][0], steps[i][1]);
      try { localStorage.setItem(BG_IMG_KEY, url); return url; } catch (e) { /* ยังใหญ่ไป ย่ออีก */ }
    }
    return '';
  }
  function presetById(id) {
    for (var i = 0; i < BG_PRESETS.length; i++) if (BG_PRESETS[i].id === id) return BG_PRESETS[i];
    return null;
  }
  function applyBg() {
    var root = document.documentElement;
    var body = document.body;
    var layer = '';
    if (bgState.kind === 'image' && bgState.image) layer = 'url("' + bgState.image + '")';
    else if (bgState.kind === 'preset') {
      var pre = presetById(bgState.preset);
      if (pre && pre.css) layer = pre.css;
    }
    body.classList.toggle('has-bg', !!layer);
    body.classList.toggle('has-bg-image', bgState.kind === 'image' && !!layer);
    if (!layer) { root.style.removeProperty('--bg-layer'); return; }
    root.style.setProperty('--bg-layer', layer);
    root.style.setProperty('--bg-dim', bgState.dim + '%');
    root.style.setProperty('--bg-blur', (bgState.kind === 'image' ? bgState.blur : 0) + 'px');
    root.style.setProperty('--card-solid', bgState.cardSolid + '%');
    root.style.setProperty('--card-blur', bgState.cardBlur + 'px');
    body.classList.toggle('bg-sheer', bgState.cardSolid < 70);
  }

  /* ย่อรูปลงจนพอใส่ localStorage ได้ — ไล่ลดขนาด/คุณภาพทีละขั้น */
  function bgDataURL(img) {
    var sizes = [1400, 1100, 900, 700];
    var quality = [0.68, 0.62, 0.58, 0.52];
    for (var i = 0; i < sizes.length; i++) {
      var url = resizeToDataURL(img, sizes[i], quality[i]);
      if (url.length < 1200000) return url;
    }
    return resizeToDataURL(img, 560, 0.48);
  }

  function bgModalBody() {
    var isImg = bgState.kind === 'image' && bgState.image;
    return '<p class="chart-sub">เลือกรูปจากเครื่อง หรือใช้ชุดสีสำเร็จรูป · รูปพื้นหลังเก็บไว้ในเครื่องนี้เท่านั้น ไม่ถูกอัปโหลดที่ไหน</p>' +
      '<div class="bg-presets">' +
        BG_PRESETS.map(function (pre) {
          var on = pre.id === 'none' ? bgState.kind === 'none' : (bgState.kind === 'preset' && bgState.preset === pre.id);
          return '<button type="button" class="bg-swatch' + (on ? ' is-on' : '') + '" data-bg="preset" data-id="' + pre.id + '">' +
            '<span class="bg-swatch-chip" style="background:' + pre.swatch + '"></span>' +
            '<span class="bg-swatch-label">' + esc(pre.label) + '</span></button>';
        }).join('') +
        '<button type="button" class="bg-swatch' + (isImg ? ' is-on' : '') + '" data-bg="pick">' +
          '<span class="bg-swatch-chip bg-swatch-photo"' + (isImg ? ' style="background-image:url(' + bgState.image + ')"' : '') + '>' +
            (isImg ? '' : '🖼️') + '</span>' +
          '<span class="bg-swatch-label">รูปของฉัน</span></button>' +
      '</div>' +
      (bgState.kind !== 'none'
        ? '<div class="bg-sliders">' +
            '<label class="field"><span class="field-label">' + bgLabel('dim') + '</span>' +
              '<input type="range" min="0" max="88" step="2" data-bg="dim" value="' + bgState.dim + '"></label>' +
            (isImg
              ? '<label class="field"><span class="field-label">' + bgLabel('blur') + '</span>' +
                  '<input type="range" min="0" max="16" step="1" data-bg="blur" value="' + bgState.blur + '"></label>'
              : '') +
            '<label class="field"><span class="field-label">' + bgLabel('cardSolid') + '</span>' +
              '<input type="range" min="20" max="100" step="2" data-bg="cardSolid" value="' + bgState.cardSolid + '"></label>' +
            '<label class="field"><span class="field-label">' + bgLabel('cardBlur') + '</span>' +
              '<input type="range" min="0" max="40" step="1" data-bg="cardBlur" value="' + bgState.cardBlur + '"></label>' +
          '</div>'
        : '') +
      '<div class="row-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary btn-sm" data-bg="pick">🖼️ เลือกรูปจากเครื่อง</button>' +
        (bgState.kind !== 'none' ? '<button class="btn btn-ghost btn-sm" data-bg="clear">ใช้พื้นหลังเดิม</button>' : '') +
      '</div>';
  }
  function bgLabel(which) {
    if (which === 'dim') return 'ความจางของรูป · ' + bgState.dim + '%' + (bgState.dim === 0 ? ' (เห็นรูปเต็มๆ)' : '');
    if (which === 'blur') return 'เบลอรูปพื้นหลัง · ' + bgState.blur + 'px' + (bgState.blur === 0 ? ' (ชัด)' : '');
    if (which === 'cardBlur') return 'ฝ้าหลังการ์ด · ' + bgState.cardBlur + 'px' +
      (bgState.cardBlur === 0 ? ' (เห็นรูปชัดผ่านการ์ด)' : bgState.cardBlur >= 30 ? ' (ฝ้าจัด)' : '');
    return 'ความทึบของการ์ด · ' + bgState.cardSolid + '%' +
      (bgState.cardSolid >= 100 ? ' (ทึบสนิท)' : bgState.cardSolid <= 30 ? ' (โปร่งมาก)' : '');
  }
  function renderBgModal() { $('#bgBody').innerHTML = bgModalBody(); }
  function closeBgModal() { $('#bgModal').hidden = true; }

  $('#bgBtn').addEventListener('click', function () {
    $('#bgModal').hidden = false;
    renderBgModal();
  });
  $('#bgModal').addEventListener('click', function (ev) {
    if (ev.target === this) { closeBgModal(); return; }
    var btn = ev.target.closest('button[data-bg]');
    if (!btn) return;
    var act = btn.dataset.bg;
    if (act === 'close') { closeBgModal(); return; }
    if (act === 'pick') { $('#bgInput').click(); return; }
    if (act === 'clear') {
      bgState.kind = 'none'; bgState.image = '';
      forgetBgImage();
      saveBg(); applyBg(); renderBgModal();
      toast('กลับไปใช้พื้นหลังเดิมแล้ว');
      return;
    }
    if (act === 'preset') {
      var id = btn.dataset.id;
      if (id === 'none') { bgState.kind = 'none'; }
      else { bgState.kind = 'preset'; bgState.preset = id; }
      saveBg(); applyBg(); renderBgModal();
    }
  });
  $('#bgModal').addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.tagName !== 'INPUT' || !el.dataset.bg) return;
    if (el.dataset.bg === 'dim') bgState.dim = clampNum(el.value, 0, 88, 24);
    if (el.dataset.bg === 'blur') bgState.blur = clampNum(el.value, 0, 16, 0);
    if (el.dataset.bg === 'cardSolid') bgState.cardSolid = clampNum(el.value, 20, 100, 88);
    if (el.dataset.bg === 'cardBlur') bgState.cardBlur = clampNum(el.value, 0, 40, 8);
    applyBg();
    var label = el.previousElementSibling;
    if (label) label.textContent = bgLabel(el.dataset.bg);
  });
  $('#bgModal').addEventListener('change', function (ev) {
    if (ev.target.tagName === 'INPUT' && ev.target.dataset.bg) saveBg();
  });
  $('#bgInput').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    toast('กำลังย่อรูป…');
    var prev = { kind: bgState.kind, image: bgState.image, preset: bgState.preset };
    loadImage(file).then(function (img) {
      var url = bgDataURL(img);
      return bgImgPut(url)
        .then(function () { return url; })
        .catch(function () {                      // ไม่มี IndexedDB หรือเขียนไม่ได้ — ถอยไปที่เก็บสำรอง
          var small = saveImageFallback(img);
          if (!small) throw new Error('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม');
          return small;
        });
    }).then(function (url) {
      bgState.kind = 'image';
      bgState.image = url;
      if (bgState.dim > 60) bgState.dim = 24;      // กันกรณีตั้งไว้จางจนดูเหมือนไม่มีอะไรเกิดขึ้น
      saveBg();
      applyBg(); renderBgModal();
      toast('เปลี่ยนพื้นหลังแล้ว 🎨');
    }).catch(function (err) {
      bgState.kind = prev.kind; bgState.image = prev.image; bgState.preset = prev.preset;
      applyBg(); renderBgModal();
      var msg = err && err.message ? err.message : '';
      toast(/พื้นที่/.test(msg)
        ? 'พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — ลองลบรายการเก่าหรือใช้รูปที่เล็กลง'
        : 'ตั้งรูปพื้นหลังไม่สำเร็จ' + (msg ? ': ' + msg : ''));
    });
  });

  loadBg();

  /* ---------------- แท็บ ---------------- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      ['add', 'summary', 'list', 'debt', 'friends'].forEach(function (name) {
        var panel = $('#panel-' + name);
        var on = name === tab.dataset.tab;
        panel.classList.toggle('is-active', on);
        panel.hidden = !on;
      });
      if (tab.dataset.tab === 'summary') renderSummary();
      if (tab.dataset.tab === 'list') renderList();
      if (tab.dataset.tab === 'debt') renderDebts();
      if (tab.dataset.tab === 'friends') renderFriendsTab();
      if (tab.scrollIntoView) tab.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  });

  /* ---------------- รูปภาพ ---------------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  }
  function drawScaled(img, scale) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function resizeToDataURL(img, maxSide, quality) {
    return drawScaled(img, Math.min(1, maxSide / Math.max(img.width, img.height)))
      .toDataURL('image/jpeg', quality);
  }

  /* เตรียมรูปให้ OCR อ่านง่ายขึ้น: ขยายรูปเล็ก, ทำเป็นขาวดำ แล้วดึงคอนทราสต์
     ช่วยมากกับสลิปธนาคารที่พื้นหลังไล่สีและตัวหนังสือบาง */
  function preprocessForOCR(img) {
    var longest = Math.max(img.width, img.height);
    var scale = longest < 1400 ? Math.min(2.5, 1400 / longest) : Math.min(1, 2000 / longest);
    var canvas = drawScaled(img, scale);
    var ctx = canvas.getContext('2d');
    try {
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var px = data.data;
      var hist = new Uint32Array(256);
      var i;
      for (i = 0; i < px.length; i += 4) {
        var g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        px[i] = px[i + 1] = px[i + 2] = g;
        hist[g]++;
      }
      // ตัดหางฮิสโทแกรม 2% บน-ล่าง แล้วยืดช่วงที่เหลือเต็ม 0–255
      var total = canvas.width * canvas.height, cut = total * 0.02, acc = 0, lo = 0, hi = 255;
      for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { lo = i; break; } }
      acc = 0;
      for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { hi = i; break; } }
      if (hi - lo > 20) {
        var span = 255 / (hi - lo);
        for (i = 0; i < px.length; i += 4) {
          var v = Math.max(0, Math.min(255, Math.round((px[i] - lo) * span)));
          px[i] = px[i + 1] = px[i + 2] = v;
        }
      }
      ctx.putImageData(data, 0, 0);
    } catch (e) {
      /* getImageData ถูกบล็อกในบางเบราว์เซอร์ — ใช้รูปที่ย่อ/ขยายแล้วตามเดิม */
    }
    return canvas.toDataURL('image/png');
  }

  /* ---------------- OCR ---------------- */
  var workerPromise = null;
  var activeCard = null;

  function getWorker() {
    if (workerPromise) return workerPromise;
    if (typeof Tesseract === 'undefined') {
      return Promise.reject(new Error('โหลดตัวอ่านข้อความ (Tesseract.js) ไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตครั้งแรกเพื่อดาวน์โหลดชุดภาษา'));
    }
    $('#ocrStatus').textContent = 'กำลังเตรียมตัวอ่านข้อความภาษาไทย–อังกฤษ (ครั้งแรกอาจใช้เวลาสักครู่)…';
    // window.OCR_PATHS ตั้งค่าได้ใน index.html ถ้าต้องการโฮสต์ไฟล์ Tesseract เอง (ใช้งานแบบออฟไลน์)
    var opts = {};
    ['workerPath', 'corePath', 'langPath'].forEach(function (k) {
      if (window.OCR_PATHS && window.OCR_PATHS[k]) opts[k] = window.OCR_PATHS[k];
    });
    opts.logger = function (m) {
      if (!activeCard || typeof m.progress !== 'number') return;
      if (m.status === 'recognizing text') {
        setProgress(activeCard, m.progress, 'กำลังอ่านข้อความ ' + Math.round(m.progress * 100) + '%');
      } else {
        setProgress(activeCard, m.progress * 0.4, 'กำลังเตรียมชุดภาษา…');
      }
    };
    workerPromise = Tesseract.createWorker(['tha', 'eng'], 1, opts).catch(function (err) {
      workerPromise = null;
      throw err;
    });
    return workerPromise;
  }

  /* tesseract.js ใช้ค่าเริ่มต้น PSM 6 (มองทั้งรูปเป็นบล็อกข้อความเดียว) ซึ่งอ่านสลิปแบบ
     สองคอลัมน์ได้ดีที่สุด แต่สลิปที่วางยอดเงินเป็นตัวเลขก้อนใหญ่กลางหน้า (เช่น MyMo/ออมสิน)
     โหมดนี้จะข้ามบรรทัดนั้นไปเลย จึงอ่านซ้ำด้วย PSM 4 (คอลัมน์เดียว ตัวอักษรหลายขนาด)
     เฉพาะตอนที่รอบแรกได้ข้อมูลไม่ครบ แล้วรวมผลจากทั้งสองรอบ */
  function recognizeWith(worker, src, psm) {
    return worker.setParameters({ tessedit_pageseg_mode: psm })
      .then(function () { return worker.recognize(src); })
      .then(function (res) { return (res && res.data && res.data.text) || ''; });
  }

  /* เทียบยอดเงินจากสองรอบ: เชื่อรอบที่คำใบ้แข็งแรงกว่า ถ้าเท่ากันให้เชื่อเลขที่มีทศนิยม
     (ยอดในสลิปแทบทั้งหมดลงท้าย .00 — เลขที่ไม่มีทศนิยมมักเป็น OCR อ่านตกหลัก) */
  function betterAmount(a, b) {
    if (a.amount == null) return b;
    if (b.amount == null) return a;
    if (a.amount === b.amount) return a.amountScore >= b.amountScore ? a : b;
    if ((a.amountScore || 0) !== (b.amountScore || 0)) return (a.amountScore || 0) > (b.amountScore || 0) ? a : b;
    if (a.amountHasDecimals !== b.amountHasDecimals) return a.amountHasDecimals ? a : b;
    return a.amount >= b.amount ? a : b;
  }

  function mergeParsed(first, second) {
    var out = {};
    Object.keys(second).forEach(function (k) { out[k] = second[k]; });
    var pick = betterAmount(first, second);
    out.amount = pick.amount;
    out.amountSource = pick.amountSource;
    out.amountScore = pick.amountScore;
    out.amountHasDecimals = pick.amountHasDecimals;
    // ถ้าสองรอบได้ยอดไม่ตรงกัน ให้เตือนผู้ใช้ตรวจสอบ
    out.confident = pick.confident && (first.amount == null || second.amount == null || first.amount === second.amount);
    ['date', 'merchant', 'note'].forEach(function (k) { if (!out[k] && first[k]) out[k] = first[k]; });
    if (!out.items || !out.items.length) out.items = first.items || [];
    if (!out.text) out.text = first.text;
    return out;
  }

  /* สร้างรูปสำหรับ OCR ใหม่จากไฟล์ต้นฉบับ — ใช้ตอนกด "ลองอ่านใหม่" และตอนถอยไปใช้รูปที่เล็กลง
     (มือถือที่หน่วยความจำจำกัดอาจอ่านรูปใหญ่ไม่ไหว) */
  function ensureOcrSrc(card, small) {
    if (card.ocrSrc && !small) return Promise.resolve(card.ocrSrc);
    if (!card.file) return Promise.resolve(card.ocrSrc);
    return loadImage(card.file).then(function (img) {
      card.ocrSrc = small ? resizeToDataURL(img, 1100, 0.85) : preprocessForOCR(img);
      return card.ocrSrc;
    });
  }

  function readReceipt(worker, card, src) {
    return recognizeWith(worker, src, '6').then(function (text1) {
      var first = ReceiptParser.parse(text1);
      var complete = first.amount != null && first.confident && first.date && first.amountHasDecimals;
      if (complete) return first;
      setProgress(card, 1, 'ตรวจซ้ำอีกรอบเพื่อความแม่นยำ…');
      return recognizeWith(worker, src, '4').then(function (text2) {
        var second = ReceiptParser.parse(text2);
        var merged = mergeParsed(first, second);
        merged.text = text1 + '\n----- อ่านรอบที่สอง -----\n' + text2;
        return merged;
      });
    });
  }

  function setProgress(card, ratio, label) {
    var bar = $('.progress > i', card.el);
    var status = $('.rcard-status span', card.el);
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
    if (status && label) status.textContent = label;
  }

  /* ---------------- กันบันทึกใบเดิมซ้ำ ---------------- */
  var refCache = {};

  function refOfRecord(rec) {
    if (!rec.rawText) return '';
    var key = rec.id + ':' + (rec.updatedAt || 0);
    if (refCache[key] === undefined) refCache[key] = ReceiptParser.refOf(rec.rawText);
    return refCache[key];
  }

  function normName(value) {
    return String(value || '').toLowerCase().replace(/[^ก-๙a-z0-9]/g, '');
  }

  /* ถือว่าซ้ำเมื่อ เลขที่รายการบนสลิปตรงกัน หรือ วันที่+ยอดเงิน+ชื่อร้านตรงกัน */
  function findDuplicate(candidate) {
    var ref = candidate.rawText ? ReceiptParser.refOf(candidate.rawText) : '';
    var name = normName(candidate.merchant);
    var amount = Number(candidate.amount) || 0;
    var list = ExpenseStore.all();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.id === candidate.id) continue;
      if (ref && refOfRecord(e) === ref) return { record: e, reason: 'ref' };
      if (e.date === candidate.date && Math.abs((Number(e.amount) || 0) - amount) < 0.005) {
        var other = normName(e.merchant);
        if (other && name && (other === name || other.indexOf(name) === 0 || name.indexOf(other) === 0)) {
          return { record: e, reason: 'fields' };
        }
      }
    }
    return null;
  }

  function duplicateText(dup) {
    var e = dup.record;
    var when = dateLabel(e.date);
    return dup.reason === 'ref'
      ? 'ใบเสร็จนี้เคยบันทึกไปแล้ว (เลขที่รายการเดียวกัน): ' + e.merchant + ' ' + fmtMoney(e.amount) + ' · ' + when
      : 'มีรายการที่เหมือนกันอยู่แล้ว: ' + e.merchant + ' ' + fmtMoney(e.amount) + ' · ' + when;
  }

  /* ---------------- เดาหมวดจากชื่อร้าน ---------------- */
  /* หมวดที่ผู้ใช้เคยเลือกให้ร้านนี้ มีน้ำหนักกว่าการเดาจากคำ เพราะเป็นความตั้งใจของเจ้าของข้อมูลเอง */
  function categoryFromHistory(merchant) {
    var name = normName(merchant);
    if (name.length < 3) return '';
    var counts = {};
    ExpenseStore.all().forEach(function (e) {
      var other = normName(e.merchant);
      if (!other) return;
      if (other === name || other.indexOf(name) === 0 || name.indexOf(other) === 0) {
        counts[e.category] = (counts[e.category] || 0) + 1;
      }
    });
    var best = '';
    Object.keys(counts).forEach(function (k) {
      if (k !== 'other' && (!best || counts[k] > counts[best])) best = k;
    });
    return best;
  }

  function autoCategory(merchant, note) {
    return categoryFromHistory(merchant) || ReceiptParser.guessCategory(merchant, note);
  }

  /* ---------------- คิวใบเสร็จ ---------------- */
  var queue = [];
  var processing = false;

  function renderQueueHead() {
    var head = $('#queueHead');
    head.hidden = queue.length === 0;
    $('#queueCount').textContent = queue.length + ' ใบ';
  }

  function cardTemplate(card) {
    var p = card.parsed || {};
    return '' +
      '<div class="rcard-thumb">' + (card.thumb
        ? '<img class="zoomable" src="' + card.thumb + '" alt="รูปใบเสร็จ — กดเพื่อขยาย" title="กดเพื่อขยาย" tabindex="0" role="button">'
        : '📄') + '</div>' +
      '<div class="rcard-body">' +
        '<div class="rcard-status' + (card.status === 'error' ? ' is-error' : '') + '">' +
          '<span>' + esc(card.statusText || '') + '</span>' +
        '</div>' +
        (card.status === 'working' ? '<div class="progress"><i style="width:0%"></i></div>' : '') +
        (card.status === 'done' ? (
          '<div class="grid2">' +
            '<label class="field"><span class="field-label">วันที่</span>' +
              '<input type="date" data-f="date" value="' + esc(p.date || todayISO()) + '"></label>' +
            '<label class="field"><span class="field-label">จำนวนเงิน (บาท)</span>' +
              '<input type="number" step="0.01" min="0" data-f="amount" value="' + (p.amount != null ? p.amount : '') + '" placeholder="0.00"></label>' +
            '<label class="field"><span class="field-label">ร้าน / ผู้ขาย</span>' +
              '<input type="text" data-f="merchant" value="' + esc(p.merchant || '') + '" placeholder="ชื่อร้าน"></label>' +
            '<label class="field"><span class="field-label">หมวด</span>' +
              '<select data-f="category">' + catOptions(p.category) + '</select></label>' +
          '</div>' +
          '<label class="field"><span class="field-label">บันทึกช่วยจำ</span>' +
            '<input type="text" data-f="note" value="' + esc(p.note || '') + '" placeholder="เช่น เลี้ยงข้าวทีม"></label>' +
          splitBox(card.draftSplit ? { split: card.draftSplit } : null) +
          (card.dupHint
            ? '<p class="banner is-warn" style="margin:0">⚠️ ' + esc(duplicateText(card.dupHint)) + '</p>'
            : '') +
          (p.amount == null
            ? '<p class="rcard-status is-error"><span>อ่านยอดเงินไม่เจอ กรุณาใส่จำนวนเงินเอง</span></p>'
            : (p.confident ? '' : '<p class="rcard-status"><span>ยอดเงินเป็นการเดาจาก “' + esc((p.amountSource || '').slice(0, 40)) + '” โปรดตรวจสอบ</span></p>')) +
          '<div class="row-actions">' +
            '<button class="btn btn-primary btn-sm" data-act="save">บันทึกรายจ่าย</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="drop">ทิ้งใบนี้</button>' +
          '</div>' +
          '<details class="raw"><summary>ดูข้อความที่อ่านได้จากใบเสร็จ</summary><pre>' +
            esc(p.text || '(ไม่พบข้อความ)') + '</pre></details>'
        ) : '') +
        (card.status === 'error' ? errorHelp(card) + '<div class="row-actions">' +
          '<button class="btn btn-sm" data-act="retry">ลองอ่านใหม่</button>' +
          '<button class="btn btn-sm" data-act="manual">กรอกเอง</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="drop">ทิ้งใบนี้</button>' +
        '</div>' : '') +
      '</div>';
  }

  /* บอกสาเหตุที่อ่านไม่ผ่าน พร้อมทางออก — ผู้ใช้จะได้ไม่ติดอยู่แค่คำว่า "ไม่สำเร็จ" */
  function errorHelp(card) {
    var detail = card.errorDetail || '';
    var hint;
    if (/tesseract|network|fetch|โหลด/i.test(detail)) {
      hint = 'ดูเหมือนโหลดตัวอ่านข้อความไม่สำเร็จ — ครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อดาวน์โหลดชุดภาษาไทย (~5 MB) ' +
             'ลองเช็กสัญญาณแล้วกด “ลองอ่านใหม่” หรือกด “กรอกเอง” เพื่อใส่ยอดเองไปก่อน';
    } else if (/memory|allocation|abort|rangeerror|out of/i.test(detail)) {
      hint = 'รูปอาจใหญ่เกินไปสำหรับเครื่องนี้ ลองปิดแท็บอื่นแล้วกด “ลองอ่านใหม่” หรือถ่าย/ครอปรูปให้เล็กลง';
    } else {
      hint = 'กด “ลองอ่านใหม่” อีกครั้ง ถ้ายังไม่ได้ให้กด “กรอกเอง” เพื่อใส่ข้อมูลด้วยตัวเอง (รูปยังถูกเก็บไว้กับรายการ)';
    }
    return '<p class="rcard-status is-error"><span>' + esc(hint) + '</span></p>' +
      (detail ? '<details class="raw"><summary>รายละเอียดข้อผิดพลาด</summary><pre>' + esc(detail) + '</pre></details>' : '');
  }

  function renderCard(card) {
    card.el.innerHTML = cardTemplate(card);
  }

  function readFields(card) {
    var out = {};
    card.el.querySelectorAll('[data-f]').forEach(function (input) { out[input.dataset.f] = input.value; });
    return out;
  }

  function removeCard(card) {
    queue = queue.filter(function (c) { return c !== card; });
    card.el.remove();
    renderQueueHead();
  }

  function saveCard(card, silent) {
    var f = readFields(card);
    var amount = ReceiptParser.toNumber(f.amount);
    if (!amount || amount <= 0) {
      if (!silent) { toast('กรุณาใส่จำนวนเงินก่อนบันทึก'); $('[data-f="amount"]', card.el).focus(); }
      return false;
    }
    var dup = findDuplicate({
      date: f.date || todayISO(),
      amount: amount,
      merchant: f.merchant,
      rawText: (card.parsed && card.parsed.text) || ''
    });
    if (dup) {
      if (silent) return 'duplicate';                        // โหมดบันทึกทั้งหมด: ข้ามไว้ก่อน แล้วรายงานทีเดียว
      if (!confirm(duplicateText(dup) + '\n\nต้องการบันทึกซ้ำอีกรายการไหม?')) return false;
    }

    var res = ExpenseStore.add({
      date: f.date || todayISO(),
      merchant: f.merchant,
      amount: amount,
      category: f.category,
      note: f.note,
      items: (card.parsed && card.parsed.items) || [],
      rawText: (card.parsed && card.parsed.text) || '',
      image: card.thumb || null,
      split: readSplit(card.el)
    });
    if (!res.result.ok) toast('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — บันทึกข้อมูลแล้วแต่ต้องลบรูปย่อบางส่วนออก');
    removeCard(card);
    renderBudgetAlert();
    autoSendClaims(res.record.id);
    return res.record.date;
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var cardEl = btn.closest('.rcard');
    if (!cardEl) return;
    var card = queue.filter(function (c) { return c.el === cardEl; })[0];
    if (!card) return;
    var act = btn.dataset.act;
    if (act === 'save') {
      var savedDate = saveCard(card);
      if (savedDate) toast(saveToast(savedDate, 'บันทึกรายจ่ายแล้ว'));
    }
    else if (act === 'drop') removeCard(card);
    else if (act === 'retry') {
      card.status = 'queued'; card.statusText = 'รออ่าน…';
      card.errorDetail = ''; card.triedSmall = false;
      renderCard(card); pump();
    }
    else if (act === 'manual') {
      card.status = 'done';
      card.parsed = { date: todayISO(), merchant: '', amount: null, category: 'other', items: [], text: '', confident: false };
      renderCard(card);
    }
  });

  /* พิมพ์ชื่อร้านเสร็จแล้วเติมหมวดให้เอง ถ้าผู้ใช้ยังไม่ได้เลือกหมวดเอง */
  document.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input.dataset || (input.dataset.f !== 'merchant' && input.dataset.f !== 'note')) return;
    var cardEl = input.closest('.rcard');
    if (!cardEl) return;
    var select = $('[data-f="category"]', cardEl);
    if (!select || select.dataset.touched === '1' || select.value !== 'other') return;
    var merchant = ($('[data-f="merchant"]', cardEl) || {}).value || '';
    var note = ($('[data-f="note"]', cardEl) || {}).value || '';
    var guess = autoCategory(merchant, note);
    if (guess && guess !== 'other') {
      select.value = guess;
      toast('เดาหมวดให้เป็น "' + ReceiptParser.categoryLabel(guess) + '" — เปลี่ยนเองได้');
    }
  });

  /* ผู้ใช้เลือกหมวดเองแล้ว อย่าไปเปลี่ยนทับ */
  document.addEventListener('change', function (ev) {
    if (ev.target.dataset && ev.target.dataset.f === 'category') ev.target.dataset.touched = '1';
  });

  function addCard(card) {
    card.el = document.createElement('article');
    card.el.className = 'rcard';
    if (card.fileName) card.el.dataset.file = card.fileName;
    queue.push(card);
    $('#queue').appendChild(card.el);
    renderCard(card);
    renderQueueHead();
  }

  function pump() {
    if (processing) return;
    var next = queue.filter(function (c) { return c.status === 'queued'; })[0];
    if (!next) {
      $('#ocrStatus').textContent = queue.length ? 'อ่านใบเสร็จครบแล้ว ตรวจสอบข้อมูลแล้วกดบันทึกได้เลย' : '';
      return;
    }
    processing = true;
    next.status = 'working';
    next.statusText = 'กำลังเตรียม…';
    renderCard(next);
    activeCard = next;
    $('#ocrStatus').textContent = 'กำลังอ่านใบเสร็จ… (' +
      queue.filter(function (c) { return c.status === 'done'; }).length + '/' + queue.length + ' เสร็จแล้ว)';

    getWorker()
      .then(function (worker) {
        return ensureOcrSrc(next, false)
          .then(function (src) { return readReceipt(worker, next, src); })
          .catch(function (err) {
            if (next.triedSmall || !next.file) throw err;
            next.triedSmall = true;
            setProgress(next, 0.15, 'รูปใหญ่เกินไป — กำลังลองใหม่ด้วยรูปที่เล็กลง…');
            return ensureOcrSrc(next, true).then(function (src) { return readReceipt(worker, next, src); });
          });
      })
      .then(function (parsed) {
        next.dateGuessed = !parsed.date;
        if (!parsed.date) parsed.date = todayISO();
        var learned = categoryFromHistory(parsed.merchant);
        if (learned) parsed.category = learned;
        else if (parsed.category === 'other') parsed.category = ReceiptParser.guessCategory(parsed.merchant, parsed.note);
        next.parsed = parsed;
        next.dupHint = findDuplicate({ date: parsed.date, amount: parsed.amount, merchant: parsed.merchant, rawText: parsed.text });
        next.status = 'done';
        next.statusText = parsed.amount != null
          ? (parsed.isSlip ? 'อ่านสลิปโอนเงินแล้ว — ตรวจสอบข้อมูลก่อนบันทึก'
                           : 'อ่านใบเสร็จแล้ว — ตรวจสอบข้อมูลก่อนบันทึก')
          : 'อ่านข้อความได้ แต่หายอดเงินไม่เจอ';
        if (next.dateGuessed) next.statusText += ' · อ่านวันที่ไม่เจอ ใส่วันนี้ไว้ก่อน';
        renderCard(next);
      })
      .catch(function (err) {
        next.status = 'error';
        next.statusText = 'อ่านไม่สำเร็จ';
        next.errorDetail = (err && err.message) ? String(err.message) : 'ไม่ทราบสาเหตุ';
        renderCard(next);
      })
      .then(function () {
        activeCard = null;
        processing = false;
        next.ocrSrc = null;      // คืนหน่วยความจำ — สร้างใหม่จาก card.file ได้ถ้าต้องอ่านซ้ำ
        pump();
      });
  }

  function intake(files) {
    var images = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|bmp)$/i.test(f.name); });
    if (!images.length) { toast('กรุณาเลือกไฟล์รูปภาพ'); return; }
    // เรียงรูปที่ถ่ายล่าสุดขึ้นก่อน (เว็บสั่งการเรียงในหน้าต่างเลือกรูปของเครื่องไม่ได้ แต่จัดลำดับหลังเลือกได้)
    images.sort(function (a, b) { return (b.lastModified || 0) - (a.lastModified || 0); });
    images.forEach(function (file) {
      var card = { status: 'queued', statusText: 'รออ่าน… (' + file.name + ')', fileName: file.name,
                   file: file, thumb: null, ocrSrc: null, parsed: null, triedSmall: false };
      addCard(card);
      loadImage(file).then(function (img) {
        card.thumb = resizeToDataURL(img, 360, 0.62);   // เก็บคู่กับรายการ
        card.ocrSrc = preprocessForOCR(img);            // ส่งให้ OCR
        renderCard(card);
        pump();
      }).catch(function (err) {
        card.status = 'error';
        card.statusText = err.message;
        renderCard(card);
      });
    });
  }

  $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); $('#fileInput').click(); });
  $('#camBtn').addEventListener('click', function (e) { e.stopPropagation(); $('#camInput').click(); });
  $('#manualBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    addCard({
      status: 'done', statusText: 'กรอกรายจ่ายเอง',
      parsed: { date: todayISO(), merchant: '', amount: null, category: 'other', items: [], text: '', confident: true }
    });
  });
  $('#fileInput').addEventListener('change', function () { intake(this.files); this.value = ''; });
  $('#camInput').addEventListener('change', function () { intake(this.files); this.value = ''; });

  var dz = $('#dropzone');
  dz.addEventListener('click', function () { $('#fileInput').click(); });
  dz.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); }
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) { intake(e.dataTransfer.files); });
  window.addEventListener('paste', function (e) {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) intake(e.clipboardData.files);
  });

  $('#saveAllBtn').addEventListener('click', function () {
    var ready = queue.filter(function (c) { return c.status === 'done'; });
    var saved = 0, skipped = 0, lastDate = '';
    ready.forEach(function (c) {
      var d = saveCard(c, true);
      if (d === 'duplicate') { skipped++; return; }
      if (d) { saved++; lastDate = d; }
    });
    var summary = saved ? 'บันทึกแล้ว ' + saved + ' รายการ' : 'ยังไม่มีรายการที่กรอกยอดเงินครบ';
    if (skipped) summary += ' · ข้าม ' + skipped + ' ใบที่ซ้ำกับรายการเดิม (กดบันทึกทีละใบถ้าต้องการเก็บซ้ำ)';
    toast(saved ? saveToast(lastDate, summary) : summary);
  });
  $('#clearQueueBtn').addEventListener('click', function () {
    queue.slice().forEach(removeCard);
    $('#ocrStatus').textContent = '';
  });

  /* ---------------- งบประมาณรายเดือน ---------------- */
  var budgetEditing = false;

  function budgetStatus(key) {
    var b = ExpenseStore.budget.get();
    var inMonth = ExpenseStore.all().filter(function (e) { return monthKey(e.date) === key; });
    var used = sumOf(inMonth);
    var byCat = {};
    inMonth.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
    var pct = b.total ? (used / b.total) * 100 : 0;
    return {
      limit: b.total, categories: b.categories, usedByCat: byCat,
      used: used, pct: pct, remaining: b.total - used,
      level: !b.total ? 'none' : (pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : 'ok'))
    };
  }

  var LEVEL_CHIP = {
    ok:   { cls: 'is-ok',   text: '✓ อยู่ในงบ' },
    warn: { cls: 'is-warn', text: '! ใกล้เต็มงบ' },
    over: { cls: 'is-over', text: '⚠ ใช้เกินงบ' }
  };

  function daysLeftInMonth(key) {
    if (key !== monthKey(todayISO())) return 0;
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  }

  function budgetForm(st) {
    var cats = CATS.filter(function (c) { return c.key !== 'other'; });
    return '<h2 class="section-title">ตั้งงบประมาณรายเดือน</h2>' +
      '<p class="chart-sub">งบนี้ใช้กับทุกเดือน · เว้นว่างหรือใส่ 0 = ไม่จำกัด</p>' +
      '<label class="field" style="max-width:260px;margin-top:14px">' +
        '<span class="field-label">งบรวมต่อเดือน (บาท)</span>' +
        '<input type="number" min="0" step="100" inputmode="decimal" data-bf="total" value="' + (st.limit || '') + '" placeholder="เช่น 15000">' +
      '</label>' +
      '<details class="raw" style="margin-top:14px"><summary>ตั้งงบรายหมวด (ไม่บังคับ)</summary>' +
        '<div class="grid2" style="margin-top:10px">' +
          cats.map(function (c) {
            return '<label class="field"><span class="field-label">' + c.icon + ' ' + esc(c.label) + '</span>' +
              '<input type="number" min="0" step="100" inputmode="decimal" data-bcat="' + c.key + '" value="' +
              (st.categories[c.key] || '') + '" placeholder="ไม่จำกัด"></label>';
          }).join('') +
        '</div>' +
      '</details>' +
      '<div class="row-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary btn-sm" data-bact="save">บันทึกงบ</button>' +
        '<button class="btn btn-ghost btn-sm" data-bact="cancel">ยกเลิก</button>' +
        (st.limit ? '<button class="btn btn-ghost btn-sm btn-danger" data-bact="clear">ล้างงบทั้งหมด</button>' : '') +
      '</div>';
  }

  function renderBudgetCard(key) {
    var el = $('#budgetCard');
    var st = budgetStatus(key);

    if (budgetEditing) { el.innerHTML = budgetForm(st); return; }

    if (!st.limit) {
      el.innerHTML = '<div class="budget-empty">' +
        '<div><h2 class="section-title">ยังไม่ได้ตั้งงบประมาณ</h2>' +
        '<p class="chart-sub">ตั้งงบไว้ แล้วระบบจะเตือนเมื่อใช้ถึง 80% และเมื่อใช้เกินงบ</p></div>' +
        '<button class="btn btn-primary" data-bact="edit">ตั้งงบประมาณ</button></div>';
      return;
    }

    var chip = LEVEL_CHIP[st.level];
    var days = daysLeftInMonth(key);
    var perDay = days > 0 && st.remaining > 0 ? st.remaining / days : 0;
    var foot;
    if (st.remaining < 0) foot = 'เกินงบไปแล้ว <strong>' + esc(fmtMoney(-st.remaining)) + '</strong>';
    else if (days > 0) foot = 'เหลือ <strong>' + esc(fmtMoney(st.remaining)) + '</strong> · อีก ' + days +
      ' วันจะสิ้นเดือน ใช้ได้เฉลี่ยวันละ ' + esc(fmtMoney(perDay));
    else foot = 'เหลือ <strong>' + esc(fmtMoney(st.remaining)) + '</strong> จากงบทั้งเดือน';

    el.innerHTML =
      '<div class="budget-head">' +
        '<div><h2 class="section-title">งบประมาณ ' + esc(monthLabel(key)) + '</h2>' +
        '<p class="chart-sub">ใช้ไป ' + esc(fmtMoney(st.used)) + ' จากงบ ' + esc(fmtMoney(st.limit)) + '</p></div>' +
        '<span class="chip ' + chip.cls + '">' + chip.text + ' ' + Math.floor(st.pct) + '%</span>' +
        '<button class="btn btn-ghost btn-sm" data-bact="edit">แก้ไขงบ</button>' +
      '</div>' +
      '<div class="meter" role="img" aria-label="ใช้ไป ' + Math.floor(st.pct) + ' เปอร์เซ็นต์ของงบเดือนนี้">' +
        '<span class="meter-fill ' + chip.cls + '" style="width:' + Math.min(100, Math.round(st.pct)) + '%"></span>' +
      '</div>' +
      '<p class="budget-foot">' + foot + '</p>';
  }

  function renderBudgetAlert() {
    var el = $('#budgetAlert');
    var key = monthKey(todayISO());
    var st = budgetStatus(key);
    if (st.level === 'over') {
      el.className = 'banner is-over';
      el.innerHTML = '<strong>⚠️ เดือนนี้ใช้เกินงบแล้ว</strong> ใช้ไป ' + esc(fmtMoney(st.used)) +
        ' จากงบ ' + esc(fmtMoney(st.limit)) + ' — เกินมา ' + esc(fmtMoney(-st.remaining));
      el.hidden = false;
    } else if (st.level === 'warn') {
      el.className = 'banner is-warn';
      el.innerHTML = '<strong>ใกล้เต็มงบแล้ว</strong> ใช้ไป ' + Math.floor(st.pct) + '% ของงบเดือนนี้ · เหลืออีก ' +
        esc(fmtMoney(st.remaining));
      el.hidden = false;
    } else {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  /* ข้อความแจ้งเตือนหลังบันทึกรายจ่าย — ถ้าใกล้เต็มหรือเกินงบให้เตือนแทนข้อความปกติ */
  function saveToast(dateISO, fallback) {
    var key = monthKey(dateISO || todayISO());
    var st = budgetStatus(key);
    if (st.level === 'over') return '⚠️ ' + monthLabel(key) + ' ใช้เกินงบแล้ว ' + fmtMoney(-st.remaining);
    if (st.level === 'warn') return 'ใช้ไปแล้ว ' + Math.floor(st.pct) + '% ของงบเดือนนี้ · เหลือ ' + fmtMoney(st.remaining);
    return fallback;
  }

  $('#budgetCard').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-bact]');
    if (!btn) return;
    var act = btn.dataset.bact;
    var key = $('#sumMonth').value || monthKey(todayISO());
    if (act === 'edit') { budgetEditing = true; renderBudgetCard(key); }
    else if (act === 'cancel') { budgetEditing = false; renderBudgetCard(key); }
    else if (act === 'clear') {
      if (!confirm('ล้างงบประมาณทั้งหมดใช่ไหม?')) return;
      ExpenseStore.budget.set({ total: 0, categories: {} });
      budgetEditing = false;
      renderSummary();
      renderBudgetAlert();
      toast('ล้างงบประมาณแล้ว');
    } else if (act === 'save') {
      var card = $('#budgetCard');
      var cats = {};
      card.querySelectorAll('[data-bcat]').forEach(function (input) {
        var v = ReceiptParser.toNumber(input.value);
        if (v > 0) cats[input.dataset.bcat] = v;
      });
      var total = ReceiptParser.toNumber($('[data-bf="total"]', card).value) || 0;
      if (!ExpenseStore.budget.set({ total: total, categories: cats })) {
        toast('บันทึกงบไม่สำเร็จ — พื้นที่เก็บข้อมูลเต็ม');
        return;
      }
      budgetEditing = false;
      renderSummary();
      renderBudgetAlert();
      toast(total ? 'ตั้งงบเดือนละ ' + fmtMoney(total) + ' แล้ว' : 'ล้างงบรวมแล้ว');
    }
  });

  /* ---------------- สรุปรายจ่าย ---------------- */
  function monthsWithData() {
    var set = {};
    ExpenseStore.all().forEach(function (e) { set[monthKey(e.date)] = true; });
    var cur = monthKey(todayISO());
    set[cur] = true;
    return Object.keys(set).sort().reverse();
  }

  function fillMonthSelect(select, opts) {
    var months = monthsWithData();
    var prev = select.value;
    var html = (opts && opts.allOption) ? '<option value="all">ทุกเดือน</option>' : '';
    html += months.map(function (m) { return '<option value="' + m + '">' + esc(monthLabel(m)) + '</option>'; }).join('');
    select.innerHTML = html;
    if (prev && select.querySelector('option[value="' + prev + '"]')) select.value = prev;
    else select.value = (opts && opts.allOption) ? 'all' : months[0];
  }

  function sumOf(list) {
    return list.reduce(function (t, e) { return t + (Number(e.amount) || 0); }, 0);
  }

  function renderSummary() {
    var select = $('#sumMonth');
    fillMonthSelect(select);
    var key = select.value;
    renderBudgetCard(key);
    var budget = ExpenseStore.budget.get();
    var all = ExpenseStore.all();
    var inMonth = all.filter(function (e) { return monthKey(e.date) === key; });
    var total = sumOf(inMonth);

    $('#sumTotal').textContent = fmtMoney(total);
    $('#sumCount').textContent = inMonth.length;
    $('#sumAvg').textContent = fmtMoney(inMonth.length ? total / inMonth.length : 0);

    var prevKey = shiftMonth(key, -1);
    var prevTotal = sumOf(all.filter(function (e) { return monthKey(e.date) === prevKey; }));
    var cmp = $('#sumCompare');
    if (prevTotal > 0) {
      var diff = total - prevTotal;
      var pct = Math.round(Math.abs(diff) / prevTotal * 100);
      cmp.textContent = diff === 0 ? 'เท่ากับเดือนก่อน'
        : (diff > 0 ? '▲ มากกว่า' : '▼ น้อยกว่า') + 'เดือนก่อน ' + pct + '% (' + fmtMoney(Math.abs(diff)) + ')';
    } else {
      cmp.textContent = 'ยังไม่มีข้อมูลเดือนก่อนไว้เทียบ';
    }

    // ออกให้เพื่อนไปเท่าไหร่ในเดือนนี้ — ยอดรวมยังนับเต็ม แต่บอกไว้ให้เห็นภาพจริง
    var lentMonth = inMonth.reduce(function (a, e) { return a + lentOf(e); }, 0);
    var owedMonth = inMonth.reduce(function (a, e) { return a + owedOf(e); }, 0);
    var note = $('#debtNote');
    note.hidden = lentMonth <= 0.005;
    if (!note.hidden) {
      note.innerHTML = '🧑‍🤝‍🧑 เดือนนี้ออกให้เพื่อนไปก่อน <strong>' + esc(fmtMoney(lentMonth)) + '</strong> · ' +
        (owedMonth > 0.005
          ? 'ยังค้างอยู่ <strong>' + esc(fmtMoney(owedMonth)) + '</strong> · หักแล้วเป็นของคุณจริง ' +
            esc(fmtMoney(Math.max(0, total - lentMonth)))
          : 'ได้คืนครบแล้ว 🎉');
    }

    // แยกตามหมวด
    var byCat = {};
    inMonth.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
    var rows = Object.keys(byCat).map(function (k) { return { key: k, label: ReceiptParser.categoryLabel(k), value: byCat[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var max = rows.length ? rows[0].value : 0;
    $('#catSub').textContent = rows.length ? 'ทั้งหมด ' + rows.length + ' หมวด · หน่วย: บาท' : '';
    $('#catChart').innerHTML = rows.length ? rows.map(function (r) {
      var pct = total ? Math.round(r.value / total * 100) : 0;
      var cap = budget.categories[r.key];
      var over = cap && r.value > cap;
      var sub = '';
      if (cap) {
        sub = over
          ? '<span class="bar-sub is-over">เกินงบ ' + esc(moneyShort.format(r.value - cap)) + ' (งบ ' + esc(moneyShort.format(cap)) + ')</span>'
          : '<span class="bar-sub">งบ ' + esc(moneyShort.format(cap)) + ' · ใช้ไป ' + Math.round(r.value / cap * 100) + '%</span>';
      }
      return '<div class="bar-row">' +
        '<span class="bar-name"><span class="bar-label" title="' + esc(r.label) + '">' +
          '<span class="bar-icon" aria-hidden="true">' + ReceiptParser.categoryIcon(r.key) + '</span>' + esc(r.label) + '</span>' + sub + '</span>' +
        '<span class="bar-track"><span class="bar-fill' + (over ? ' is-over' : '') + '" style="width:' + (max ? Math.max(2, r.value / max * 100) : 0) + '%"></span></span>' +
        '<span class="bar-value">' + moneyShort.format(r.value) + '<span class="bar-pct">' + pct + '%</span></span>' +
      '</div>';
    }).join('') : '<p class="empty"><span class="empty-icon" aria-hidden="true">🌱</span>เดือนนี้ยังไม่มีรายจ่ายเลย</p>';

    $('#sumTop').textContent = rows.length ? 'จ่ายมากสุด: ' + ReceiptParser.categoryIcon(rows[0].key) + ' ' + rows[0].label : '';

    // รายจ่ายรายวันของเดือนที่เลือก
    dailyView = { key: key, rows: inMonth };
    renderDaily(key, inMonth);

    // แนวโน้ม 6 เดือน
    var keys = [];
    for (var i = 5; i >= 0; i--) keys.push(shiftMonth(key, -i));
    var totals = keys.map(function (k) { return sumOf(all.filter(function (e) { return monthKey(e.date) === k; })); });
    var maxT = Math.max.apply(null, totals.concat([1]));
    $('#trendChart').innerHTML = keys.map(function (k, idx) {
      var h = Math.max(2, totals[idx] / maxT * 130);
      return '<div class="trend-col">' +
        '<span class="trend-val">' + (totals[idx] ? moneyShort.format(totals[idx]) : '–') + '</span>' +
        '<span class="trend-bar' + (k === key ? ' is-current' : '') + '" style="height:' + h + 'px" title="' +
          esc(monthLabel(k)) + ': ' + fmtMoney(totals[idx]) + '"></span>' +
      '</div>';
    }).join('');
    var labels = $('#trendChart').nextElementSibling;
    if (!labels || !labels.classList.contains('trend-labels')) {
      labels = document.createElement('div');
      labels.className = 'trend-labels';
      $('#trendChart').after(labels);
    }
    labels.innerHTML = keys.map(function (k) { return '<span class="trend-label">' + esc(monthLabelShort(k)) + '</span>'; }).join('');

    // ร้านที่จ่ายบ่อย
    var byMerchant = {};
    inMonth.forEach(function (e) {
      var name = e.merchant || 'ไม่ระบุร้าน';
      if (!byMerchant[name]) byMerchant[name] = { count: 0, total: 0 };
      byMerchant[name].count++;
      byMerchant[name].total += Number(e.amount) || 0;
    });
    var merchants = Object.keys(byMerchant).map(function (n) {
      return { name: n, count: byMerchant[n].count, total: byMerchant[n].total };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
    $('#topMerchants').innerHTML = merchants.length ? merchants.map(function (m) {
      return '<li><span class="r-name">' + esc(m.name) +
        ' <span class="muted">· ' + m.count + ' ครั้ง</span></span>' +
        '<span class="r-amount">' + fmtMoney(m.total) + '</span></li>';
    }).join('') : '<li class="muted">ยังไม่มีข้อมูล</li>';
  }

  /* ---------------- สรุปรายจ่ายรายวัน ---------------- */
  function daysInMonth(key) {
    var parts = key.split('-');
    return new Date(+parts[0], +parts[1], 0).getDate();
  }
  function dayLabelShort(key, day) {
    var parts = key.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, day);
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }
  var WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  var dayCatFilter = 'all';
  var dailyView = null;

  function renderDaily(key, monthRows) {
    var sel = $('#dayCat');
    if (sel && !sel.options.length) {
      sel.innerHTML = '<option value="all">ทุกหมวด</option>' +
        CATS.map(function (c) { return '<option value="' + c.key + '">' + c.icon + '  ' + esc(c.label) + '</option>'; }).join('');
    }
    if (sel) {
      if (!sel.querySelector('option[value="' + dayCatFilter + '"]')) dayCatFilter = 'all';
      sel.value = dayCatFilter;
    }
    var inMonth = dayCatFilter === 'all'
      ? monthRows
      : monthRows.filter(function (e) { return e.category === dayCatFilter; });

    var n = daysInMonth(key);
    var parts = key.split('-');
    var totals = new Array(n + 1).join('0').split('').map(Number);   // index 0 = วันที่ 1
    var counts = totals.slice();
    inMonth.forEach(function (e) {
      var d = parseInt((e.date || '').slice(8, 10), 10);
      if (d >= 1 && d <= n) { totals[d - 1] += Number(e.amount) || 0; counts[d - 1]++; }
    });

    var todayKey = monthKey(todayISO());
    var todayDay = todayKey === key ? new Date().getDate() : 0;
    var max = Math.max.apply(null, totals.concat([1]));
    var spentDays = totals.filter(function (v) { return v > 0; }).length;
    var sum = totals.reduce(function (a, v) { return a + v; }, 0);
    // วันที่ผ่านมาแล้วในเดือนนี้ ใช้หารหาค่าเฉลี่ยที่มีความหมายจริง
    var elapsed = todayDay ? todayDay : n;

    var scope = dayCatFilter === 'all' ? '' : 'เฉพาะ' + ReceiptParser.categoryLabel(dayCatFilter) + ' · ';
    var sub = [];
    if (sum > 0) {
      sub.push('รวม ' + fmtMoney(sum));
      sub.push('เฉลี่ยวันละ ' + fmtMoney(sum / elapsed));
      sub.push('มีรายจ่าย ' + spentDays + ' จาก ' + elapsed + ' วัน');
      if (todayDay) sub.push('วันนี้ ' + fmtMoney(totals[todayDay - 1]));
    } else {
      sub.push(dayCatFilter === 'all'
        ? 'ยังไม่มีรายจ่ายในเดือนนี้'
        : 'เดือนนี้ยังไม่มีรายจ่ายในหมวดนี้');
    }
    $('#daySub').textContent = scope + sub.join(' · ');

    $('#dayChart').innerHTML = totals.map(function (v, i) {
      var day = i + 1;
      var future = todayDay && day > todayDay;
      var wd = WEEKDAYS_TH[new Date(+parts[0], +parts[1] - 1, day).getDay()];
      var h = v > 0 ? Math.max(3, Math.round(v / max * 92)) : 0;
      return '<div class="day-col' + (day === todayDay ? ' is-today' : '') + (future ? ' is-future' : '') + '"' +
          ' title="' + esc(dayLabelShort(key, day) + ' (' + wd + ') · ' + (v ? fmtMoney(v) : 'ไม่มีรายจ่าย')) + '">' +
        '<span class="day-bar" style="height:' + h + 'px"></span>' +
        '<span class="day-num">' + day + '</span>' +
      '</div>';
    }).join('');

    var top = totals.map(function (v, i) { return { day: i + 1, value: v, count: counts[i] }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 3);
    $('#dayTop').innerHTML = top.length
      ? top.map(function (d, i) {
          return '<li><span class="r-name">' + (i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 ') +
            esc(dayLabelShort(key, d.day)) + ' <span class="muted">· ' + d.count + ' รายการ</span></span>' +
            '<span class="r-amount">' + fmtMoney(d.value) + '</span></li>';
        }).join('')
      : '';
  }

  $('#dayCat').addEventListener('change', function () {
    dayCatFilter = this.value || 'all';
    if (dailyView) renderDaily(dailyView.key, dailyView.rows);
  });

  $('#sumMonth').addEventListener('change', renderSummary);

  /* ---------------- รายการทั้งหมด ---------------- */
  function currentFilters() {
    return {
      q: $('#q').value.trim().toLowerCase(),
      cat: $('#fCat').value,
      month: $('#fMonth').value
    };
  }

  function filtered() {
    var f = currentFilters();
    return ExpenseStore.all().filter(function (e) {
      if (f.month && f.month !== 'all' && monthKey(e.date) !== f.month) return false;
      if (f.cat && f.cat !== 'all' && e.category !== f.cat) return false;
      if (f.q) {
        var hay = (e.merchant + ' ' + e.note + ' ' + ReceiptParser.categoryLabel(e.category) + ' ' + e.rawText).toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });
  }

  function expenseCard(e) {
    return '<article class="ecard" data-id="' + e.id + '">' +
      (e.image ? '<img class="ecard-thumb zoomable" src="' + e.image + '" alt="ใบเสร็จ ' + esc(e.merchant) + ' — กดเพื่อขยาย" title="กดเพื่อขยาย" tabindex="0" role="button">'
               : '<span class="ecard-thumb is-cat" aria-hidden="true">' + ReceiptParser.categoryIcon(e.category) + '</span>') +
      '<div class="ecard-main">' +
        '<div class="ecard-title">' + esc(e.merchant) + '</div>' +
        '<div class="ecard-meta">' +
          '<span>' + esc(dateLabel(e.date)) + '</span>' +
          '<span class="tag"><span aria-hidden="true">' + ReceiptParser.categoryIcon(e.category) + '</span> ' +
            esc(ReceiptParser.categoryLabel(e.category)) + '</span>' +
          (owedOf(e) > 0
            ? '<span class="tag is-debt">🧑‍🤝‍🧑 เพื่อนค้าง ' + esc(moneyShort.format(owedOf(e))) + '</span>'
            : (lentOf(e) > 0 ? '<span class="tag is-settled">✓ ได้คืนครบแล้ว</span>' : '')) +
          (e.note ? '<span>' + esc(e.note) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="ecard-right">' +
        '<span class="ecard-amount">' + fmtMoney(e.amount) + '</span>' +
        '<span class="row-actions">' +
          '<button class="btn btn-ghost btn-sm" data-eact="edit">แก้ไข</button>' +
          '<button class="btn btn-ghost btn-sm btn-danger" data-eact="del">ลบ</button>' +
        '</span>' +
      '</div>' +
    '</article>';
  }

  function editForm(e) {
    return '<div class="ecard-edit">' +
      '<div class="grid2">' +
        '<label class="field"><span class="field-label">วันที่</span><input type="date" data-ef="date" value="' + esc(e.date) + '"></label>' +
        '<label class="field"><span class="field-label">จำนวนเงิน (บาท)</span><input type="number" step="0.01" min="0" data-ef="amount" value="' + e.amount + '"></label>' +
        '<label class="field"><span class="field-label">ร้าน / ผู้ขาย</span><input type="text" data-ef="merchant" value="' + esc(e.merchant) + '"></label>' +
        '<label class="field"><span class="field-label">หมวด</span><select data-ef="category">' + catOptions(e.category) + '</select></label>' +
      '</div>' +
      '<label class="field"><span class="field-label">บันทึกช่วยจำ</span><input type="text" data-ef="note" value="' + esc(e.note) + '"></label>' +
      splitBox(e) +
      (e.rawText ? '<details class="raw"><summary>ข้อความจากใบเสร็จ</summary><pre>' + esc(e.rawText) + '</pre></details>' : '') +
      '<div class="row-actions">' +
        '<button class="btn btn-primary btn-sm" data-eact="save">บันทึกการแก้ไข</button>' +
        '<button class="btn btn-ghost btn-sm" data-eact="cancel">ยกเลิก</button>' +
      '</div>' +
    '</div>';
  }

  function renderList() {
    var catSel = $('#fCat');
    if (!catSel.options.length) {
      catSel.innerHTML = '<option value="all">ทุกหมวด</option>' +
        CATS.map(function (c) { return '<option value="' + c.key + '">' + c.icon + '  ' + esc(c.label) + '</option>'; }).join('');
    }
    fillMonthSelect($('#fMonth'), { allOption: true });

    var list = filtered();
    $('#listSummary').textContent = list.length
      ? list.length + ' รายการ · รวม ' + fmtMoney(sumOf(list))
      : 'ไม่พบรายการ';
    $('#expenseList').innerHTML = list.length
      ? list.map(expenseCard).join('')
      : '<p class="empty"><span class="empty-icon" aria-hidden="true">🔍</span>ไม่เจอรายการที่ตรงกับเงื่อนไข<br><span class="muted">ลองเปลี่ยนตัวกรอง หรือเพิ่มใบเสร็จในแท็บ “เพิ่มรายจ่าย”</span></p>';
  }

  ['input', 'change'].forEach(function (evt) {
    $('#q').addEventListener(evt, renderList);
  });
  $('#fCat').addEventListener('change', renderList);
  $('#fMonth').addEventListener('change', renderList);

  $('#expenseList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-eact]');
    if (!btn) return;
    var card = btn.closest('.ecard');
    var id = card.dataset.id;
    var act = btn.dataset.eact;
    var exp = ExpenseStore.get(id);
    if (!exp) return;

    if (act === 'del') {
      if (!confirm('ลบรายจ่าย "' + exp.merchant + '" ' + fmtMoney(exp.amount) + ' ใช่ไหม?')) return;
      ExpenseStore.remove(id);
      renderList();
      renderBudgetAlert();
      toast('ลบรายการแล้ว');
    } else if (act === 'edit') {
      if ($('.ecard-edit', card)) return;
      card.insertAdjacentHTML('beforeend', editForm(exp));
    } else if (act === 'cancel') {
      var box = $('.ecard-edit', card);
      if (box) box.remove();
    } else if (act === 'save') {
      var patch = {};
      card.querySelectorAll('[data-ef]').forEach(function (input) { patch[input.dataset.ef] = input.value; });
      var amount = ReceiptParser.toNumber(patch.amount);
      if (!amount || amount <= 0) { toast('จำนวนเงินต้องมากกว่า 0'); return; }
      patch.amount = amount;
      patch.split = readSplit(card);
      ExpenseStore.update(id, patch);
      renderList();
      renderBudgetAlert();
      renderDebtBadge();
      autoSendClaims(id);
      toast(saveToast(patch.date, 'แก้ไขเรียบร้อย'));
    }
  });

  /* ---------------- ส่งออก / สำรองข้อมูล ---------------- */
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้ — ถามซ้ำและเตือนเรื่องเซิร์ฟเวอร์ให้ครบก่อน */
  $('#wipeLocalBtn').addEventListener('click', function () {
    var loggedIn = syncReady();
    var warn = 'ล้างข้อมูลในเบราว์เซอร์นี้ทั้งหมดใช่ไหม?\n\n' +
      '· รายจ่าย ' + ExpenseStore.allWithDeleted().length + ' รายการ · สมุดทั้งหมด · งบประมาณ · เพื่อน · ใบแจ้งหนี้\n' +
      '· รูปใบเสร็จที่เก็บไว้จะหายไปด้วย และกู้คืนไม่ได้\n\n' +
      'แนะนำให้กด "💾 สำรองข้อมูล" เก็บไฟล์ไว้ก่อน';
    if (loggedIn) {
      warn += '\n\n⚠️ ตอนนี้ล็อกอินอยู่ (' + CloudSync.email() + ') ถ้ายังไม่ได้ล้างข้อมูลบนเซิร์ฟเวอร์ ' +
        'ข้อมูลจะถูกดึงกลับมาตอนซิงก์ครั้งถัดไป';
    }
    if (!confirm(warn)) return;
    if (!confirm('ยืนยันอีกครั้ง — ลบแล้วกู้คืนไม่ได้')) return;

    ExpenseStore.wipeLocal();
    ExpenseStore.owner.clear();

    if (confirm('ล้างการตั้งค่าหน้าตาด้วยไหม? (ธีมสว่าง/มืด และรูปพื้นหลัง)')) {
      try { localStorage.removeItem('expense-book:theme'); } catch (e) {}
      try { localStorage.removeItem('expense-book:bg:v2'); localStorage.removeItem('expense-book:bg:v1'); } catch (e) {}
      try { localStorage.removeItem('expense-book:bg-img:v1'); } catch (e) {}
      try { if (window.indexedDB) indexedDB.deleteDatabase('expense-book-bg'); } catch (e) {}
    }

    var after = function () {
      renderList(); renderBudgetAlert(); renderBookBar(); renderDebtBadge();
      if ($('#panel-summary').classList.contains('is-active')) renderSummary();
      toast('ล้างข้อมูลในเครื่องนี้แล้ว');
      setTimeout(function () { location.reload(); }, 900);
    };
    if (loggedIn && confirm('ออกจากระบบด้วยไหม? (กันข้อมูลถูกดึงกลับมาจากเซิร์ฟเวอร์)')) {
      CloudSync.signOut().then(after, after);
    } else {
      after();
    }
  });

  $('#csvBtn').addEventListener('click', function () {
    var list = filtered();
    if (!list.length) { toast('ไม่มีรายการให้ส่งออก'); return; }
    var head = ['วันที่', 'ร้าน/ผู้ขาย', 'หมวด', 'จำนวนเงิน', 'ส่วนของฉัน', 'ออกให้เพื่อน', 'เพื่อนยังค้าง', 'ลูกหนี้', 'บันทึกช่วยจำ'];
    var rows = list.map(function (e) {
      var names = splitOf(e).map(function (p) {
        return p.name + ' ' + p.amount.toFixed(2) + (p.paid ? ' (คืนแล้ว)' : ' (ค้าง)');
      }).join(' · ');
      return [e.date, e.merchant, ReceiptParser.categoryLabel(e.category), (Number(e.amount) || 0).toFixed(2),
              myShare(e).toFixed(2), lentOf(e).toFixed(2), owedOf(e).toFixed(2), names, e.note];
    });
    var csv = [head].concat(rows).map(function (r) {
      return r.map(function (cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    download('expenses-' + todayISO() + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
    toast('ดาวน์โหลด CSV แล้ว (' + list.length + ' รายการ)');
  });

  $('#backupBtn').addEventListener('click', function () {
    var data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      budget: ExpenseStore.budget.get(),
      expenses: ExpenseStore.all()
    };
    download('expense-book-backup-' + todayISO() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('สำรองข้อมูลแล้ว');
  });

  $('#restoreBtn').addEventListener('click', function () { $('#restoreInput').click(); });
  $('#restoreInput').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var list = Array.isArray(data) ? data : data.expenses;
        if (!Array.isArray(list)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
        if (!confirm('กู้คืน ' + list.length + ' รายการ และแทนที่ข้อมูลเดิมทั้งหมดใช่ไหม?')) return;
        ExpenseStore.replaceAll(list);
        if (data && data.budget) ExpenseStore.budget.set(data.budget);
        renderList();
        renderBudgetAlert();
        toast('กู้คืนข้อมูลแล้ว');
      } catch (err) {
        toast('อ่านไฟล์สำรองไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  /* ---------------- สมุดหลายเล่ม ---------------- */
  function renderBookBar() {
    var select = $('#bookSelect');
    var books = ExpenseStore.books();
    var current = ExpenseStore.currentBook();
    select.innerHTML = books.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === current ? ' selected' : '') + '>' +
        esc(b.name) + ' (' + ExpenseStore.countInBook(b.id) + ')</option>';
    }).join('');
  }

  function switchBook(id) {
    ExpenseStore.setCurrentBook(id);
    queue.slice().forEach(removeCard);         // ใบเสร็จที่ค้างในคิวเป็นของสมุดเดิม
    $('#ocrStatus').textContent = '';
    renderBookBar();
    renderDebtBadge();
    renderList();
    renderBudgetAlert();
    if ($('#panel-summary').classList.contains('is-active')) renderSummary();
    toast('เปลี่ยนไปสมุด "' + ExpenseStore.currentBookName() + '"');
  }

  function renderBookModal() {
    var books = ExpenseStore.books();
    var current = ExpenseStore.currentBook();
    $('#bookBody').innerHTML =
      '<p class="chart-sub">แยกรายจ่ายเป็นหลายเล่มได้ เช่น ส่วนตัว · ร้านค้า · บ้าน — แต่ละเล่มมีงบประมาณและสรุปของตัวเอง</p>' +
      '<div class="book-list">' +
        books.map(function (b) {
          return '<div class="book-row' + (b.id === current ? ' is-current' : '') + '" data-id="' + esc(b.id) + '">' +
            '<div class="book-info">' +
              '<span class="book-name">' + esc(b.name) + (b.id === current ? ' <span class="chip is-ok">กำลังใช้</span>' : '') + '</span>' +
              '<span class="book-count">' + ExpenseStore.countInBook(b.id) + ' รายการ</span>' +
            '</div>' +
            '<div class="row-actions">' +
              (b.id === current ? '' : '<button class="btn btn-sm" data-book="use">เปิดสมุดนี้</button>') +
              '<button class="btn btn-ghost btn-sm" data-book="rename">เปลี่ยนชื่อ</button>' +
              (books.length > 1 ? '<button class="btn btn-ghost btn-sm btn-danger" data-book="delete">ลบ</button>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="row-actions" style="margin-top:14px">' +
        '<input type="text" id="newBookName" placeholder="ชื่อสมุดใหม่ เช่น ร้านกาแฟ" style="flex:1;min-width:150px">' +
        '<button class="btn btn-primary btn-sm" data-book="add">สร้างสมุด</button>' +
      '</div>';
  }

  $('#bookSelect').addEventListener('change', function () { switchBook(this.value); });
  $('#bookManageBtn').addEventListener('click', function () {
    $('#bookModal').hidden = false;
    renderBookModal();
  });

  $('#bookModal').addEventListener('click', function (ev) {
    if (ev.target === this) { closeBookModal(); return; }
    var btn = ev.target.closest('[data-book]');
    if (!btn) return;
    var act = btn.dataset.book;
    var row = btn.closest('.book-row');
    var id = row ? row.dataset.id : '';

    if (act === 'close') { closeBookModal(); return; }
    if (act === 'add') {
      var input = $('#newBookName');
      var book = ExpenseStore.addBook(input.value);
      input.value = '';
      switchBook(book.id);
      renderBookModal();
      toast('สร้างสมุด "' + book.name + '" แล้ว');
      return;
    }
    if (act === 'use') { switchBook(id); renderBookModal(); return; }
    if (act === 'rename') {
      var books = ExpenseStore.books();
      var found = books.filter(function (b) { return b.id === id; })[0];
      var name = prompt('ชื่อสมุดใหม่', found ? found.name : '');
      if (name === null) return;
      ExpenseStore.renameBook(id, name);
      renderBookBar();
      renderBookModal();
      return;
    }
    if (act === 'delete') {
      var count = ExpenseStore.countInBook(id);
      if (!confirm('ลบสมุดนี้ใช่ไหม? รายการในสมุด ' + count + ' รายการจะถูกลบไปด้วย')) return;
      var res = ExpenseStore.removeBook(id);
      if (!res.ok) { toast('ต้องเหลือสมุดอย่างน้อยหนึ่งเล่ม'); return; }
      renderBookBar();
      renderBookModal();
      renderList();
      renderBudgetAlert();
      if ($('#panel-summary').classList.contains('is-active')) renderSummary();
      toast('ลบสมุดแล้ว');
    }
  });

  function closeBookModal() { $('#bookModal').hidden = true; }

  /* ---------------- ซิงก์ข้อมูลกับ Supabase ---------------- */
  var syncUI = { step: 'password', email: '', busy: false, message: '', error: '' };
  var autoSyncTimer = null;
  var lastSyncFinished = 0;

  function syncTimeLabel() {
    var ts = ExpenseStore.lastSync.get();
    if (!ts) return 'ยังไม่เคยซิงก์';
    var d = new Date(ts + 5000);
    return 'ซิงก์ล่าสุด ' + d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function renderSyncBadge() {
    var btn = $('#syncBtn');
    var on = CloudSync.isConfigured() && !!CloudSync.user();
    btn.classList.toggle('is-on', on);
    btn.title = on ? 'ซิงก์ข้อมูล (' + CloudSync.email() + ')' : 'ซิงก์ข้อมูลข้ามเครื่อง';
  }

  function renderSyncModal() {
    var body = $('#syncBody');
    var note = '<p class="chart-sub" style="margin-top:10px">รูปใบเสร็จไม่ถูกอัปโหลด เก็บไว้ในเครื่องนี้เท่านั้น · ซิงก์เฉพาะวันที่ ยอดเงิน ชื่อร้าน หมวด บันทึกช่วยจำ และงบประมาณ</p>';
    var msg = syncUI.error
      ? '<p class="banner is-over" style="margin-top:12px">' + esc(syncUI.error) + '</p>'
      : (syncUI.message ? '<p class="banner is-ok" style="margin-top:12px">' + esc(syncUI.message) + '</p>' : '');

    if (!CloudSync.isConfigured()) {
      body.innerHTML = '<p class="chart-sub">ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์สำหรับซิงก์</p>' +
        '<p class="budget-foot">ใส่ Project URL และ anon key ของ Supabase ในไฟล์ <code>assets/config.js</code> ' +
        'แล้วรัน <code>supabase/schema.sql</code> ใน SQL Editor หนึ่งครั้ง (ดูขั้นตอนใน README)</p>' + note;
      return;
    }

    var conflict = CloudSync.user() ? ownerConflict() : null;
    if (conflict) {
      body.innerHTML = '<p class="banner is-warn" style="margin:0 0 12px">⚠️ เครื่องนี้มีข้อมูลของบัญชี <strong>' +
          esc(conflict.email || conflict.userId) + '</strong> ค้างอยู่ แต่ตอนนี้ล็อกอินเป็น <strong>' +
          esc(CloudSync.email()) + '</strong></p>' +
        '<p class="chart-sub">เลือกก่อนว่าจะเอาข้อมูลในเครื่องยังไง — ระบบจะยังไม่ซิงก์จนกว่าจะเลือก ' +
          'เพื่อไม่ให้ข้อมูลสองบัญชีปนกัน</p>' +
        '<div class="row-actions" style="margin-top:14px;flex-direction:column;align-items:stretch">' +
          '<button class="btn btn-primary btn-sm" data-sync="wipe">ล้างข้อมูลในเครื่อง แล้วดึงของบัญชีนี้มาแทน</button>' +
          '<button class="btn btn-sm" data-sync="adopt">ย้ายข้อมูลในเครื่องเข้าบัญชี ' + esc(CloudSync.email()) + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="backup">ดาวน์โหลดสำรองข้อมูลก่อน</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="signout">ออกจากระบบ (ยังไม่ตัดสินใจ)</button>' +
        '</div>' +
        '<p class="budget-foot">“ล้างข้อมูลในเครื่อง” ลบเฉพาะสำเนาในเบราว์เซอร์นี้ ' +
          'ข้อมูลของบัญชีเดิมที่เคยซิงก์ขึ้นไปแล้วยังอยู่ครบบนเซิร์ฟเวอร์</p>' + note;
      return;
    }

    if (CloudSync.user()) {
      body.innerHTML = '<p class="chart-sub">ล็อกอินเป็น <strong>' + esc(CloudSync.email()) + '</strong></p>' +
        '<p class="budget-foot">' + esc(syncTimeLabel()) + '</p>' + msg +
        '<div class="row-actions" style="margin-top:14px">' +
          '<button class="btn btn-primary btn-sm" data-sync="now"' + (syncUI.busy ? ' disabled' : '') + '>' +
            (syncUI.busy ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="signout">ออกจากระบบ</button>' +
        '</div>' + note;
      return;
    }

    if (syncUI.step === 'code') {
      body.innerHTML = '<p class="chart-sub">ส่งอีเมลไปที่ <strong>' + esc(syncUI.email) + '</strong> แล้ว — ' +
          'ใส่รหัส 6 หลักจากอีเมลด้านล่าง หรือกดลิงก์ในอีเมลก็ได้</p>' + msg +
        '<p class="budget-foot">ถ้ากดลิงก์แล้วไปที่ <code>localhost:3000</code> แปลว่ายังไม่ได้ตั้ง Site URL ใน Supabase ' +
          'เป็น <code>' + esc(location.origin) + '</code> — ระหว่างนี้ใช้รหัส 6 หลักแทนได้เลย</p>' +
        '<label class="field" style="margin-top:12px;max-width:220px"><span class="field-label">รหัสจากอีเมล</span>' +
          '<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" data-sf="code" placeholder="123456"></label>' +
        '<div class="row-actions" style="margin-top:14px">' +
          '<button class="btn btn-primary btn-sm" data-sync="verify"' + (syncUI.busy ? ' disabled' : '') + '>' +
            (syncUI.busy ? 'กำลังตรวจสอบ…' : 'ยืนยันรหัส') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="resend">ส่งรหัสใหม่</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="back">เปลี่ยนอีเมล</button>' +
        '</div>' + note;
      var input = $('[data-sf="code"]', body);
      if (input) input.focus();
      return;
    }

    if (syncUI.step === 'maillink') {
      body.innerHTML = '<p class="chart-sub">ส่งลิงก์เข้าใช้งานไปที่อีเมล (ต้องเปิดอีเมลแล้วกดลิงก์)</p>' + msg +
        '<label class="field" style="margin-top:12px;max-width:320px"><span class="field-label">อีเมล</span>' +
          '<input type="email" inputmode="email" autocomplete="email" data-sf="email" value="' + esc(syncUI.email) + '" placeholder="you@example.com"></label>' +
        '<div class="row-actions" style="margin-top:14px">' +
          '<button class="btn btn-primary btn-sm" data-sync="send"' + (syncUI.busy ? ' disabled' : '') + '>' +
            (syncUI.busy ? 'กำลังส่ง…' : 'ส่งลิงก์ไปที่อีเมล') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-sync="usepassword">ใช้รหัสผ่านแทน</button>' +
        '</div>' + note;
      return;
    }

    body.innerHTML = '<p class="chart-sub">ล็อกอินครั้งเดียวด้วยอีเมลกับรหัสผ่าน แล้วรายจ่ายจะซิงก์ข้ามมือถือกับคอมให้อัตโนมัติ</p>' + msg +
      '<div class="grid2" style="margin-top:12px;max-width:420px">' +
        '<label class="field"><span class="field-label">อีเมล</span>' +
          '<input type="email" inputmode="email" autocomplete="email" data-sf="email" value="' + esc(syncUI.email) + '" placeholder="you@example.com"></label>' +
        '<label class="field"><span class="field-label">รหัสผ่าน (อย่างน้อย 6 ตัว)</span>' +
          '<input type="password" autocomplete="current-password" data-sf="password" placeholder="••••••••"></label>' +
      '</div>' +
      '<div class="row-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary btn-sm" data-sync="pwlogin"' + (syncUI.busy ? ' disabled' : '') + '>' +
          (syncUI.busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ') + '</button>' +
        '<button class="btn btn-sm" data-sync="pwsignup"' + (syncUI.busy ? ' disabled' : '') + '>สมัครใหม่</button>' +
        '<button class="btn btn-ghost btn-sm" data-sync="usemail">ส่งลิงก์ทางอีเมลแทน</button>' +
      '</div>' +
      '<p class="budget-foot">ครั้งแรกให้ใส่อีเมลกับรหัสผ่านที่ต้องการ แล้วกด <strong>สมัครใหม่</strong> · เครื่องอื่นใช้อีเมลกับรหัสผ่านเดียวกันเพื่อดูข้อมูลชุดเดียวกัน</p>' + note;
  }

  function openSync() {
    syncUI.error = '';
    syncUI.message = '';
    $('#syncModal').hidden = false;
    renderSyncModal();
  }

  function closeSync() { $('#syncModal').hidden = true; }

  function refreshAfterSync() {
    renderList();
    renderBudgetAlert();
    if ($('#panel-summary').classList.contains('is-active')) renderSummary();
  }

  /* ข้อมูลในเครื่องเป็นของบัญชีไหน — กันข้อมูลของคนก่อนหน้าปนเข้าบัญชีใหม่บนเครื่องเดียวกัน */
  function localHasData() {
    return ExpenseStore.allWithDeleted().length > 0 || ExpenseStore.friends.allWithDeleted().length > 0;
  }
  function ownerConflict() {
    var user = CloudSync.user();
    if (!user) return null;
    var owner = ExpenseStore.owner.get();
    if (!owner || !owner.userId) return null;                 // ยังไม่เคยผูกกับบัญชีไหน
    if (owner.userId === user.id) return null;                // บัญชีเดิม ปกติ
    return owner;                                             // คนละบัญชี ต้องให้ผู้ใช้ตัดสินใจก่อน
  }
  function claimOwnership() {
    var user = CloudSync.user();
    if (user) ExpenseStore.owner.set(user.id, user.email);
  }

  /* กันทุกทางที่เรียกซิงก์ ไม่ใช่แค่ปุ่มเดียว */
  CloudSync.setProfile(myName);
  CloudSync.setGuard(function () {
    var c = ownerConflict();
    return c ? 'ข้อมูลในเครื่องนี้เป็นของบัญชี ' + (c.email || c.userId) + ' — เปิด ☁️ แล้วเลือกก่อนว่าจะเก็บหรือล้าง' : null;
  });

  function runSync(silent) {
    if (!CloudSync.isConfigured() || !CloudSync.user()) return;
    if (ownerConflict()) {                                    // ยังไม่ได้ตัดสินใจ — ห้ามซิงก์เด็ดขาด
      if (!silent) { $('#syncModal').hidden = false; renderSyncModal(); }
      return;
    }
    claimOwnership();
    syncUI.busy = true;
    syncUI.error = '';
    renderSyncModal();
    CloudSync.syncNow().then(function (counts) {
      syncUI.busy = false;
      lastSyncFinished = Date.now();
      if (!counts || !counts.skipped) {
        syncUI.message = 'ซิงก์เรียบร้อย · รับมา ' + (counts.pulled || 0) + ' รายการ · ส่งขึ้น ' + (counts.pushed || 0) + ' รายการ' +
          (counts.note ? ' · ' + counts.note : '');
        refreshAfterSync();
        if (!silent && (counts.pulled || counts.pushed)) toast(syncUI.message);
      }
      renderSyncModal();
      renderSyncBadge();
    }).catch(function (err) {
      syncUI.busy = false;
      syncUI.error = err.message || 'ซิงก์ไม่สำเร็จ';
      renderSyncModal();
      if (!silent) toast('ซิงก์ไม่สำเร็จ: ' + syncUI.error);
    });
  }

  $('#syncBtn').addEventListener('click', openSync);
  $('#syncModal').addEventListener('click', function (ev) {
    if (ev.target === this) closeSync();
    var btn = ev.target.closest('[data-sync]');
    if (!btn) return;
    var act = btn.dataset.sync;
    var body = $('#syncBody');

    if (act === 'close') { closeSync(); return; }
    if (act === 'usemail') { syncUI.step = 'maillink'; syncUI.error = ''; syncUI.message = ''; renderSyncModal(); return; }
    if (act === 'usepassword') { syncUI.step = 'password'; syncUI.error = ''; syncUI.message = ''; renderSyncModal(); return; }
    if (act === 'pwlogin' || act === 'pwsignup') {
      var emailEl = $('[data-sf="email"]', body);
      var passEl = $('[data-sf="password"]', body);
      var mail = (emailEl ? emailEl.value : '').trim();
      var pass = passEl ? passEl.value : '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { syncUI.error = 'กรุณาใส่อีเมลให้ถูกต้อง'; renderSyncModal(); return; }
      if (pass.length < 6) { syncUI.error = 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'; renderSyncModal(); return; }
      syncUI.email = mail;
      syncUI.busy = true;
      syncUI.error = '';
      renderSyncModal();
      var work = act === 'pwlogin'
        ? CloudSync.signInWithPassword(mail, pass).then(function () { return { session: true }; })
        : CloudSync.signUpWithPassword(mail, pass);
      work.then(function (res) {
        syncUI.busy = false;
        if (res && res.needsConfirm) {
          syncUI.message = 'สมัครแล้ว — Supabase ตั้งให้ต้องยืนยันอีเมลก่อน กดลิงก์ในอีเมลหนึ่งครั้ง หรือปิด "Confirm email" ในหน้า Supabase แล้วกดเข้าสู่ระบบได้เลย';
          renderSyncModal();
          return;
        }
        syncUI.message = 'ล็อกอินสำเร็จ กำลังซิงก์ข้อมูล…';
        renderSyncModal();
        renderSyncBadge();
        runSync(true);
      }).catch(function (err) {
        syncUI.busy = false;
        syncUI.error = err.message;
        renderSyncModal();
      });
      return;
    }
    if (act === 'back') { syncUI.step = 'maillink'; syncUI.error = ''; syncUI.message = ''; renderSyncModal(); return; }
    if (act === 'now') { runSync(false); return; }
    if (act === 'wipe') {
      if (!confirm('ล้างข้อมูลในเบราว์เซอร์นี้ทั้งหมด แล้วดึงของบัญชี ' + CloudSync.email() + ' มาแทนใช่ไหม?\n' +
                   '(ข้อมูลของบัญชีเดิมที่เคยซิงก์ขึ้นไปแล้วยังอยู่บนเซิร์ฟเวอร์)')) return;
      ExpenseStore.wipeLocal();
      claimOwnership();
      syncUI.message = 'ล้างข้อมูลเดิมแล้ว กำลังดึงข้อมูลของบัญชีนี้…';
      renderSyncModal();
      runSync(false);
      refreshAfterSync();
      return;
    }
    if (act === 'adopt') {
      if (!confirm('ย้ายข้อมูลทั้งหมดในเครื่องนี้เข้าบัญชี ' + CloudSync.email() + ' ใช่ไหม?')) return;
      ExpenseStore.markAllDirty();
      claimOwnership();
      syncUI.message = 'กำลังย้ายข้อมูลเข้าบัญชีนี้…';
      renderSyncModal();
      runSync(false);
      return;
    }
    if (act === 'backup') { $('#backupBtn').click(); return; }
    if (act === 'signout') {
      CloudSync.signOut().then(function () {
        syncUI.step = 'password';
        syncUI.message = 'ออกจากระบบแล้ว (ข้อมูลในเครื่องยังอยู่ครบ)';
        syncUI.error = '';
        renderSyncModal();
        renderSyncBadge();
      });
      return;
    }
    if (act === 'send' || act === 'resend') {
      var emailInput = $('[data-sf="email"]', body);
      var email = (emailInput ? emailInput.value : syncUI.email).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { syncUI.error = 'กรุณาใส่อีเมลให้ถูกต้อง'; renderSyncModal(); return; }
      syncUI.email = email;
      syncUI.busy = true;
      syncUI.error = '';
      renderSyncModal();
      CloudSync.sendCode(email).then(function () {
        syncUI.busy = false;
        syncUI.step = 'code';
        syncUI.message = 'ส่งรหัสแล้ว ถ้าไม่เจอในกล่องจดหมาย ลองดูในสแปม';
        renderSyncModal();
      }).catch(function (err) {
        syncUI.busy = false;
        syncUI.error = err.message;
        renderSyncModal();
      });
      return;
    }
    if (act === 'verify') {
      var codeInput = $('[data-sf="code"]', body);
      var code = codeInput ? codeInput.value.trim() : '';
      if (code.length < 4) { syncUI.error = 'กรุณาใส่รหัสจากอีเมล'; renderSyncModal(); return; }
      syncUI.busy = true;
      syncUI.error = '';
      renderSyncModal();
      CloudSync.verifyCode(syncUI.email, code).then(function () {
        syncUI.busy = false;
        syncUI.message = 'ล็อกอินสำเร็จ กำลังซิงก์ข้อมูล…';
        renderSyncModal();
        renderSyncBadge();
        runSync(true);
      }).catch(function (err) {
        syncUI.busy = false;
        syncUI.error = err.message;
        renderSyncModal();
      });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#imgModal').hidden) { closeViewer(); return; }
    if (!$('#bgModal').hidden) closeBgModal();
    if (!$('#syncModal').hidden) closeSync();
    if (!$('#bookModal').hidden) closeBookModal();
    if (!$('#bellModal').hidden) closeBell();
    if (!$('#payModal').hidden) closePayModal();
    if (!$('#sendModal').hidden) closeSendModal();
  });

  CloudSync.onState(function () { renderSyncBadge(); renderSyncModal(); });

  /* แก้ข้อมูลในเครื่องแล้วซิงก์ตามให้อัตโนมัติ (หน่วงไว้กันซิงก์ถี่เกินไป) */
  ExpenseStore.onChange(function () {
    if (!CloudSync.isConfigured() || !CloudSync.user()) return;
    if (Date.now() - lastSyncFinished < 4000) return;
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function () { runSync(true); }, 3000);
  });

  /* ---------------- เริ่มต้น ---------------- */
  renderQueueHead();
  renderBookBar();
  renderList();
  renderBudgetAlert();
  renderDebtBadge();
  renderFriendBadge();
  renderBell();
  importFromHash();
  importFriendFromHash();
  window.addEventListener('hashchange', function () { importFromHash(); importFriendFromHash(); });

  /* ปุ่มคัดลอกลิงก์สำหรับใส่ใน Shortcut — ใช้ที่อยู่จริงของหน้าเว็บที่กำลังเปิดอยู่ */
  (function () {
    var code = $('#shortcutUrl'), btn = $('#copyShortcutUrl'), pick = $('#shortcutBook');
    if (!code || !btn) return;
    var url = '';

    function refresh() {
      if (pick) {
        var current = pick.value;
        pick.innerHTML = '<option value="">สมุดที่กำลังใช้อยู่ตอนนั้น</option>' +
          ExpenseStore.books().map(function (b) {
            return '<option value="' + esc(b.name) + '">' + esc(b.name) + '</option>';
          }).join('');
        if (current && pick.querySelector('option[value="' + current.replace(/"/g, '\\"') + '"]')) pick.value = current;
      }
      var name = pick ? pick.value : '';
      url = location.origin + location.pathname + '#' +
        (name ? 'book=' + encodeURIComponent(name) + '&' : '') + 'slip=';
      code.textContent = url;
    }
    refresh();
    if (pick) pick.addEventListener('change', refresh);
    ExpenseStore.onChange(refresh);

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var done = function () { toast('คัดลอกลิงก์แล้ว — วางในช่อง “เปิด URL” แล้วต่อด้วยข้อความที่เข้ารหัสไว้'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { toast('คัดลอกไม่สำเร็จ กดค้างที่ลิงก์เพื่อคัดลอกเอง'); });
      } else {
        var r = document.createRange(); r.selectNodeContents(code);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast('เลือกลิงก์ไว้ให้แล้ว กดคัดลอกได้เลย');
      }
    });
  })();

  renderSyncBadge();
  ExpenseStore.onChange(function () { renderBookBar(); renderDebtBadge(); renderFriendBadge(); renderBell(); });
  CloudSync.onState(function () {
    renderDebtBadge();
    renderBell();
    if ($('#panel-debt').classList.contains('is-active')) renderDebts();
    if ($('#panel-friends').classList.contains('is-active')) renderFriendsTab();
  });
  /* เช็กแจ้งเตือนจากเพื่อนเป็นระยะขณะเปิดแอปอยู่ และทันทีที่กลับมาเปิดแอป */
  setInterval(function () {
    if (document.visibilityState === 'visible' && syncReady() && !ownerConflict()) runSync(true);
  }, 120e3);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && syncReady() && !ownerConflict() && Date.now() - lastSyncFinished > 60e3) runSync(true);
  });

  if (CloudSync.isConfigured()) {
    var cameFromEmailLink = /access_token=|error_description=/.test(location.hash);
    CloudSync.init().then(function (session) {
      renderSyncBadge();
      if (cameFromEmailLink) {
        history.replaceState(null, '', location.pathname + location.search);   // ล้าง token ออกจาก URL
        if (session) toast('ล็อกอินสำเร็จ กำลังซิงก์ข้อมูล…');
      }
      if (session) { runSync(true); refreshPushSub(); }
      if (/#bell$/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); openBell(); }
    }).catch(function () { /* ต่อเซิร์ฟเวอร์ไม่ได้ก็ใช้งานออฟไลน์ได้ตามปกติ */ });
  }
})();
