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

  function getClient() {
    if (client) return Promise.resolve(client);
    if (!isConfigured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase ในไฟล์ assets/config.js'));
    var c = config();
    return loadLibrary().then(function (lib) {
      client = lib.createClient(c.url, c.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange(function (_event, next) {
        session = next;
        emit();
      });
      return client;
    });
  }

  /* ---------- แปลงรูปแบบข้อมูลระหว่างเครื่องกับฐานข้อมูล ---------- */
  function toRemote(rec, userId) {
    return {
      id: rec.id,
      user_id: userId,
      date: rec.date,
      merchant: rec.merchant,
      amount: Number(rec.amount) || 0,
      category: rec.category || 'other',
      note: rec.note || '',
      items: rec.items || [],
      raw_text: rec.rawText || '',
      deleted: !!rec.deleted,
      created_at: new Date(rec.createdAt || Date.now()).toISOString(),
      updated_at: new Date(rec.updatedAt || Date.now()).toISOString()
    };
  }

  function toLocal(row) {
    return {
      id: row.id,
      date: row.date,
      merchant: row.merchant || '',
      amount: Number(row.amount) || 0,
      category: row.category || 'other',
      note: row.note || '',
      items: Array.isArray(row.items) ? row.items : [],
      rawText: row.raw_text || '',
      deleted: !!row.deleted,
      createdAt: Date.parse(row.created_at) || Date.now(),
      updatedAt: Date.parse(row.updated_at) || Date.now()
    };
  }

  function friendly(error) {
    var msg = (error && (error.message || error.error_description)) || 'เกิดข้อผิดพลาด';
    if (/token has expired|invalid|expired/i.test(msg)) return 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่';
    if (/rate|too many/i.test(msg)) return 'ขอรหัสถี่เกินไป รอสักครู่แล้วลองใหม่';
    if (/relation .* does not exist|schema cache/i.test(msg)) return 'ยังไม่ได้สร้างตารางใน Supabase — รันไฟล์ supabase/schema.sql ก่อน';
    if (/failed to fetch|network/i.test(msg)) return 'ต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต';
    return msg;
  }

  var api = {
    isConfigured: isConfigured,
    onState: function (fn) { listeners.push(fn); },
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
        ExpenseStore.lastSync.set(0);
        emit();
      });
    },

    /* ดึงของใหม่จากเซิร์ฟเวอร์ รวมกับของในเครื่อง แล้วส่งของที่แก้ในเครื่องขึ้นไป */
    syncNow: function () {
      if (!isConfigured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase'));
      if (syncing) return Promise.resolve({ skipped: true });
      var startedAt = Date.now();
      var since = ExpenseStore.lastSync.get();
      var userId, c;
      syncing = true;

      return getClient().then(function (cl) {
        c = cl;
        if (!session || !session.user) throw new Error('ยังไม่ได้ล็อกอิน');
        userId = session.user.id;

        var query = c.from('expenses').select('*').eq('user_id', userId);
        if (since) query = query.gt('updated_at', new Date(since).toISOString());
        return query;
      }).then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        var pulled = ExpenseStore.mergeRemote((res.data || []).map(toLocal));

        var outgoing = ExpenseStore.changedSince(since).map(function (rec) { return toRemote(rec, userId); });
        var step = outgoing.length
          ? c.from('expenses').upsert(outgoing, { onConflict: 'user_id,id' })
          : Promise.resolve({ error: null });

        return Promise.resolve(step).then(function (up) {
          if (up && up.error) throw new Error(friendly(up.error));
          return { pulled: pulled, pushed: outgoing.length };
        });
      }).then(function (counts) {
        return api.syncBudget(c, userId).then(function () { return counts; });
      }).then(function (counts) {
        ExpenseStore.lastSync.set(startedAt - 5000);   // เผื่อเวลาคลาดเคลื่อนเล็กน้อย
        syncing = false;
        emit();
        return counts;
      }).catch(function (err) {
        syncing = false;
        throw err;
      });
    },

    syncBudget: function (c, userId) {
      var local = ExpenseStore.budget.get();
      return c.from('budgets').select('*').eq('user_id', userId).maybeSingle().then(function (res) {
        if (res.error) throw new Error(friendly(res.error));
        var row = res.data;
        var remoteAt = row ? (Date.parse(row.updated_at) || 0) : 0;
        if (row && remoteAt > (local.updatedAt || 0)) {
          ExpenseStore.budget.set({ total: Number(row.total) || 0, categories: row.categories || {}, updatedAt: remoteAt }, true);
          return null;
        }
        if (!local.updatedAt || (row && remoteAt >= local.updatedAt)) return null;
        return c.from('budgets').upsert({
          user_id: userId,
          total: local.total,
          categories: local.categories,
          updated_at: new Date(local.updatedAt).toISOString()
        }, { onConflict: 'user_id' }).then(function (up) {
          if (up.error) throw new Error(friendly(up.error));
          return null;
        });
      });
    }
  };

  return api;
})();
