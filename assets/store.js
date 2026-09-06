/* เก็บรายจ่ายไว้ใน localStorage ของเครื่อง แยกเป็น "สมุด" ได้หลายเล่ม และเตรียมข้อมูลให้ซิงก์ขึ้น Supabase ได้ */
window.ExpenseStore = (function () {
  'use strict';

  var KEY = 'expense-book:v1';
  var THEME_KEY = 'expense-book:theme';
  var BUDGET_KEY = 'expense-book:budget:v1';
  var BOOKS_KEY = 'expense-book:books:v1';
  var CURRENT_KEY = 'expense-book:currentBook';
  var SYNC_KEY = 'expense-book:lastSync';
  var DIRTY_KEY = 'expense-book:dirty';
  var DEFAULT_BOOK = 'b_default';

  var cache = null;
  var booksCache = null;
  var listeners = [];

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function newId(prefix) {
    return (prefix || 'e') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- สมุด ---------- */
  function readBooks() {
    if (booksCache) return booksCache;
    var list = readJSON(BOOKS_KEY, null);
    if (!Array.isArray(list) || !list.length) {
      list = [{ id: DEFAULT_BOOK, name: 'สมุดของฉัน', deleted: false, createdAt: Date.now(), updatedAt: Date.now() }];
      writeJSON(BOOKS_KEY, list);
      markBookDirty(DEFAULT_BOOK);      // ให้สมุดเริ่มต้นถูกส่งขึ้นเซิร์ฟเวอร์ด้วย
    }
    booksCache = list;
    return booksCache;
  }

  function writeBooks(list) {
    booksCache = list;
    writeJSON(BOOKS_KEY, list);
    notify();
  }

  function activeBooks() {
    return readBooks().filter(function (b) { return !b.deleted; });
  }

  function currentBookId() {
    var id = null;
    try { id = localStorage.getItem(CURRENT_KEY); } catch (e) {}
    var books = activeBooks();
    var found = books.filter(function (b) { return b.id === id; })[0];
    if (found) return found.id;
    var first = books[0] ? books[0].id : DEFAULT_BOOK;
    try { localStorage.setItem(CURRENT_KEY, first); } catch (e) {}
    return first;
  }

  /* ---------- รายจ่าย ---------- */
  function read() {
    if (cache) return cache;
    var list = readJSON(KEY, []);
    if (!Array.isArray(list)) list = [];
    cache = list.map(function (e) {
      if (!e.bookId) e.bookId = DEFAULT_BOOK;      // ข้อมูลเดิมก่อนมีหลายสมุด อยู่ในสมุดแรก
      return e;
    });
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

  function sortByDateDesc(list) {
    return list.slice().sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });
  }

  /* ---------- จำว่าอะไรแก้ในเครื่องแล้วยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ ---------- */
  function readDirty() {
    var d = readJSON(DIRTY_KEY, {});
    return { ids: (d && d.ids) || {}, books: (d && d.books) || {}, budgets: (d && d.budgets) || {} };
  }

  function markDirty(id) {
    var d = readDirty();
    d.ids[id] = 1;
    writeJSON(DIRTY_KEY, d);
  }

  function markBookDirty(id) {
    var d = readDirty();
    d.books[id] = 1;
    writeJSON(DIRTY_KEY, d);
  }

  function markBudgetDirty(bookId) {
    var d = readDirty();
    d.budgets[bookId] = 1;
    writeJSON(DIRTY_KEY, d);
  }

  function clean(exp) {
    var created = exp.createdAt || Date.now();
    return {
      id: exp.id || newId('e'),
      bookId: exp.bookId || DEFAULT_BOOK,
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

  /* ---------- งบประมาณ (แยกตามสมุด) ---------- */
  function readBudgets() {
    var raw = readJSON(BUDGET_KEY, null);
    if (raw && raw.books) return raw.books;
    var books = {};
    if (raw && (raw.total || raw.categories)) {        // รูปแบบเดิมก่อนมีหลายสมุด
      books[DEFAULT_BOOK] = {
        total: Number(raw.total) || 0,
        categories: raw.categories || {},
        updatedAt: Number(raw.updatedAt) || Date.now()
      };
      writeJSON(BUDGET_KEY, { books: books });
    }
    return books;
  }

  function writeBudgets(books) {
    writeJSON(BUDGET_KEY, { books: books });
    notify();
  }

  function emptyBudget() { return { total: 0, categories: {}, updatedAt: 0 }; }

  var api = {
    DEFAULT_BOOK: DEFAULT_BOOK,

    /* ---------- สมุด ---------- */
    books: activeBooks,
    allBooks: function () { return readBooks().slice(); },
    currentBook: currentBookId,
    currentBookName: function () {
      var id = currentBookId();
      var found = activeBooks().filter(function (b) { return b.id === id; })[0];
      return found ? found.name : 'สมุดของฉัน';
    },
    setCurrentBook: function (id) {
      try { localStorage.setItem(CURRENT_KEY, id); } catch (e) {}
      notify();
    },
    addBook: function (name) {
      var list = readBooks().slice();
      var book = {
        id: newId('b'),
        name: (name || '').trim() || 'สมุดใหม่',
        deleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      list.push(book);
      writeBooks(list);
      markBookDirty(book.id);
      return book;
    },
    renameBook: function (id, name) {
      var list = readBooks().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].name = (name || '').trim() || list[i].name;
          list[i].updatedAt = Date.now();
          markBookDirty(id);
          break;
        }
      }
      writeBooks(list);
    },
    /* ลบสมุดพร้อมรายการในสมุดนั้น (ทิ้งร่องรอยไว้เพื่อให้ซิงก์การลบไปเครื่องอื่น) */
    removeBook: function (id) {
      if (activeBooks().length <= 1) return { ok: false, reason: 'last' };
      var list = readBooks().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].deleted = true;
          list[i].updatedAt = Date.now();
          markBookDirty(id);
          break;
        }
      }
      writeBooks(list);

      var expenses = read().slice();
      var now = Date.now();
      expenses.forEach(function (e) {
        if (e.bookId === id && !e.deleted) {
          e.deleted = true;
          e.image = null;
          e.updatedAt = now;
          markDirty(e.id);
        }
      });
      write(expenses);

      var budgets = readBudgets();
      if (budgets[id]) { delete budgets[id]; writeBudgets(budgets); }

      if (currentBookId() === id) api.setCurrentBook(activeBooks()[0].id);
      return { ok: true };
    },
    countInBook: function (id) {
      return read().filter(function (e) { return e.bookId === id && !e.deleted; }).length;
    },

    /* ---------- รายจ่ายในสมุดที่เปิดอยู่ ---------- */
    all: function () {
      var book = currentBookId();
      return sortByDateDesc(read().filter(function (e) { return !e.deleted && e.bookId === book; }));
    },
    allWithDeleted: function () { return read().slice(); },
    get: function (id) {
      var list = read();
      for (var i = 0; i < list.length; i++) if (list[i].id === id && !list[i].deleted) return list[i];
      return null;
    },
    add: function (exp) {
      var list = read().slice();
      var rec = clean(exp);
      if (!exp.bookId) rec.bookId = currentBookId();
      rec.updatedAt = Date.now();
      list.push(rec);
      markDirty(rec.id);
      return { record: rec, result: write(list) };
    },
    update: function (id, patch) {
      var list = read().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          var bookId = list[i].bookId;
          list[i] = clean(Object.assign({}, list[i], patch, { id: id, bookId: patch.bookId || bookId }));
          list[i].updatedAt = Date.now();
          markDirty(id);
          break;
        }
      }
      return write(list);
    },
    remove: function (id) {
      var list = read().slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].deleted = true;
          list[i].image = null;
          list[i].updatedAt = Date.now();
          markDirty(id);
          break;
        }
      }
      return write(list);
    },
    replaceAll: function (list) {
      var now = Date.now();
      var book = currentBookId();
      var cleaned = (list || []).filter(function (e) { return e && e.date && e.amount; }).map(function (e) {
        var rec = clean(e);
        if (!e.bookId) rec.bookId = book;
        rec.updatedAt = now;
        markDirty(rec.id);
        return rec;
      });
      return write(cleaned);
    },

    /* ---------- ส่วนที่ใช้ตอนซิงก์ (ครอบคลุมทุกสมุด) ---------- */
    pendingRecords: function () {
      var dirty = readDirty().ids;
      return read().filter(function (e) { return dirty[e.id]; });
    },
    clearPending: function (ids) {
      var d = readDirty();
      (ids || []).forEach(function (id) { delete d.ids[id]; });
      writeJSON(DIRTY_KEY, d);
    },
    pendingBooks: function () {
      var dirty = readDirty().books;
      return readBooks().filter(function (b) { return dirty[b.id]; });
    },
    clearPendingBooks: function (ids) {
      var d = readDirty();
      (ids || []).forEach(function (id) { delete d.books[id]; });
      writeJSON(DIRTY_KEY, d);
    },
    pendingBudgets: function () {
      var dirty = readDirty().budgets;
      var budgets = readBudgets();
      return Object.keys(dirty).map(function (bookId) {
        return { bookId: bookId, budget: budgets[bookId] || emptyBudget() };
      });
    },
    clearPendingBudgets: function (bookIds) {
      var d = readDirty();
      (bookIds || []).forEach(function (id) { delete d.budgets[id]; });
      writeJSON(DIRTY_KEY, d);
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
    mergeRemoteBooks: function (rows) {
      var list = readBooks().slice();
      var byId = {};
      list.forEach(function (b, i) { byId[b.id] = i; });
      var applied = 0;
      (rows || []).forEach(function (row) {
        var idx = byId[row.id];
        if (idx === undefined) { list.push(row); applied++; return; }
        if ((row.updatedAt || 0) <= (list[idx].updatedAt || 0)) return;
        list[idx] = row;
        applied++;
      });
      if (applied) writeBooks(list);
      return applied;
    },
    lastSync: {
      get: function () { try { return Number(localStorage.getItem(SYNC_KEY)) || 0; } catch (e) { return 0; } },
      set: function (ts) { try { localStorage.setItem(SYNC_KEY, String(ts)); } catch (e) {} }
    },
    onChange: function (fn) { listeners.push(fn); },

    /* ---------- งบประมาณของสมุดที่เปิดอยู่ ---------- */
    budget: {
      get: function (bookId) {
        var budgets = readBudgets();
        var b = budgets[bookId || currentBookId()] || emptyBudget();
        return {
          total: Number(b.total) > 0 ? Number(b.total) : 0,
          categories: (b.categories && typeof b.categories === 'object') ? b.categories : {},
          updatedAt: Number(b.updatedAt) || 0
        };
      },
      set: function (b, keepTimestamp, bookId) {
        var id = bookId || currentBookId();
        var cats = {};
        Object.keys((b && b.categories) || {}).forEach(function (k) {
          var v = Number(b.categories[k]);
          if (v > 0) cats[k] = v;
        });
        var budgets = readBudgets();
        budgets[id] = {
          total: Number(b.total) > 0 ? Number(b.total) : 0,
          categories: cats,
          updatedAt: keepTimestamp && b.updatedAt ? Number(b.updatedAt) : Date.now()
        };
        writeBudgets(budgets);
        if (!keepTimestamp) markBudgetDirty(id);
        return true;
      }
    },

    theme: {
      get: function () { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } },
      set: function (v) { try { localStorage.setItem(THEME_KEY, v); } catch (e) {} }
    }
  };

  return api;
})();
