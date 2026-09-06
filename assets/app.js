/* สมุดเก็บรายจ่าย — อ่านใบเสร็จด้วย OCR แล้วบันทึกเป็นรายจ่าย */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
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
      return '<option value="' + c.key + '"' + (c.key === selected ? ' selected' : '') + '>' + esc(c.label) + '</option>';
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

  /* ---------------- แท็บ ---------------- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      ['add', 'summary', 'list'].forEach(function (name) {
        var panel = $('#panel-' + name);
        var on = name === tab.dataset.tab;
        panel.classList.toggle('is-active', on);
        panel.hidden = !on;
      });
      if (tab.dataset.tab === 'summary') renderSummary();
      if (tab.dataset.tab === 'list') renderList();
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
  function resizeToDataURL(img, maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
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

  function setProgress(card, ratio, label) {
    var bar = $('.progress > i', card.el);
    var status = $('.rcard-status span', card.el);
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
    if (status && label) status.textContent = label;
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
      '<div class="rcard-thumb">' + (card.thumb ? '<img src="' + card.thumb + '" alt="รูปใบเสร็จ">' : '📄') + '</div>' +
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
        (card.status === 'error' ? '<div class="row-actions">' +
          '<button class="btn btn-sm" data-act="retry">ลองอ่านใหม่</button>' +
          '<button class="btn btn-sm" data-act="manual">กรอกเอง</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="drop">ทิ้งใบนี้</button>' +
        '</div>' : '') +
      '</div>';
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
    var res = ExpenseStore.add({
      date: f.date || todayISO(),
      merchant: f.merchant,
      amount: amount,
      category: f.category,
      note: f.note,
      items: (card.parsed && card.parsed.items) || [],
      rawText: (card.parsed && card.parsed.text) || '',
      image: card.thumb || null
    });
    if (!res.result.ok) toast('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — บันทึกข้อมูลแล้วแต่ต้องลบรูปย่อบางส่วนออก');
    removeCard(card);
    return true;
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var cardEl = btn.closest('.rcard');
    if (!cardEl) return;
    var card = queue.filter(function (c) { return c.el === cardEl; })[0];
    if (!card) return;
    var act = btn.dataset.act;
    if (act === 'save') { if (saveCard(card)) toast('บันทึกรายจ่ายแล้ว'); }
    else if (act === 'drop') removeCard(card);
    else if (act === 'retry') { card.status = 'queued'; card.statusText = 'รออ่าน…'; renderCard(card); pump(); }
    else if (act === 'manual') {
      card.status = 'done';
      card.parsed = { date: todayISO(), merchant: '', amount: null, category: 'other', items: [], text: '', confident: false };
      renderCard(card);
    }
  });

  function addCard(card) {
    card.el = document.createElement('article');
    card.el.className = 'rcard';
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
      .then(function (worker) { return worker.recognize(next.ocrSrc); })
      .then(function (res) {
        var parsed = ReceiptParser.parse(res.data.text);
        if (!parsed.date) parsed.date = todayISO();
        next.parsed = parsed;
        next.status = 'done';
        next.statusText = parsed.amount != null
          ? 'อ่านใบเสร็จแล้ว — ตรวจสอบข้อมูลก่อนบันทึก'
          : 'อ่านข้อความได้ แต่หายอดเงินไม่เจอ';
        renderCard(next);
      })
      .catch(function (err) {
        next.status = 'error';
        next.statusText = 'อ่านไม่สำเร็จ: ' + (err && err.message ? err.message : 'ไม่ทราบสาเหตุ');
        renderCard(next);
      })
      .then(function () {
        activeCard = null;
        processing = false;
        next.ocrSrc = null;
        pump();
      });
  }

  function intake(files) {
    var images = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|bmp)$/i.test(f.name); });
    if (!images.length) { toast('กรุณาเลือกไฟล์รูปภาพ'); return; }
    images.forEach(function (file) {
      var card = { status: 'queued', statusText: 'รออ่าน… (' + file.name + ')', thumb: null, ocrSrc: null, parsed: null };
      addCard(card);
      loadImage(file).then(function (img) {
        card.thumb = resizeToDataURL(img, 360, 0.62);   // เก็บคู่กับรายการ
        card.ocrSrc = resizeToDataURL(img, 1600, 0.9);  // ส่งให้ OCR
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
    var saved = 0;
    ready.forEach(function (c) { if (saveCard(c, true)) saved++; });
    toast(saved ? 'บันทึกแล้ว ' + saved + ' รายการ' : 'ยังไม่มีรายการที่กรอกยอดเงินครบ');
  });
  $('#clearQueueBtn').addEventListener('click', function () {
    queue.slice().forEach(removeCard);
    $('#ocrStatus').textContent = '';
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

    // แยกตามหมวด
    var byCat = {};
    inMonth.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
    var rows = Object.keys(byCat).map(function (k) { return { key: k, label: ReceiptParser.categoryLabel(k), value: byCat[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var max = rows.length ? rows[0].value : 0;
    $('#catSub').textContent = rows.length ? 'ทั้งหมด ' + rows.length + ' หมวด · หน่วย: บาท' : '';
    $('#catChart').innerHTML = rows.length ? rows.map(function (r) {
      var pct = total ? Math.round(r.value / total * 100) : 0;
      return '<div class="bar-row">' +
        '<span class="bar-name" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (max ? Math.max(2, r.value / max * 100) : 0) + '%"></span></span>' +
        '<span class="bar-value">' + moneyShort.format(r.value) + '<span class="bar-pct">' + pct + '%</span></span>' +
      '</div>';
    }).join('') : '<p class="empty">ยังไม่มีรายจ่ายในเดือนนี้</p>';

    $('#sumTop').textContent = rows.length ? 'จ่ายมากสุด: ' + rows[0].label : '';

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
      return '<li><span>' + esc(m.name) + '</span><span class="muted">· ' + m.count + ' ครั้ง</span>' +
        '<span class="r-amount">' + fmtMoney(m.total) + '</span></li>';
    }).join('') : '<li class="muted">ยังไม่มีข้อมูล</li>';
  }

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
      (e.image ? '<img class="ecard-thumb" src="' + e.image + '" alt="ใบเสร็จ ' + esc(e.merchant) + '">'
               : '<span class="ecard-thumb" aria-hidden="true">🧾</span>') +
      '<div class="ecard-main">' +
        '<div class="ecard-title">' + esc(e.merchant) + '</div>' +
        '<div class="ecard-meta">' +
          '<span>' + esc(dateLabel(e.date)) + '</span>' +
          '<span class="tag">' + esc(ReceiptParser.categoryLabel(e.category)) + '</span>' +
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
        CATS.map(function (c) { return '<option value="' + c.key + '">' + esc(c.label) + '</option>'; }).join('');
    }
    fillMonthSelect($('#fMonth'), { allOption: true });

    var list = filtered();
    $('#listSummary').textContent = list.length
      ? list.length + ' รายการ · รวม ' + fmtMoney(sumOf(list))
      : 'ไม่พบรายการ';
    $('#expenseList').innerHTML = list.length
      ? list.map(expenseCard).join('')
      : '<p class="empty">ยังไม่มีรายจ่ายที่ตรงกับเงื่อนไข — ลองอัปโหลดใบเสร็จในแท็บ “เพิ่มรายจ่าย”</p>';
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
      ExpenseStore.update(id, patch);
      renderList();
      toast('แก้ไขเรียบร้อย');
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

  $('#csvBtn').addEventListener('click', function () {
    var list = filtered();
    if (!list.length) { toast('ไม่มีรายการให้ส่งออก'); return; }
    var head = ['วันที่', 'ร้าน/ผู้ขาย', 'หมวด', 'จำนวนเงิน', 'บันทึกช่วยจำ'];
    var rows = list.map(function (e) {
      return [e.date, e.merchant, ReceiptParser.categoryLabel(e.category), (Number(e.amount) || 0).toFixed(2), e.note];
    });
    var csv = [head].concat(rows).map(function (r) {
      return r.map(function (cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    download('expenses-' + todayISO() + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
    toast('ดาวน์โหลด CSV แล้ว (' + list.length + ' รายการ)');
  });

  $('#backupBtn').addEventListener('click', function () {
    var data = { version: 1, exportedAt: new Date().toISOString(), expenses: ExpenseStore.all() };
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
        renderList();
        toast('กู้คืนข้อมูลแล้ว');
      } catch (err) {
        toast('อ่านไฟล์สำรองไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  /* ---------------- เริ่มต้น ---------------- */
  renderQueueHead();
  renderList();
})();
