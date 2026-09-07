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

  /* ---------------- พื้นหลังของฉัน ----------------
     เก็บไว้ในเครื่องเท่านั้น (ไม่ซิงก์ขึ้นเซิร์ฟเวอร์ เหมือนรูปใบเสร็จ)
     รูปถูกย่อก่อนเก็บ เพราะ localStorage มีพื้นที่จำกัด */
  var BG_KEY = 'expense-book:bg:v1';
  var BG_PRESETS = [
    { id: 'none',   label: 'ค่าเริ่มต้น', swatch: 'linear-gradient(135deg,#efe9ff,#ffeede)' },
    { id: 'mint',   label: 'มินต์',      css: 'linear-gradient(160deg,#d8f3e6 0%,#eef7ff 55%,#fdf1e3 100%)', swatch: 'linear-gradient(135deg,#d8f3e6,#fdf1e3)' },
    { id: 'sunset', label: 'พระอาทิตย์', css: 'linear-gradient(160deg,#ffe3d3 0%,#ffd9e8 52%,#e7e2ff 100%)', swatch: 'linear-gradient(135deg,#ffe3d3,#e7e2ff)' },
    { id: 'sky',    label: 'ท้องฟ้า',    css: 'linear-gradient(160deg,#dbe9ff 0%,#e8e2ff 50%,#fde9f3 100%)', swatch: 'linear-gradient(135deg,#dbe9ff,#fde9f3)' },
    { id: 'matcha', label: 'ชาเขียว',    css: 'linear-gradient(160deg,#e6f0d4 0%,#f6f2df 55%,#e3f1ec 100%)', swatch: 'linear-gradient(135deg,#e6f0d4,#e3f1ec)' }
  ];
  var bgState = { kind: 'none', image: '', preset: '', dim: 62, blur: 3 };

  function loadBg() {
    try {
      var raw = localStorage.getItem(BG_KEY);
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          bgState.kind = v.kind === 'image' || v.kind === 'preset' ? v.kind : 'none';
          bgState.image = typeof v.image === 'string' ? v.image : '';
          bgState.preset = typeof v.preset === 'string' ? v.preset : '';
          bgState.dim = clampNum(v.dim, 0, 92, 62);
          bgState.blur = clampNum(v.blur, 0, 16, 3);
        }
      }
    } catch (e) { /* อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }
    applyBg();
  }
  function clampNum(v, lo, hi, dflt) {
    var n = Number(v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  function saveBg() {
    try {
      localStorage.setItem(BG_KEY, JSON.stringify(bgState));
      return true;
    } catch (e) { return false; }
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
  }

  /* ย่อรูปลงจนพอใส่ localStorage ได้ — ไล่ลดขนาด/คุณภาพทีละขั้น */
  function bgDataURL(img) {
    var sizes = [1600, 1280, 1024, 800];
    var quality = [0.72, 0.66, 0.6, 0.55];
    for (var i = 0; i < sizes.length; i++) {
      var url = resizeToDataURL(img, sizes[i], quality[i]);
      if (url.length < 1700000) return url;
    }
    return resizeToDataURL(img, 640, 0.5);
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
      (isImg
        ? '<div class="bg-sliders">' +
            '<label class="field"><span class="field-label">ความจางของรูป · ' + bgState.dim + '%</span>' +
              '<input type="range" min="0" max="92" step="2" data-bg="dim" value="' + bgState.dim + '"></label>' +
            '<label class="field"><span class="field-label">ความเบลอ · ' + bgState.blur + 'px</span>' +
              '<input type="range" min="0" max="16" step="1" data-bg="blur" value="' + bgState.blur + '"></label>' +
          '</div>'
        : '') +
      '<div class="row-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary btn-sm" data-bg="pick">🖼️ เลือกรูปจากเครื่อง</button>' +
        (bgState.kind !== 'none' ? '<button class="btn btn-ghost btn-sm" data-bg="clear">ใช้พื้นหลังเดิม</button>' : '') +
      '</div>';
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
    if (el.dataset.bg === 'dim') bgState.dim = clampNum(el.value, 0, 92, 62);
    if (el.dataset.bg === 'blur') bgState.blur = clampNum(el.value, 0, 16, 3);
    applyBg();
    var label = el.previousElementSibling;
    if (label) {
      label.textContent = el.dataset.bg === 'dim'
        ? 'ความจางของรูป · ' + bgState.dim + '%'
        : 'ความเบลอ · ' + bgState.blur + 'px';
    }
  });
  $('#bgModal').addEventListener('change', function (ev) {
    if (ev.target.tagName === 'INPUT' && ev.target.dataset.bg) saveBg();
  });
  $('#bgInput').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    toast('กำลังย่อรูป…');
    loadImage(file).then(function (img) {
      var prev = { kind: bgState.kind, image: bgState.image, preset: bgState.preset };
      bgState.kind = 'image';
      bgState.image = bgDataURL(img);
      if (!saveBg()) {
        bgState.kind = prev.kind; bgState.image = prev.image; bgState.preset = prev.preset;
        applyBg(); renderBgModal();
        toast('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — ลองลบรายการเก่าหรือใช้รูปที่เล็กลง');
        return;
      }
      applyBg(); renderBgModal();
      toast('เปลี่ยนพื้นหลังแล้ว 🎨');
    }).catch(function () { toast('เปิดไฟล์รูปไม่ได้'); });
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
      image: card.thumb || null
    });
    if (!res.result.ok) toast('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — บันทึกข้อมูลแล้วแต่ต้องลบรูปย่อบางส่วนออก');
    removeCard(card);
    renderBudgetAlert();
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
    else if (act === 'retry') { card.status = 'queued'; card.statusText = 'รออ่าน…'; renderCard(card); pump(); }
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
      .then(function (worker) { return readReceipt(worker, next, next.ocrSrc); })
      .then(function (parsed) {
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
    // เรียงรูปที่ถ่ายล่าสุดขึ้นก่อน (เว็บสั่งการเรียงในหน้าต่างเลือกรูปของเครื่องไม่ได้ แต่จัดลำดับหลังเลือกได้)
    images.sort(function (a, b) { return (b.lastModified || 0) - (a.lastModified || 0); });
    images.forEach(function (file) {
      var card = { status: 'queued', statusText: 'รออ่าน… (' + file.name + ')', fileName: file.name, thumb: null, ocrSrc: null, parsed: null };
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
               : '<span class="ecard-thumb is-cat" aria-hidden="true">' + ReceiptParser.categoryIcon(e.category) + '</span>') +
      '<div class="ecard-main">' +
        '<div class="ecard-title">' + esc(e.merchant) + '</div>' +
        '<div class="ecard-meta">' +
          '<span>' + esc(dateLabel(e.date)) + '</span>' +
          '<span class="tag"><span aria-hidden="true">' + ReceiptParser.categoryIcon(e.category) + '</span> ' +
            esc(ReceiptParser.categoryLabel(e.category)) + '</span>' +
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
      ExpenseStore.update(id, patch);
      renderList();
      renderBudgetAlert();
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

  function runSync(silent) {
    if (!CloudSync.isConfigured() || !CloudSync.user()) return;
    syncUI.busy = true;
    syncUI.error = '';
    renderSyncModal();
    CloudSync.syncNow().then(function (counts) {
      syncUI.busy = false;
      lastSyncFinished = Date.now();
      if (!counts || !counts.skipped) {
        syncUI.message = 'ซิงก์เรียบร้อย · รับมา ' + (counts.pulled || 0) + ' รายการ · ส่งขึ้น ' + (counts.pushed || 0) + ' รายการ';
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
    if (act === 'signout') {
      CloudSync.signOut().then(function () {
        syncUI.step = 'password';
        syncUI.message = 'ออกจากระบบแล้ว (ข้อมูลในเครื่องยังอยู่ครบ)';
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
    if (!$('#bgModal').hidden) closeBgModal();
    if (!$('#syncModal').hidden) closeSync();
    if (!$('#bookModal').hidden) closeBookModal();
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
  renderSyncBadge();
  ExpenseStore.onChange(function () { renderBookBar(); });
  if (CloudSync.isConfigured()) {
    var cameFromEmailLink = /access_token=|error_description=/.test(location.hash);
    CloudSync.init().then(function (session) {
      renderSyncBadge();
      if (cameFromEmailLink) {
        history.replaceState(null, '', location.pathname + location.search);   // ล้าง token ออกจาก URL
        if (session) toast('ล็อกอินสำเร็จ กำลังซิงก์ข้อมูล…');
      }
      if (session) runSync(true);
    }).catch(function () { /* ต่อเซิร์ฟเวอร์ไม่ได้ก็ใช้งานออฟไลน์ได้ตามปกติ */ });
  }
})();
