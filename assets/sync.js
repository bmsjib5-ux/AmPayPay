/* ซิงก์รายจ่ายกับ Supabase — ล็อกอินด้วยอีเมล (รหัส OTP) และรวมข้อมูลแบบแก้ล่าสุดชนะ
   รูปใบเสร็จไม่ถูกอัปโหลด เก็บไว้ในเครื่องเท่านั้น */
window.CloudSync = (function () {
  'use strict';

  var LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js';
  var client = null;
  var libPromise = null;
  var session = null;
  var listeners = [];
  var syncing = false;
  var featureNote = '';
  var profileName = null;
  /* โครงตารางแบบเข้ารหัส (v51+): อีเมลเก็บเป็นรหัส ค้นหาด้วย sha256(lower(email)) ผ่านคอลัมน์ …_hash
     และเขียนผ่าน view ด้วย insert (view จัดการ upsert ให้เอง) · ถ้าตารางยังเป็นแบบเก่า ใช้วิธีเดิม */
  var piiMode = null;
  function sha256Hex(str) {
    var text = String(str || '').trim().toLowerCase();
    if (!text) return Promise.resolve('');
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('เบราว์เซอร์นี้คำนวณแฮชไม่ได้'));
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var out = '', u8 = new Uint8Array(buf);
      for (var i = 0; i < u8.length; i++) out += ('0' + u8[i].toString(16)).slice(-2);
      return out;
    });
  }
  function detectPiiMode(c) {
    if (piiMode !== null) return Promise.resolve(piiMode);
    var probe;
    try { probe = c.from('friends').select('email_hash').limit(1); } catch (e) { piiMode = false; return Promise.resolve(false); }
    return Promise.resolve(probe).then(function (res) {
      piiMode = !(res && res.error);
      return piiMode;
    }, function () { piiMode = false; return false; });
  }
  var guard = null;          // ฟังก์ชันที่แอปตั้งไว้ ถ้าคืนข้อความ = ห้ามซิงก์

  function config() {
    var c = window.SUPABASE_CONFIG || {};
    return { url: (c.url || '').trim(), anonKey: (c.anonKey || '').trim() };
  }

  function isConfigured() {
    var c = config();
    return !!(c.url && c.anonKey);
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  function loadLibrary() {
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve(window.supabase);
      var el = document.createElement('script');
      el.src = LIB_URL;
      el.onload = function () {
        if (window.supabase && window.supabase.createClient) resolve(window.supabase);
        else reject(new Error('โหลดไลบรารี Supabase ไม่สำเร็จ'));
      };
      el.onerror = function () { reject(new Error('โหลดไลบรารี Supabase ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต')); };
      document.head.appendChild(el);
    }).catch(function (err) {
      libPromise = null;
      throw err;
    });
    return libPromise;
  }

  /* "จดจำฉันไว้ในเครื่องนี้" — ติ๊กไว้เก็บ session ใน localStorage (ปิดแอปแล้วยังล็อกอินอยู่)
     ไม่ติ๊กก็เก็บใน sessionStorage แทน ปิดแท็บ/แอปแล้วต้องล็อกอินใหม่ */
  var REMEMBER_KEY = 'expense-book:remember:v1';
  function remember() {
    try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (e) { return true; }
  }
  var authStorage = {
    getItem: function (k) {
      try { return (remember() ? localStorage : sessionStorage).getItem(k); } catch (e) { return null; }
    },
    setItem: function (k, v) {
      try { (remember() ? localStorage : sessionStorage).setItem(k, v); } catch (e) {}
    },
    removeItem: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
      try { sessionStorage.removeItem(k); } catch (e) {}
    }
  };

  function getClient() {
    if (client) return Promise.resolve(client);
    if (!isConfigured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase ในไฟล์ assets/config.js'));
    var c = config();
    return loadLibrary().then(function (lib) {
      client = lib.createClient(c.url, c.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage }
      });
      client.auth.onAuthStateChange(function (_event, next) {
        session = next;
        emit();
      });
      return client;
    });
  }

  /* ส่วนเสริมที่ถ้าเซิร์ฟเวอร์ยังไม่มีตารางรองรับ ให้ข้ามไปเงียบๆ แทนที่จะล้มทั้งการซิงก์ */
  function optional(promise) {
    return promise.catch(function (err) {
      var msg = (err && err.message) || '';
      if (/ยังไม่ได้สร้างตาราง|ไม่มีตาราง|does not exist|schema cache|โครงตาราง|โครงเวอร์ชันเก่า/i.test(msg)) {
        featureNote = 'ระบบเพื่อน/ใบแจ้งหนี้ยังใช้ไม่ได้ — รันไฟล์ supabase/schema.sql ซ้ำอีกครั้งก่อน';
        return null;
      }
      throw err;
    });
  }

  function claimToLocal(row) {
    return {
      id: row.id,
      fromUser: row.from_user,
      fromEmail: String(row.from_email || '').toLowerCase(),
      fromName: row.from_name || '',
      toEmail: String(row.to_email || '').toLowerCase(),
      amount: Number(row.amount) || 0,
      note: row.note || '',
      expenseId: row.expense_id || '',
      personId: row.person_id || '',
      status: row.status || 'pending',
      reply: row.reply || '',
      promptpay: row.promptpay || '',
      image: ExpenseStore.safeImage(row.image) || '',       // รูปจากอีกฝ่าย ต้องเป็น data URL ของรูปจริงเท่านั้น
      deleted: !!row.deleted,
      createdAt: Date.parse(row.created_at) || Date.now(),
      updatedAt: Date.parse(row.updated_at) || Date.now()
    };
  }

  function friendly(error) {
    var msg = (error && (error.message || error.error_description)) || 'เกิดข้อผิดพลาด';
    if (/invalid login credentials/i.test(msg)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง (ถ้ายังไม่เคยสมัคร กด "สมัครใหม่")';
    if (/email not confirmed/i.test(msg)) return 'อีเมลนี้ยังไม่ได้ยืนยัน — ปิด "Confirm email" ใน Supabase หรือกดยืนยันในอีเมลก่อน';
    if (/user already registered|already been registered/i.test(msg)) return 'อีเมลนี้สมัครไว้แล้ว กด "เข้าสู่ระบบ" ได้เลย';
    if (/password should be at least|weak password/i.test(msg)) return 'รหัสผ่านสั้นเกินไป ต้องอย่างน้อย 6 ตัวอักษร';
    if (/token has expired|invalid|expired/i.test(msg)) return 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่';
    if (/rate|too many/i.test(msg)) return 'ขอรหัสถี่เกินไป รอสักครู่แล้วลองใหม่';
    // ยังไม่เคยรัน schema.sql เลย
    if (/could not find the table|relation .* does not exist/i.test(msg)) {
      var tbl = (msg.match(/'public\.(\w+)'/) || msg.match(/relation "?(\w+)"? does not exist/i) || [])[1];
      return 'ยังไม่ได้สร้างตาราง' + (tbl ? ' "' + tbl + '"' : '') + ' ใน Supabase — ' +
        'เปิด SQL Editor แล้วรันไฟล์ supabase/schema.sql ทั้งไฟล์';
    }
    // เคยรันแล้วแต่เป็นเวอร์ชันเก่า ตารางมีแต่คอลัมน์ยังไม่ครบ
    if (/does not exist|schema cache/i.test(msg) && /column/i.test(msg)) {
      var col = (msg.match(/column ([\w.]+) does not exist/i) || msg.match(/find the '([^']+)' column/i) || [])[1];
      return 'ตารางใน Supabase ยังเป็นโครงเวอร์ชันเก่า' + (col ? ' (ขาดคอลัมน์ ' + col + ')' : '') +
        ' — เปิด SQL Editor แล้วรันไฟล์ supabase/schema.sql ซ้ำอีกครั้ง รันซ้ำได้ ข้อมูลเดิมไม่หาย';
    }
    if (/schema cache/i.test(msg)) return 'โครงตารางใน Supabase ไม่ตรงกับแอป — รันไฟล์ supabase/schema.sql ซ้ำอีกครั้ง';
    if (/failed to fetch|network/i.test(msg)) return 'ต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต';
    return msg;
  }

  var api = {
    isConfigured: isConfigured,
    onState: function (fn) { listeners.push(fn); },
    remember: remember,
    setRemember: function (on) {
      try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch (e) {}
    },
    user: function () { return session && session.user ? session.user : null; },
    email: function () { var u = api.user(); return u ? u.email : ''; },

    /* เรียกตอนเปิดแอป — คืนค่าว่ามี session ค้างอยู่ไหม */
    init: function () {
      if (!isConfigured()) return Promise.resolve(null);
      return getClient()
        .then(function (c) { return c.auth.getSession(); })
        .then(function (res) {
          session = (res && res.data && res.data.session) || null;
          emit();
          return session;
        });
    },

    /* ล็อกอินด้วยรหัสผ่าน — ไม่ต้องพึ่งอีเมลเลย */
    signInWithPassword: function (email, password) {
      return getClient().then(function (c) {
        return c.auth.signInWithPassword({ email: email, password: password });
      }).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        session = res.data.session;
        emit();
        return session;
      });
    },

    signUpWithPassword: function (email, password) {
      return getClient().then(function (c) {
        return c.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
      }).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        session = res.data.session || null;
        emit();
        return { session: session, needsConfirm: !res.data.session };
      });
    },

    /* ลืมรหัสผ่าน — ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมล */
    resetPassword: function (email) {
      return getClient().then(function (c) {
        return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      }).then(function (res) {
        if (res && res.error) throw new Error(friendly(res.error));
        return true;
      });
    },

    sendCode: function (email) {
      return getClient().then(function (c) {
        return c.auth.signInWithOtp({
          email: email,
          options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname }
        });
      }).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        return true;
      });
    },

    verifyCode: function (email, code) {
      return getClient().then(function (c) {
        return c.auth.verifyOtp({ email: email, token: String(code).trim(), type: 'email' });
      }).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        session = res.data.session;
        emit();
        return session;
      });
    },

    signOut: function () {
      return getClient().then(function (c) { return c.auth.signOut(); }).then(function () {
        session = null;
        piiMode = null;
        ExpenseStore.lastSync.set(0);
        emit();
      });
    },

    /* ดึงของใหม่จากเซิร์ฟเวอร์ รวมกับของในเครื่อง แล้วส่งของที่แก้ในเครื่องขึ้นไป
       ครอบคลุมทั้งสมุด รายจ่าย และงบประมาณของทุกสมุด */
    /* ---------- เพื่อน: ข้อมูลส่วนตัว ซิงก์แบบเดียวกับสมุด ---------- */
    syncFriends: function (c, userId) {
      var me = String((session && session.user && session.user.email) || '').toLowerCase();
      return c.from('friends').select('*').eq('user_id', userId).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        ExpenseStore.friends.mergeRemote((res.data || []).map(function (row) {
          return {
            email: String(row.email || '').toLowerCase(),
            name: row.name || '',
            deleted: !!row.deleted,
            createdAt: Date.parse(row.created_at) || Date.now(),
            updatedAt: Date.parse(row.updated_at) || Date.now()
          };
        }));
        /* เพื่อนสองทาง: ใครเพิ่มเรา เราก็ได้เขาในรายชื่อด้วย (ถ้าตารางยังไม่มีคอลัมน์/สิทธิ์นี้ ก็ข้ามไปเฉยๆ) */
        if (!me) return null;
        return detectPiiMode(c).then(function (pii) {
          return pii ? sha256Hex(me).then(function (h) { return c.from('friends').select('*').eq('email_hash', h); })
                     : c.from('friends').select('*').eq('email', me);
        }).then(function (r2) {
          if (r2.error) return null;
          ExpenseStore.friends.adoptAddedBy((r2.data || []).filter(function (row) {
            return row.owner_email && !row.deleted && row.user_id !== userId;
          }).map(function (row) {
            return {
              email: String(row.owner_email).toLowerCase(),
              name: row.owner_name || '',
              updatedAt: Date.parse(row.updated_at) || Date.now()
            };
          }), me);
        }, function () { return null; });
      }).then(function () {
        var pending = ExpenseStore.friends.pending();
        if (!pending.length) return 0;
        var myName = profileName ? String(profileName() || '') : '';
        var rows = pending.map(function (f) {
          return {
            user_id: userId, email: f.email, name: f.name || '', deleted: !!f.deleted,
            owner_email: me, owner_name: myName,
            created_at: new Date(f.createdAt || Date.now()).toISOString(),
            updated_at: new Date(f.updatedAt || Date.now()).toISOString()
          };
        });
        var push = function (list) {
          return piiMode ? c.from('friends').insert(list) : c.from('friends').upsert(list, { onConflict: 'user_id,email' });
        };
        return push(rows).then(function (up) {
          /* ตารางเวอร์ชันเก่ายังไม่มี owner_email → ส่งแบบไม่มีคอลัมน์นั้นแทน จะได้ไม่พังทั้งการซิงก์ */
          if (up.error && /owner_email|owner_name/.test(up.error.message || '')) {
            featureNote = 'เพื่อนแบบสองทางยังใช้ไม่ได้ — รันไฟล์ supabase/schema.sql ซ้ำอีกครั้งก่อน';
            return push(rows.map(function (r) { delete r.owner_email; delete r.owner_name; return r; }));
          }
          return up;
        }).then(function (up) {
          if (up.error) throw new Error(friendly(up.error));
          ExpenseStore.friends.clearPending(pending.map(function (f) { return f.email; }));
          return pending.length;
        });
      });
    },

    /* ---------- ใบแจ้งหนี้: มีสองฝ่าย จึงดึงใหม่ทั้งชุดทุกครั้ง ---------- */
    syncClaims: function (c) {
      var email = (session && session.user && session.user.email) || '';
      return detectPiiMode(c).then(function (pii) {
        if (!pii) return c.from('debt_claims').select('*').or('from_user.eq.' + session.user.id + ',to_email.eq.' + email);
        return sha256Hex(email).then(function (h) {
          return c.from('debt_claims').select('*').or('from_user.eq.' + session.user.id + ',to_email_hash.eq.' + h);
        });
      }).then(function (res) {
          if (res.error) throw new Error(friendly(res.error));
          var rows = (res.data || []).map(claimToLocal)
            .filter(function (r) { return !r.deleted; })
            .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
          var before = {};
          ExpenseStore.claims.all().forEach(function (r) { before[r.id] = r.status; });
          ExpenseStore.claims.replaceAll(rows);
          var changed = rows.filter(function (r) { return before[r.id] !== r.status; });
          return { total: rows.length, changed: changed.length };
        });
    },

    sendClaim: function (claim) {
      return getClient().then(function (c) {
        if (!session || !session.user) throw new Error('ยังไม่ได้ล็อกอิน');
        var row = {
          id: claim.id,
          from_user: session.user.id,
          from_email: session.user.email || '',
          from_name: claim.fromName || '',
          to_email: String(claim.toEmail || '').trim().toLowerCase(),
          amount: Number(claim.amount) || 0,
          note: claim.note || '',
          expense_id: claim.expenseId || '',
          person_id: claim.personId || '',
          status: claim.status || 'pending',
          reply: claim.reply || '',
          promptpay: String(claim.promptpay || '').slice(0, 40),
          image: (function (v) { var ok = ExpenseStore.safeImage(v); return ok && ok.length <= 150000 ? ok : ''; })(claim.image),
          deleted: false,
          updated_at: new Date().toISOString()
        };
        return detectPiiMode(c).then(function (pii) {
          return pii ? c.from('debt_claims').insert(row) : c.from('debt_claims').upsert(row, { onConflict: 'id' });
        }).then(function (up) {
          /* ตารางเวอร์ชันเก่ายังไม่มีคอลัมน์ promptpay → ส่งแบบไม่มีคอลัมน์นั้นแทน */
          if (up.error && /promptpay|image/.test(up.error.message || '')) {
            featureNote = 'QR พร้อมเพย์/รูปใบเสร็จในใบแจ้งหนี้ยังใช้ไม่ได้ — รันไฟล์ supabase/schema.sql ซ้ำอีกครั้งก่อน';
            var row2 = Object.assign({}, row); delete row2.promptpay; delete row2.image;
            return piiMode ? c.from('debt_claims').insert(row2) : c.from('debt_claims').upsert(row2, { onConflict: 'id' });
          }
          return up;
        }).then(function (up) {
          if (up.error) throw new Error(friendly(up.error));
          return claimToLocal(row);
        });
      });
    },

    /* ลูกหนี้กดว่าจ่ายแล้ว / เจ้าหนี้ยืนยันรับเงิน — เซิร์ฟเวอร์มี trigger คุมว่าใครแก้อะไรได้ */
    updateClaim: function (id, patch) {
      return getClient().then(function (c) {
        var row = { updated_at: new Date().toISOString() };
        if (patch.status) row.status = patch.status;
        if (patch.reply !== undefined) row.reply = String(patch.reply || '').slice(0, 200);
        if (patch.deleted !== undefined) row.deleted = !!patch.deleted;
        return c.from('debt_claims').update(row).eq('id', id).then(function (up) {
          if (up.error) throw new Error(friendly(up.error));
          return true;
        });
      });
    },

    /* ---------- push แจ้งเตือน: จดเครื่องนี้ไว้ให้ Edge Function ส่งหาได้ ---------- */
    savePushSubscription: function (sub) {
      return getClient().then(function (c) {
        if (!session || !session.user) throw new Error('ยังไม่ได้ล็อกอิน');
        var j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
        var row = {
          endpoint: j.endpoint,
          user_id: session.user.id,
          email: String(session.user.email || '').toLowerCase(),
          p256dh: (j.keys && j.keys.p256dh) || '',
          auth: (j.keys && j.keys.auth) || '',
          user_agent: String(navigator.userAgent || '').slice(0, 200),
          updated_at: new Date().toISOString()
        };
        return detectPiiMode(c).then(function (pii) {
          return pii ? c.from('push_subscriptions').insert(row) : c.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
        }).then(function (up) {
          if (up.error) throw new Error(friendly(up.error));
          return true;
        });
      });
    },
    /* ตรวจว่าฝั่ง Supabase พร้อมสำหรับ push หรือยัง (ตาราง / Edge Function / secrets) */
    checkPushSetup: function () {
      var out = { table: null, fn: null, fnDetail: '', mine: null, devices: [] };
      return getClient().then(function (c) {
        /* RLS คืนเฉพาะแถวของบัญชีนี้ จึงนับได้เลยว่ามีกี่เครื่องที่จะได้รับแจ้งเตือน */
        return c.from('push_subscriptions').select('endpoint,user_agent,updated_at').then(function (res) {
          out.table = !res.error;
          if (res.error) out.tableDetail = friendly(res.error);
          out.devices = res.error ? [] : (res.data || []);
          out.mine = out.devices.length > 0;
        });
      }).then(function () {
        var cfg = config();
        var url = String(cfg.url || '').replace(/\/$/, '') + '/functions/v1/push-notify?ping=1';
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) {
            if (r.status === 401) { out.fn = false; out.fnDetail = 'ฟังก์ชันยังเปิด Verify JWT อยู่ — ปิดในหน้า Edge Functions → push-notify → Details'; return; }
            if (r.status === 404) { out.fn = false; out.fnDetail = 'ไม่พบฟังก์ชันชื่อ push-notify — ยังไม่ได้ deploy หรือชื่อไม่ตรง'; return; }
            return r.json().then(function (j) {
              if (j && j.ok) {
                out.fn = !!j.vapid && !!j.secret;
                out.fnDetail = !j.vapid ? 'deploy แล้ว แต่ยังไม่ได้ใส่ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ใน Secrets'
                  : !j.secret ? 'deploy แล้ว แต่ยังไม่ได้ใส่ WEBHOOK_SECRET ใน Secrets' : 'พร้อมใช้งาน';
              } else { out.fn = false; out.fnDetail = 'ฟังก์ชันตอบ ' + r.status + ' — อาจเป็นโค้ดเวอร์ชันเก่า ให้วางไฟล์ index.ts ล่าสุดแล้ว deploy ใหม่'; }
            }, function () { out.fn = false; out.fnDetail = 'ฟังก์ชันตอบ ' + r.status + ' — ให้วางไฟล์ index.ts ล่าสุดแล้ว deploy ใหม่'; });
          }, function () { out.fn = false; out.fnDetail = 'เรียกฟังก์ชันไม่ได้ (ไม่พบ หรือเป็นโค้ดเวอร์ชันเก่าที่ไม่ตอบ CORS) — ให้วาง index.ts ล่าสุดแล้ว deploy ใหม่'; });
      }).then(function () { return out; });
    },
    removePushSubscription: function (endpoint) {
      return getClient().then(function (c) {
        return c.from('push_subscriptions').delete().eq('endpoint', endpoint).then(function (res) {
          if (res.error) throw new Error(friendly(res.error));
          return true;
        });
      });
    },

    /* ให้แอปห้ามซิงก์ได้ เช่น ตอนข้อมูลในเครื่องเป็นของอีกบัญชีและยังไม่ได้ตัดสินใจ */
    setGuard: function (fn) { guard = fn; },
    /* ชื่อเล่นจากบัตรของฉัน ใส่ไปกับแถวเพื่อน เพื่อให้ฝั่งที่ถูกเพิ่มเห็นชื่อเรา */
    setProfile: function (fn) { profileName = fn; },

    syncNow: function () {
      if (!isConfigured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase'));
      var blocked = guard ? guard() : null;
      if (blocked) return Promise.reject(new Error(blocked));
      if (syncing) return Promise.resolve({ skipped: true });
      var startedAt = Date.now();
      featureNote = '';
      var userId, c;
      var counts = { pulled: 0, pushed: 0 };
      syncing = true;

      return getClient().then(function (cl) {
        c = cl;
        if (!session || !session.user) throw new Error('ยังไม่ได้ล็อกอิน');
        userId = session.user.id;
        /* รายจ่าย งบประมาณ และสมุด ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ — เก็บไว้ในเครื่องอย่างเดียว
           บนฐานข้อมูลมีแค่บัญชีผู้ใช้ รายชื่อเพื่อน และใบแจ้งหนี้ (ลูกหนี้) */
        // ยังไม่ได้รัน schema.sql เวอร์ชันใหม่ ก็ไม่ควรทำให้ทั้งการซิงก์ล้ม
        return optional(api.syncFriends(c, userId).then(function (n) { counts.pushed += n; }));
      }).then(function () {
        return optional(api.syncClaims(c));   // ใบแจ้งหนี้ดึงใหม่ทั้งหมดเสมอ เพราะอีกฝ่ายแก้ได้
      }).then(function (claimInfo) {
        counts.claims = claimInfo;
        counts.note = featureNote;
        ExpenseStore.lastSync.set(startedAt - 5000);   // เผื่อเวลาคลาดเคลื่อนเล็กน้อย
        syncing = false;
        emit();
        return counts;
      }).catch(function (err) {
        syncing = false;
        throw err;
      });
    }
  };

  return api;
})();
