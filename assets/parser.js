/* แปลงข้อความที่ OCR อ่านได้จากใบเสร็จ/สลิปโอนเงิน ให้เป็นข้อมูลรายจ่าย */
window.ReceiptParser = (function () {
  'use strict';

  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

  var CATEGORIES = [
    { key: 'food',      label: 'อาหาร & เครื่องดื่ม', words: ['ร้านอาหาร','อาหาร','ค่าอาหาร','กับข้าว','ก๋วยเตี๋ยว','ข้าว','กาแฟ','คาเฟ่','ชานม','เบเกอรี่','ขนม','ครัว','สุกี้','ชาบู','หมูกระทะ','บุฟเฟ่ต์','restaurant','cafe','coffee','starbucks','kfc','mcdonald','pizza','bakery','food'] },
    { key: 'grocery',   label: 'ของใช้ & ซูเปอร์',    words: ['เซเว่น','7-eleven','7 eleven','เทสโก้','โลตัส','บิ๊กซี','แม็คโคร','ท็อปส์','วิลล่า','ซุปเปอร์','ซูเปอร์','ตลาด','lotus','big c','bigc','makro','tops','villa','supermarket','mini mart','family mart'] },
    { key: 'transport', label: 'เดินทาง',            words: ['แท็กซี่','ค่ารถ','ค่าโดยสาร','วินมอเตอร์ไซค์','รถไฟฟ้า','น้ำมัน','ปตท','บางจาก','เชลล์','เอสโซ่','คาลเท็กซ์','ทางด่วน','ที่จอดรถ','grab','bolt','taxi','ptt','shell','esso','caltex','bts','mrt','parking','fuel','petrol'] },
    { key: 'bills',     label: 'บิล & ค่าบริการ',     words: ['ค่าไฟ','ค่าน้ำ','ค่าเน็ต','อินเทอร์เน็ต','ค่าโทรศัพท์','ค่าเช่า','ค่าห้อง','ค่าส่วนกลาง','ประกัน','การไฟฟ้า','การประปา','ทรู','เอไอเอส','ดีแทค','true','ais','dtac','3bb','internet','electric','water bill','insurance','rent'] },
    { key: 'health',    label: 'สุขภาพ',             words: ['โรงพยาบาล','คลินิก','ร้านยา','เภสัช','ทันตกรรม','ค่ายา','hospital','clinic','pharmacy','dental','watsons','boots','fascino'] },
    { key: 'shopping',  label: 'ช้อปปิ้ง',            words: ['เสื้อผ้า','รองเท้า','เครื่องสำอาง','ลาซาด้า','ช้อปปี้','lazada','shopee','uniqlo','h&m','zara','muji','ikea','central','robinson','power buy'] },
    { key: 'fun',       label: 'บันเทิง & อื่นๆ',      words: ['โรงหนัง','ค่าหนัง','เกม','คาราโอเกะ','ท่องเที่ยว','โรงแรม','major','sf cinema','netflix','spotify','steam','hotel','cinema'] }
  ];
  var OTHER = { key: 'other', label: 'ไม่ระบุหมวด' };

  /* คำที่บอกว่าบรรทัดนี้คือ "ยอดที่ต้องจ่าย" — ค่ามากคือน่าเชื่อถือกว่า */
  var TOTAL_HINTS = [
    { re: /(รวมทั้งสิ้น|ยอดสุทธิ|รวมสุทธิ|สุทธิ|ยอดชำระ|grand\s*total|net\s*total|net\s*amount|amount\s*due|total\s*due|balance\s*due)/i, w: 100 },
    { re: /(จำนวนเงิน|ยอดเงิน|ยอดโอน|เงินที่โอน)/i, w: 90 },
    { re: /(ยอดรวม|รวมเงิน|รวมทั้งหมด|^\s*รวม|\btotal\b|\bamount\b)/i, w: 80 },
    { re: /(ราคารวม|รวมย่อย|sub\s*-?\s*total)/i, w: 60 },
    { re: /(เงินสด|รับเงิน|ชำระโดย|บัตรเครดิต|พร้อมเพย์|โอนเงิน|\bcash\b|\bcard\b|credit|payment|paid|promptpay|qr)/i, w: 45 }
  ];
  /* บรรทัดที่ไม่ใช่ยอดที่จ่ายจริง */
  var TOTAL_BLOCK = /(ภาษีมูลค่าเพิ่ม|ภาษี|vat|เลขประจำตัวผู้เสียภาษี|tax\s*id|เงินทอน|ทอน|change|ส่วนลด|discount|คะแนน|point|สะสม|ค่าธรรมเนียม|ค่าบริการธนาคาร|fee|ยอดคงเหลือ|คงเหลือ|balance|รหัสอ้างอิง|เลขที่อ้างอิง|หมายเลขอ้างอิง|เลขที่รายการ|reference|ref\s*no|เลขที่บัญชี|บัญชี|account|โทร|tel|เลขที่|no\.|ต่อหน่วย|unit\s*price)/i;

  /* สลิปโอนเงินจากแอปธนาคาร มีโครงสร้างต่างจากใบเสร็จร้านค้า */
  var SLIP_RE = /(โอนเงินสำเร็จ|โอนสำเร็จ|ทำรายการสำเร็จ|สลิป|พร้อมเพย์|promptpay|transfer\s*(success|complete)|รหัสอ้างอิง|เลขที่รายการ)/i;
  var TO_RE = /(โอนไปยัง|โอนไปที่|ไปยังบัญชี|ไปยัง|ไปที่|ผู้รับเงิน|ผู้รับโอน|ผู้รับ|ชื่อผู้รับ|ชื่อบัญชีปลายทาง|บัญชีปลายทาง|จ่ายให้|ชำระให้|ชื่อร้านค้า|ร้านค้า|ผู้ขาย|merchant|payee|to\s*account|\bto\b)\s*[:：]?\s*(.*)$/i;
  var FROM_RE = /^(จาก|ผู้โอน|ชื่อผู้โอน|บัญชีต้นทาง|from)\s*[:：]?/i;
  var NOTE_RE = /(บันทึกช่วยจำ|หมายเหตุ|บันทึกช่วยจา|memo|remark|note)\s*[:：]?\s*(.*)$/i;
  var DATE_LABEL_RE = /(วันที่ทำรายการ|วันเวลาทำรายการ|เวลาทำรายการ|วันที่โอน|วันที่ชำระ|วันที่ออก|วันที่รับเงิน|วันที่|วัน\/เวลา|transaction\s*date|date\s*\/?\s*time|\bdate\b)/i;
  var BANK_RE = /(ธนาคาร|กรุงไทย|กสิกร|ไทยพาณิชย์|กรุงเทพ|กรุงศรี|ทหารไทย|ออมสิน|ธกส|ยูโอบี|ซีไอเอ็มบี|เกียรตินาคิน|xxx-|x-x|bank|\d{3}-\d)/i;

  var MONTHS_TH = ['ม.ค','ก.พ','มี.ค','เม.ย','พ.ค','มิ.ย','ก.ค','ส.ค','ก.ย','ต.ค','พ.ย','ธ.ค'];
  var MONTHS_TH_FULL = ['มกรา','กุมภา','มีนา','เมษา','พฤษภา','มิถุนา','กรกฎา','สิงหา','กันยา','ตุลา','พฤศจิกา','ธันวา'];
  var MONTHS_EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  function toArabicDigits(s) {
    return String(s).replace(/[๐-๙]/g, function (d) { return String(THAI_DIGITS.indexOf(d)); });
  }

  /* OCR มักคืนสระอำแบบแยกร่าง (ํ + า) ทำให้คำอย่าง "จำนวนเงิน" ไม่แมตช์คีย์เวิร์ด */
  function normalizeUnicode(s) {
    s = String(s);
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/ํ([่-๋]?)า/g, '$1ำ');
  }

  /* "น . ส . สมชาย" / "06 ก . ย . 2569" -> "น.ส. สมชาย" / "06 ก.ย. 2569" */
  function tidyDots(line) {
    return line
      .replace(/([฀-๿])\s+\.\s*/g, '$1.')
      .replace(/\s+\.\s*(?=[฀-๿])/g, '.');
  }

  /* Tesseract มักซอยอักษรไทยเป็น "ย อ ด ร ว ม" — เชื่อมกลับเมื่อบรรทัดนั้นถูกซอยจริง */
  function joinBrokenThai(line) {
    var tokens = line.split(' ').filter(function (t) { return t.length > 0; });
    var thai = tokens.filter(function (t) { return /[฀-๿]/.test(t); });
    if (thai.length < 3) return line;
    var short = thai.filter(function (t) { return t.replace(/[ะ-ฺ็-๎]/g, '').length <= 2; }).length;
    if (short / thai.length < 0.6) return line;
    return line.replace(/([฀-๿])\s+(?=[฀-๿])/g, '$1');
  }

  function normalizeText(raw) {
    var text = toArabicDigits(normalizeUnicode(raw || ''))
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .split('\n')
      .map(function (l) { return joinBrokenThai(tidyDots(l.trim())); })
      .filter(function (l) { return l.length > 0; })
      .join('\n');
    // การเชื่อมช่องว่างอาจสร้างสระอำแบบแยกร่างขึ้นมาใหม่ (จ + ํ + " " + า) จึงต้องล้างซ้ำ
    return normalizeUnicode(text);
  }

  function toNumber(str) {
    if (str === null || str === undefined) return null;
    var s = String(str).replace(/[^\d.,-]/g, '');
    // 1.234,50 (คั่นหลักพันด้วยจุด) -> 1234.50
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* หาจำนวนเงินในบรรทัด โดยดูทีละคำ — เลขที่เกาะติดตัวอักษร (เช่นรหัสอ้างอิง A01…531b) จะถูกทิ้ง */
  function moneyIn(line) {
    var out = [];
    line.split(/\s+/).forEach(function (token) {
      var t = token
        .replace(/^[฿$(\[<]+/, '')
        .replace(/[)\]>,;:]+$/, '')
        .replace(/(บาท|บ\.|thb|฿)$/i, '')
        .replace(/\.$/, '');
      if (!/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t) && !/^-?\d+(\.\d{1,2})?$/.test(t)) return;
      var v = toNumber(t);
      if (v === null || v <= 0 || v > 10000000) return;
      out.push({ value: v, text: t, hasDecimals: /\.\d{1,2}$/.test(t), grouped: /,/.test(t) });
    });
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
      // บางใบเสร็จ/สลิปขึ้นบรรทัดใหม่ก่อนตัวเลข
      if (!nums.length && lines[i + 1] && !TOTAL_BLOCK.test(lines[i + 1])) nums = moneyIn(lines[i + 1]);
      // คำใบ้อ่อน (เงินสด/โอนเงิน) ต้องเป็นตัวเลขที่หน้าตาเหมือนเงินจริงๆ เท่านั้น
      if (hint.w <= 45) nums = nums.filter(function (n) { return n.hasDecimals || n.grouped || n.value >= 10; });
      if (!nums.length) return;
      var pick = nums[nums.length - 1];
      var score = hint.w + (pick.hasDecimals ? 6 : 0) + (pick.grouped ? 3 : 0) + i * 0.1;
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

  /* ดึงวันที่ทุกรูปแบบที่เจอในบรรทัดเดียว */
  function datesInLine(line) {
    var found = [], m;
    var re1 = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;      // 31/12/2567
    while ((m = re1.exec(line)) !== null) {
      var d1 = makeDate(+m[3], +m[2], +m[1]);
      if (d1) found.push(d1);
    }
    var re2 = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;        // 2024-12-31
    while ((m = re2.exec(line)) !== null) {
      var d2 = makeDate(+m[1], +m[2], +m[3]);
      if (d2) found.push(d2);
    }
    var re3 = /\b(\d{1,2})\s*([฀-๿.]{2,12}|[A-Za-z]{3,9})\.?\s*(\d{2,4})\b/g;  // 31 ธ.ค. 2567
    while ((m = re3.exec(line)) !== null) {
      var mi = monthIndexFromName(m[2]);
      if (!mi) continue;
      var d3 = makeDate(+m[3], mi, +m[1]);
      if (d3) found.push(d3);
    }
    return found;
  }

  /* เลือกวันที่ของรายการ: ให้น้ำหนักบรรทัดที่มีป้ายกำกับ เช่น "วันที่ทำรายการ" มากกว่าเลขที่บังเอิญ
     หน้าตาเหมือนวันที่ (เลขที่เอกสาร/รหัสอ้างอิง) และตัดวันที่ในอนาคตทิ้งก่อน */
  function findDate(lines) {
    var today = new Date();
    var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    var best = null;

    lines.forEach(function (line, i) {
      var labeled = DATE_LABEL_RE.test(line);
      var found = datesInLine(line);
      // ป้ายกำกับอยู่บรรทัดหนึ่ง แต่ค่าตกไปอีกบรรทัด (สลิปแบบสองคอลัมน์)
      if (!found.length && labeled && lines[i + 1]) found = datesInLine(lines[i + 1]);
      found.forEach(function (iso) {
        var score = (labeled ? 100 : 0) - i * 0.1;
        var parts = iso.split('-');
        if (new Date(+parts[0], +parts[1] - 1, +parts[2]) > tomorrow) score -= 200;  // ใบเสร็จไม่ควรลงวันที่อนาคต
        if (!best || score > best.score) best = { iso: iso, score: score };
      });
    });
    return best ? best.iso : null;
  }

  /* บรรทัดที่ OCR อ่านไม่ออก (สัญลักษณ์เยอะ / ตัวอักษรโดดๆ หลายตัว) ไม่ควรกลายเป็นชื่อร้าน */
  function looksLikeGarbage(line) {
    var junk = (line.match(/[^\wก-๙\s.&()'\/-]/g) || []).length;
    if (junk / line.length > 0.15) return true;
    var loners = line.split(/\s+/).filter(function (t) { return /^[A-Za-z]$/.test(t); }).length;
    return loners >= 2;
  }

  function cleanName(s) {
    return s.replace(/\s+/g, ' ')
      .replace(/^[\s:：.\-]+|[\s:：.\-]+$/g, '')
      .replace(/^(น\.ส\.|ด\.ช\.|ด\.ญ\.|นางสาว|นาย|นาง)(?=[ก-๙])/, '$1 ')
      .slice(0, 60);
  }

  /* ตัดชื่อธนาคาร/เลขบัญชีออก เหลือแต่ชื่อคนหรือชื่อร้าน */
  function stripBankParts(value) {
    return cleanName(String(value)
      .replace(/x{2,}[\dx*\-]*/gi, ' ')
      .replace(/\b\d{2,}[\d\-]*\b/g, ' ')
      .replace(/(ธนาคาร|บมจ\.?|บัญชี|กรุงไทย|กสิกรไทย|กสิกร|ไทยพาณิชย์|กรุงเทพ|กรุงศรีอยุธยา|กรุงศรี|ทหารไทยธนชาต|ทหารไทย|ธนชาต|ออมสิน|ธกส|ยูโอบี|ซีไอเอ็มบี|เกียรตินาคิน|แลนด์แอนด์เฮ้าส์|ทิสโก้|พร้อมเพย์|promptpay|bank)/gi, ' '));
  }

  function nameLike(line) {
    var v = stripBankParts(line);
    if (v.length < 3 || looksLikeGarbage(v)) return '';
    if (!/[ก-๙A-Za-z]{3}/.test(v)) return '';
    return v;
  }

  /* สลิปโอนเงิน: "ร้าน" ที่มีความหมายคือปลายทางที่โอนไป — คน ร้าน หรือบริษัทที่รับเงิน */
  function findPayee(lines) {
    var i, j;
    for (i = 0; i < lines.length; i++) {
      var m = lines[i].match(TO_RE);
      if (!m || FROM_RE.test(lines[i])) continue;
      var inline = nameLike(m[2] || '');           // ชื่ออยู่บรรทัดเดียวกับป้ายกำกับ
      if (inline) return inline;
      for (j = i + 1; j < Math.min(i + 4, lines.length); j++) {   // ชื่ออยู่บรรทัดถัดไป
        if (TO_RE.test(lines[j]) || FROM_RE.test(lines[j])) break;
        var next = nameLike(lines[j]);
        if (next) return next;
      }
    }
    // OCR อ่านป้าย "ไปยัง" ไม่ออก — ใช้ชื่อถัดจากชื่อผู้โอน (คนแรกคือผู้โอน คนที่สองคือผู้รับ)
    for (i = 0; i < lines.length; i++) {
      if (!FROM_RE.test(lines[i])) continue;
      var seen = 0;
      for (j = i + 1; j < lines.length; j++) {
        var cand = nameLike(lines[j]);
        if (!cand) continue;
        seen++;
        if (seen === 2) return cand;
      }
      break;
    }
    return '';
  }

  function findMerchant(lines, isSlip) {
    if (isSlip) {
      var payee = findPayee(lines);
      if (payee) return payee;
    }
    var skip = /(ใบเสร็จ|ใบกำกับ|ใบรับเงิน|receipt|invoice|tax\s*invoice|สาขา|โทร|tel|เลขที่|เลขประจำตัว|tax\s*id|วันที่|date|time|www\.|http|@|ขอบคุณ|thank|สำเร็จ|success)/i;
    var candidates = [];
    lines.slice(0, 7).forEach(function (line, i) {
      if (skip.test(line) || looksLikeGarbage(line)) return;
      if (/\d{3,}/.test(line) || /\d+[.,]\d{2}\b/.test(line)) return;  // บรรทัดที่มีราคา/รหัส ไม่ใช่ชื่อร้าน
      var letters = line.replace(/[^฀-๿A-Za-z]/g, '');
      if (letters.length < 3 || letters.length / line.length < 0.5) return;
      candidates.push({ line: line, letters: letters.length, index: i });
    });
    if (!candidates.length) return '';
    var named = candidates.filter(function (c) { return c.letters >= 4; });
    return cleanName((named.length ? named : candidates)[0].line);
  }

  /* สลิปธนาคารมีช่อง "บันทึกช่วยจำ" อยู่แล้ว — ดึงมาใส่ให้เลย */
  function findNote(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(NOTE_RE);
      if (!m) continue;
      var value = cleanName(m[2] || '');
      if (!value && lines[i + 1]) value = cleanName(lines[i + 1]);
      if (value.length >= 2 && /[ก-๙A-Za-z]/.test(value) && !looksLikeGarbage(value)) return value.slice(0, 80);
    }
    return '';
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
      if (name.replace(/[^฀-๿A-Za-z]/g, '').length < 2) return;
      var price = toNumber(m[2]);
      if (price === null || price <= 0) return;
      items.push({ name: name, price: price });
    });
    return items.slice(0, 40);
  }

  function parse(rawText) {
    var text = normalizeText(rawText);
    var lines = text ? text.split('\n') : [];
    var isSlip = SLIP_RE.test(text);
    var amountInfo = findAmount(lines);
    var note = findNote(lines);
    return {
      text: text,
      isSlip: isSlip,
      date: findDate(lines),
      merchant: findMerchant(lines, isSlip),
      amount: amountInfo.amount,
      amountSource: amountInfo.amountSource,
      confident: amountInfo.confident,
      note: note,
      category: guessCategory(text + ' ' + note),
      items: isSlip ? [] : findItems(lines)
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
