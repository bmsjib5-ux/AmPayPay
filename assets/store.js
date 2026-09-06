/* เก็บรายจ่ายไว้ใน localStorage ของเครื่องผู้ใช้เอง */
window.ExpenseStore = (function () {
  'use strict';

  var KEY = 'expense-book:v1';
  var THEME_KEY = 'expense-book:theme';
  var BUDGET_KEY = 'expense-book:budget:v1';
  var cache = null;

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
        return { ok: true, droppedImages: attempt };
      } catch (e) {
        var victim = null;
        for (var i = list.length - 1; i >= 0; i--) {
          if (list[i].image) { victim = list[i]; break; }
        }
        if (!victim) return { ok: false, droppedImages: attempt };
        victim.image = null;
      }
    }
    return { ok: false, droppedImages: 30 };
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
      createdAt: exp.createdAt || Date.now()
    };
  }

  return {
    all: function () { return sortByDateDesc(read()); },
    get: function (id) {
      var list = read();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    add: function (exp) {
      var list = read().slice();
      var rec = clean(exp);
      list.push(rec);
      var res = write(list);
      return { record: rec, result: res };
    },
    update: function (id, patch) {
      var list = read().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i] = clean(Object.assign({}, list[i], patch, { id: id }));
          break;
        }
      }
      return write(list);
    },
    remove: function (id) {
      var list = read().filter(function (e) { return e.id !== id; });
      return write(list);
    },
    replaceAll: function (list) {
      var cleaned = (list || []).filter(function (e) { return e && e.date && e.amount; }).map(clean);
      return write(cleaned);
    },
    budget: {
      get: function () {
        var b = null;
        try { b = JSON.parse(localStorage.getItem(BUDGET_KEY) || 'null'); } catch (e) { b = null; }
        if (!b || typeof b !== 'object') b = {};
        return {
          total: Number(b.total) > 0 ? Number(b.total) : 0,
          categories: (b.categories && typeof b.categories === 'object') ? b.categories : {}
        };
      },
      set: function (b) {
        var cats = {};
        Object.keys((b && b.categories) || {}).forEach(function (k) {
          var v = Number(b.categories[k]);
          if (v > 0) cats[k] = v;
        });
        try {
          localStorage.setItem(BUDGET_KEY, JSON.stringify({ total: Number(b.total) > 0 ? Number(b.total) : 0, categories: cats }));
          return true;
        } catch (e) { return false; }
      }
    },
    theme: {
      get: function () { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } },
      set: function (v) { try { localStorage.setItem(THEME_KEY, v); } catch (e) {} }
    }
  };
})();
