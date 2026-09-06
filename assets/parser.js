/* แปลงข้อความที่ OCR อ่านได้จากใบเสร็จ ให้เป็นข้อมูลรายจ่าย (วันที่ / ร้าน / ยอดเงิน / หมวด) */
window.ReceiptParser = (function () {
  'use strict';

  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

  var CATEGORIES = [
    { key: 'food',      label: 'อาหาร & เครื่องดื่ม', words: ['ร้านอาหาร','อาหาร','ก๋วยเตี๋ยว','ข้าว','กาแฟ','คาเฟ่','ชานม','เบเกอรี่','ขนม','ครัว','สุกี้','ชาบู','หมูกระทะ','บุฟเฟ่ต์','restaurant','cafe','coffee','starbucks','amazon cafe','kfc','mcdonald','pizza','bakery','bar','food'] },
    { key: 'grocery',   label: 'ของใช้ & ซูเปอร์',    words: ['เซเว่น','7-eleven','7 eleven','เทสโก้','โลตัส','บิ๊กซี','แม็คโคร','ท็อปส์','วิลล่า','ซุปเปอร์','ซูเปอร์','ตลาด','lotus','big c','bigc','makro','tops','villa','cp fresh','supermarket','mini mart','family mart'] },
    { key: 'transport', label: 'เดินทาง',            words: ['แท็กซี่','วิน','รถไฟฟ้า','ค่าโดยสาร','น้ำมัน','ปตท','บางจาก','เชลล์','เอสโซ่','คาลเท็กซ์','ทางด่วน','ที่จอดรถ','grab','bolt','taxi','ptt','shell','esso','caltex','bts','mrt','parking','fuel','petrol'] },
    { key: 'bills',     label: 'บิล & ค่าบริการ',     words: ['ค่าไฟ','ค่าน้ำ','ค่าเน็ต','อินเทอร์เน็ต','ค่าโทรศัพท์','ค่าเช่า','ประกัน','การไฟฟ้า','การประปา','ทรู','เอไอเอส','ดีแทค','true','ais','dtac','3bb','internet','electric','water bill','insurance','rent'] },
    { key: 'health',    label: 'สุขภาพ',             words: ['โรงพยาบาล','คลินิก','ร้านยา','เภสัช','ทันตกรรม','หมอ','ยา','hospital','clinic','pharmacy','dental','watsons','boots','fascino'] },
    { key: 'shopping',  label: 'ช้อปปิ้ง',            words: ['เสื้อผ้า','รองเท้า','เครื่องสำอาง','ห้าง','ลาซาด้า','ช้อปปี้','lazada','shopee','uniqlo','h&m','zara','muji','ikea','central','robinson','power buy','jd central'] },
    { key: 'fun',       label: 'บันเทิง & อื่นๆ',      words: ['โรงหนัง','หนัง','เกม','คาราโอเกะ','ท่องเที่ยว','โรงแรม','major','sf cinema','netflix','spotify','youtube premium','steam','hotel','cinema'] }
  ];
  var OTHER = { key: 'other', label: 'ไม่ระบุหมวด' };

  /* น้ำหนักของคำที่บอกว่า "บรรทัดนี้คือยอดที่ต้องจ่าย" — มากคือน่าเชื่อถือกว่า */
  var TOTAL_HINTS = [
    { re: /(รวมทั้งสิ้น|ยอดสุทธิ|รวมสุทธิ|สุทธิ|ยอดชำระ|grand\s*total|net\s*total|net\s*amount|amount\s*due|total\s*due|balance\s*due)/i, w: 100 },
    { re: /(ยอดรวม|รวมเงิน|รวมทั้งหมด|จำนวนเงิน|^\s*รวม|\btotal\b)/i, w: 80 },
    { re: /(ราคารวม|รวมย่อย|sub\s*-?\s*total)/i, w: 60 },
    { re: /(เงินสด|รับเงิน|ชำระโดย|บัตรเครดิต|พร้อมเพย์|โอนเงิน|\bcash\b|\bcard\b|credit|payment|paid|promptpay|qr)/i, w: 45 }
  ];
  /* บรรทัดที่ไม่ใช่ยอดที่จ่ายจริง */
  var TOTAL_BLOCK = /(ภาษีมูลค่าเพิ่ม|ภาษี|vat|เลขประจำตัวผู้เสียภาษี|tax\s*id|เงินทอน|ทอน|change|ส่วนลด|discount|คะแนน|point|สะสม|โทร|tel|เลขที่|no\.|ต่อหน่วย|unit\s*price|ราคา\/หน่วย)/i;

  var MONTHS_TH = ['ม.ค','ก.พ','มี.ค','เม.ย','พ.ค','มิ.ย','ก.ค','ส.ค','ก.ย','ต.ค','พ.ย','ธ.ค'];
  var MONTHS_TH_FULL = ['มกรา','กุมภา','มีนา','เมษา','พฤษภา','มิถุนา','กรกฎา','สิงหา','กันยา','ตุลา','พฤศจิกา','ธันวา'];
  var MONTHS_EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  function toArabicDigits(s) {
    return String(s).replace(/[๐-๙]/g, function (d) { return String(THAI_DIGITS.indexOf(d)); });
  }

  /* Tesseract มักแยกอักษรไทยออกจากกันเป็น "ย อ ด ร ว ม" — เชื่อมกลับเมื่อบรรทัดนั้นถูกซอยเป็นชิ้นสั้นๆ */
  function joinBrokenThai(line) {
    var tokens = line.split(' ').filter(function (t) { return t.length > 0; });
    var thai = tokens.filter(function (t) { return /[\u0E00-\u0E7F]/.test(t); });
    if (thai.length < 3) return line;
    var short = thai.filter(function (t) { return t.replace(/[\u0E30-\u0E3A\u0E47-\u0E4E]/g, '').length <= 2; }).length;
    if (short / thai.length < 0.6) return line;
    return line.replace(/([\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/g, '$1');
  }

  function normalizeText(raw) {
    return toArabicDigits(raw || '')
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .split('\n')
      .map(function (l) { return joinBrokenThai(l.trim()); })
      .filter(function (l) { return l.length > 0; })
      .join('\n');
  }

  function toNumber(str) {
    if (!str) return null;
    var s = String(str).replace(/[^\d.,-]/g, '');
    // 1.234,50 (คั่นหลักพันด้วยจุด) -> 1234.50
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ตัวเลขที่หน้าตาเหมือนจำนวนเงินในบรรทัดหนึ่ง */
  function moneyIn(line) {
    var out = [];
    var re = /-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g;
    var m;
    while ((m = re.exec(line)) !== null) {
      var v = toNumber(m[0]);
      if (v === null || v <= 0 || v > 10000000) continue;
      out.push({ value: v, text: m[0], hasDecimals: /[.,]\d{2}\b/.test(m[0]) });
    }
    return out;
  }

  function findAmount(lines) {
    var best = null;
    lines.forEach(function (line, i) {
      if (TOTAL_BLOCK.test(line) && !/รวมทั้งสิ้น|ยอดสุทธิ|grand\s*total/i.test(line)) return;
      var hint = null;
      for (var h = 0; h < TOTAL_HINTS.length; h++) {
        if (TOTAL_HINTS[h].re.test(line)) { hint = TOTAL_HINTS[h]; break; }
      }
      if (!hint) return;
      var nums = moneyIn(line);
      // บางใบเสร็จขึ้นบรรทัดใหม่ก่อนตัวเลข
      if (!nums.length && lines[i + 1] && !TOTAL_BLOCK.test(lines[i + 1])) nums = moneyIn(lines[i + 1]);
      if (!nums.length) return;
      var pick = nums[nums.length - 1];
      var score = hint.w + (pick.hasDecimals ? 6 : 0) + i * 0.1;
      if (!best || score > best.score) best = { value: pick.value, score: score, line: line };
    });
    if (best) return { amount: best.value, amountSource: best.line, confident: best.score >= 60 };

    // ไม่พบคำใบ้ — เดาจากตัวเลขที่มีทศนิยมและมีค่ามากที่สุดในครึ่งล่างของใบเสร็จ
    var start = Math.floor(lines.length * 0.35);
    var fallback = null;
    for (var i = start; i < lines.length; i++) {
      if (TOTAL_BLOCK.test(lines[i])) continue;
      moneyIn(lines[i]).forEach(function (n) {
        if (n.hasDecimals && (!fallback || n.value > fallback.value)) fallback = { value: n.value, line: lines[i] };
      });
    }
    if (fallback) return { amount: fallback.value, amountSource: fallback.line, confident: false };
    return { amount: null, amountSource: '', confident: false };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function makeDate(y, m, d) {
    if (y > 2400) y -= 543;              // พ.ศ. -> ค.ศ.
    else if (y < 100) y += (y > 70 ? 1900 : 2000);
    if (y < 1990 || y > 2100) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function monthIndexFromName(name) {
    var s = String(name).toLowerCase().replace(/[.\s]/g, '');
    for (var i = 0; i < MONTHS_TH.length; i++) {
      if (s.indexOf(MONTHS_TH[i].replace(/\./g, '')) === 0) return i + 1;
      if (s.indexOf(MONTHS_TH_FULL[i]) === 0) return i + 1;
      if (s.indexOf(MONTHS_EN[i]) === 0) return i + 1;
    }
    return 0;
  }

  function findDate(text) {
    var m;
    // 31/12/2567, 31-12-24, 31.12.2024
    var re1 = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
    while ((m = re1.exec(text)) !== null) {
      var d = makeDate(+m[3], +m[2], +m[1]);
      if (d) return d;
    }
    // 2024-12-31
    var re2 = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = re2.exec(text)) !== null) {
      var d2 = makeDate(+m[1], +m[2], +m[3]);
      if (d2) return d2;
    }
    // 31 ธ.ค. 2567 / 31 Dec 2024
    var re3 = /\b(\d{1,2})\s*([ก-๙.]{2,12}|[A-Za-z]{3,9})\.?\s*(\d{2,4})\b/g;
    while ((m = re3.exec(text)) !== null) {
      var mi = monthIndexFromName(m[2]);
      if (!mi) continue;
      var d3 = makeDate(+m[3], mi, +m[1]);
      if (d3) return d3;
    }
    return null;
  }

  function findMerchant(lines) {
    var skip = /(ใบเสร็จ|ใบกำกับ|ใบรับเงิน|receipt|invoice|tax\s*invoice|สาขา|โทร|tel|เลขที่|เลขประจำตัว|tax\s*id|วันที่|date|time|www\.|http|@|ขอบคุณ|thank)/i;
    var candidates = [];
    lines.slice(0, 7).forEach(function (line, i) {
      if (skip.test(line)) return;
      if (/\d{3,}/.test(line) || /\d+[.,]\d{2}\b/.test(line)) return; // บรรทัดที่มีราคา/รหัส ไม่ใช่ชื่อร้าน
      var letters = line.replace(/[^ก-๙A-Za-z]/g, '');
      if (letters.length < 3 || letters.length / line.length < 0.4) return;
      candidates.push({ line: line, letters: letters.length, index: i });
    });
    if (!candidates.length) return '';
    // ชื่อร้านมักอยู่บรรทัดบนสุดที่ยาวพอจะเป็นชื่อจริง
    var named = candidates.filter(function (c) { return c.letters >= 4; });
    var pick = (named.length ? named : candidates)[0];
    return pick.line.replace(/\s+/g, ' ').slice(0, 60);
  }

  function guessCategory(text) {
    var hay = text.toLowerCase();
    var best = null;
    CATEGORIES.forEach(function (cat) {
      var hits = 0;
      cat.words.forEach(function (w) { if (hay.indexOf(w.toLowerCase()) !== -1) hits++; });
      if (hits && (!best || hits > best.hits)) best = { key: cat.key, hits: hits };
    });
    return best ? best.key : OTHER.key;
  }

  function findItems(lines) {
    var items = [];
    lines.forEach(function (line) {
      if (TOTAL_BLOCK.test(line)) return;
      for (var h = 0; h < TOTAL_HINTS.length; h++) if (TOTAL_HINTS[h].re.test(line)) return;
      var m = line.match(/^(.{2,40}?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})$/);
      if (!m) return;
      var name = m[1].replace(/\s+x?\s*\d+\s*$/, '').trim();
      if (name.replace(/[^ก-๙A-Za-z]/g, '').length < 2) return;
      var price = toNumber(m[2]);
      if (price === null || price <= 0) return;
      items.push({ name: name, price: price });
    });
    return items.slice(0, 40);
  }

  function parse(rawText) {
    var text = normalizeText(rawText);
    var lines = text ? text.split('\n') : [];
    var amountInfo = findAmount(lines);
    return {
      text: text,
      date: findDate(text),
      merchant: findMerchant(lines),
      amount: amountInfo.amount,
      amountSource: amountInfo.amountSource,
      confident: amountInfo.confident,
      category: guessCategory(text),
      items: findItems(lines)
    };
  }

  return {
    parse: parse,
    categories: CATEGORIES.concat([OTHER]),
    categoryLabel: function (key) {
      var all = CATEGORIES.concat([OTHER]);
      for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i].label;
      return OTHER.label;
    },
    toNumber: toNumber,
    normalizeText: normalizeText
  };
})();
