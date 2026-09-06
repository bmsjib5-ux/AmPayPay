/* เก็บรายจ่ายไว้ใน localStorage ของเครื่อง และเตรียมข้อมูลให้ซิงก์ขึ้น Supabase ได้ */
window.ExpenseStore = (function () {
  'use strict';

  var KEY = 'expense-book:v1';
  var THEME_KEY = 'expense-book:theme';
  var BUDGET_KEY = 'expense-book:budget:v1';
  var SYNC_KEY = 'expense-book:lastSync';
  var cache = null;
  var listeners = [];

  function read() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(KEY);
      cache = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cache)) cache = [];
    } catch (e) {
      cache = [];
    }
    return cache;
  }

  /* localStorage มีโควตาจำกัด — ถ้าเต็ม ให้ทิ้งรูปย่อของรายการเก่าสุดทีละรายการแล้วลองใหม่ */
  function write(list) {
    cache = list;
    for (var attempt = 0; attempt < 30; attempt++) {
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
        notify();
        return { ok: true, droppedImages: attempt };
      } catch (e) {
        var victim = null;
        for (var i = list.length - 1; i >= 0; i--) {
          if (list[i].image) { victim = list[i]; break; }
        }
        if (!victim) { notify(); return { ok: false, droppedImages: attempt }; }
        victim.image = null;
      }
    }
    notify();
    return { ok: false, droppedImages: 30 };
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  function sortByDateDesc(list) {
    return list.slice().sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });
  }

  function newId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clean(exp) {
    var created = exp.createdAt || Date.now();
    return {
      id: exp.id || newId(),
      date: exp.date,
      merchant: (exp.merchant || '').trim() || 'ไม่ระบุร้าน',
      amount: Number(exp.amount) || 0,
      category: exp.category || 'other',
      note: (exp.note || '').trim(),
      items: Array.isArray(exp.items) ? exp.items.slice(0, 40) : [],
      rawText: (exp.rawText || '').slice(0, 4000),
      image: exp.image || null,
      deleted: !!exp.deleted,
      createdAt: created,
      updatedAt: exp.updatedAt || created
    };
  }

  var api = {
    /* รายการที่ยังไม่ถูกลบ */
    all: function () {
      return sortByDateDesc(read().filter(function (e) { return !e.deleted; }));
    },
    /* รวมรายการที่ถูกลบด้วย — ใช้ตอนซิงก์ เพื่อให้การลบไปถึงเครื่องอื่น */
    allWithDeleted: function () { return read().slice(); },
    get: function (id) {
      var list = read();
      for (var i = 0; i < list.length; i++) if (list[i].id === id && !list[i].deleted) return list[i];
      return null;
    },
    add: function (exp) {
      var list = read().slice();
      var rec = clean(exp);
      rec.updatedAt = Date.now();
      list.push(rec);
      return { record: rec, result: write(list) };
    },
    update: function (id, patch) {
      var list = read().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i] = clean(Object.assign({}, list[i], patch, { id: id }));
          list[i].updatedAt = Date.now();
          break;
        }
      }
      return write(list);
    },
    /* ลบแบบทิ้งร่องรอยไว้ เพื่อให้ซิงก์การลบไปเครื่องอื่นได้ */
    remove: function (id) {
      var list = read().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].deleted = true;
          list[i].image = null;
          list[i].updatedAt = Date.now();
          break;
        }
      }
      return write(list);
    },
    replaceAll: function (list) {
      var now = Date.now();
      var cleaned = (list || []).filter(function (e) { return e && e.date && e.amount; }).map(function (e) {
        var rec = clean(e);
        rec.updatedAt = now;
        return rec;
      });
      return write(cleaned);
    },

    /* ---------- ส่วนที่ใช้ตอนซิงก์ ---------- */
    changedSince: function (ts) {
      return read().filter(function (e) { return (e.updatedAt || 0) > (ts || 0); });
    },
    /* รวมข้อมูลจากเซิร์ฟเวอร์เข้ากับของในเครื่อง — ฝั่งที่แก้ล่าสุดชนะ */
    mergeRemote: function (rows) {
      var list = read().slice();
      var byId = {};
      list.forEach(function (e, i) { byId[e.id] = i; });
      var applied = 0;
      (rows || []).forEach(function (row) {
        var idx = byId[row.id];
        if (idx === undefined) {
          list.push(clean(row));
          applied++;
          return;
        }
        var local = list[idx];
        if ((row.updatedAt || 0) <= (local.updatedAt || 0)) return;
        var merged = clean(Object.assign({}, local, row));
        merged.image = local.image;          // รูปใบเสร็จเก็บในเครื่องเท่านั้น ไม่ถูกทับ
        list[idx] = merged;
        applied++;
      });
      if (applied) write(list);
      return applied;
    },
    lastSync: {
      get: function () { try { return Number(localStorage.getItem(SYNC_KEY)) || 0; } catch (e) { return 0; } },
      set: function (ts) { try { localStorage.setItem(SYNC_KEY, String(ts)); } catch (e) {} }
    },
    onChange: function (fn) { listeners.push(fn); },

    budget: {
      get: function () {
        var b = null;
        try { b = JSON.parse(localStorage.getItem(BUDGET_KEY) || 'null'); } catch (e) { b = null; }
        if (!b || typeof b !== 'object') b = {};
        return {
          total: Number(b.total) > 0 ? Number(b.total) : 0,
          categories: (b.categories && typeof b.categories === 'object') ? b.categories : {},
          updatedAt: Number(b.updatedAt) || 0
        };
      },
      set: function (b, keepTimestamp) {
        var cats = {};
        Object.keys((b && b.categories) || {}).forEach(function (k) {
          var v = Number(b.categories[k]);
          if (v > 0) cats[k] = v;
        });
        try {
          localStorage.setItem(BUDGET_KEY, JSON.stringify({
            total: Number(b.total) > 0 ? Number(b.total) : 0,
            categories: cats,
            updatedAt: keepTimestamp && b.updatedAt ? Number(b.updatedAt) : Date.now()
          }));
          notify();
          return true;
        } catch (e) { return false; }
      }
    },

    theme: {
      get: function () { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } },
      set: function (v) { try { localStorage.setItem(THEME_KEY, v); } catch (e) {} }
    }
  };

  return api;
})();
