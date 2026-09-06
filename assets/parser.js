/* แปลงข้อความที่ OCR อ่านได้จากใบเสร็จ/สลิปโอนเงิน ให้เป็นข้อมูลรายจ่าย */
window.ReceiptParser = (function () {
  'use strict';

  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

  var CATEGORIES = [
    { key: 'food',      label: 'อาหาร & เครื่องดื่ม', words: ['ร้านอาหาร','อาหารตามสั่ง','ค่าอาหาร','ค่ากิน','ค่าข้าว','กับข้าว','ส้มตำ','ตำแซ่บ','ก๋วยเตี๋ยว','ก๋วยจั๊บ','ข้าวมันไก่','ข้าวหมูแดง','ข้าวแกง','ข้าวเหนียว','หมูปิ้ง','ลูกชิ้น','ไก่ทอด','เป็ดย่าง','ชาตรามือ','ชานม','ชาไทย','ชาเย็น','กาแฟ','อเมซอน','คาเฟ่','เบเกอรี่','เค้ก','ขนม','ไอศกรีม','น้ำปั่น','ครัว','สุกี้','ชาบู','หมูกระทะ','บุฟเฟ่ต์','ปิ้งย่าง','อาหาร','เครื่องดื่ม','restaurant','cafe','coffee','starbucks','kfc','mcdonald','pizza','bakery','tea','food','noodle'] },
    { key: 'grocery',   label: 'ของใช้ & ซูเปอร์',    words: ['เซเว่น','7-eleven','7 eleven','เทสโก้','โลตัส','บิ๊กซี','บิกซี','แม็คโคร','ท็อปส์','วิลล่า','แฟมิลี่มาร์ท','มินิมาร์ท','ซุปเปอร์','ซูเปอร์','ตลาด','ของใช้','ผงซักฟอก','กระดาษทิชชู','ยาสีฟัน','lotus','big c','bigc','makro','tops','villa','supermarket','mini mart','family mart','cp all'] },
    { key: 'transport', label: 'เดินทาง',            words: ['ค่ารถ','ค่าเดินทาง','ค่าโดยสาร','แท็กซี่','วินมอเตอร์ไซค์','วินมอไซค์','มอเตอร์ไซค์รับจ้าง','รถไฟฟ้า','รถเมล์','ค่าน้ำมัน','เติมน้ำมัน','ปตท','บางจาก','เชลล์','เอสโซ่','คาลเท็กซ์','ทางด่วน','ค่าทางด่วน','ที่จอดรถ','ค่าจอดรถ','แกร็บ','โบลท์','ลาลามูฟ','grab','bolt','taxi','ptt','shell','esso','caltex','bts','mrt','parking','fuel','petrol','lineman'] },
    { key: 'utility',   label: 'ค่าน้ำ / ค่าไฟ',      words: ['ค่าไฟ','ค่าน้ำ','ค่าไฟฟ้า','ค่าน้ำประปา','ไฟฟ้า','ประปา','การไฟฟ้า','การประปา','กฟภ','กฟน','กปน','กปภ','มิเตอร์','หน่วยไฟ','electricity','electric bill','water bill'] },
    { key: 'rent',      label: 'ค่าห้องพัก / คอนโด',  words: ['ค่าห้อง','ค่าเช่าห้อง','ค่าเช่า','ค่าหอ','หอพัก','คอนโด','อพาร์ทเม้นท์','อพาร์ตเมนต์','แมนชั่น','ค่าส่วนกลาง','นิติบุคคล','ค่าเช่าที่','rent','condo','apartment','dorm'] },
    { key: 'carloan',   label: 'ค่าผ่อนรถยนต์',       words: ['ค่างวดรถ','งวดรถ','ผ่อนรถ','ค่าผ่อนรถ','ค่ารถยนต์','ลีสซิ่ง','ไฟแนนซ์รถ','เช่าซื้อรถ','กรุงศรีออโต้','โตโยต้าลีสซิ่ง','อีซูซุลีสซิ่ง','ทิสโก้ออโต้','car loan','leasing','auto loan','hire purchase'] },
    { key: 'creditcard',label: 'ค่าบัตรเครดิต',       words: ['ชำระบัตรเครดิต','ชำระค่าบัตร','ค่าบัตรเครดิต','ยอดบัตรเครดิต','ชำระยอดบัตร','จ่ายบัตรเครดิต','บัตรเคทีซี','เคทีซี','อิออน','เฟิร์สช้อยส์','ซิตี้แบงก์','credit card payment','ktc','aeon','first choice'] },
    { key: 'bills',     label: 'บิล & ค่าบริการ',     words: ['ค่าเน็ต','ค่าอินเทอร์เน็ต','อินเทอร์เน็ต','ค่าโทรศัพท์','ค่ามือถือ','ค่าประกัน','เบี้ยประกัน','ค่าเทอม','ค่าบริการรายเดือน','ทรูมูฟ','ทรู','เอไอเอส','ดีแทค','true','ais','dtac','3bb','internet','insurance','netflix bill'] },
    { key: 'health',    label: 'สุขภาพ',             words: ['โรงพยาบาล','คลินิก','ร้านยา','เภสัช','ทันตกรรม','ทำฟัน','ค่ายา','ค่ารักษา','ตรวจสุขภาพ','แล็บ','วัตสัน','บู๊ทส์','hospital','clinic','pharmacy','dental','watsons','boots','fascino','lab'] },
    { key: 'shopping',  label: 'ช้อปปิ้ง',            words: ['เสื้อผ้า','รองเท้า','กระเป๋า','เครื่องสำอาง','ลาซาด้า','ช้อปปี้','ติ๊กต็อก','เซ็นทรัล','โรบินสัน','ห้างสรรพสินค้า','ไอที','โทรศัพท์มือถือ','lazada','shopee','tiktok','uniqlo','h&m','zara','muji','ikea','central','robinson','power buy','jd central'] },
    { key: 'lottery',   label: 'ค่าหวย / ล็อตเตอรี่',  words: ['หวย','ค่าหวย','ล็อตเตอรี่','ลอตเตอรี่','สลากกินแบ่ง','กองสลาก','หวยใต้ดิน','หวยออนไลน์','lottery'] },
    { key: 'fun',       label: 'บันเทิง & อื่นๆ',      words: ['โรงหนัง','ค่าหนัง','ดูหนัง','เมเจอร์','เกม','เติมเกม','คาราโอเกะ','ท่องเที่ยว','ค่าที่พัก','โรงแรม','รีสอร์ท','ตั๋วเครื่องบิน','สวนสนุก','major','sf cinema','netflix','spotify','youtube premium','steam','hotel','cinema','ticket'] }
  ];

  var OTHER = { key: 'other', label: 'ไม่ระบุหมวด' };

  /* คำที่บอกว่าบรรทัดนี้คือ "ยอดที่ต้องจ่าย" — ค่ามากคือน่าเชื่อถือกว่า */
  var TOTAL_HINTS = [
    { keys: ['รวมทั้งสิ้น', 'ยอดสุทธิ', 'รวมสุทธิ', 'ยอดชำระ'], re: /(grand\s*total|net\s*total|net\s*amount|amount\s*due|total\s*due|balance\s*due)/i, w: 100 },
    { keys: ['จำนวนเงิน', 'ยอดเงิน', 'ยอดโอน', 'เงินที่โอน'], w: 90 },
    { keys: ['จำนวน'], needColon: true, w: 88 },
    { keys: ['ยอดรวม', 'รวมเงิน', 'รวมทั้งหมด'], re: /(^\s*รวม|\btotal\b|\bamount\b)/i, w: 80 },
    { keys: ['ราคารวม', 'รวมย่อย'], re: /sub\s*-?\s*total/i, w: 60 },
    { keys: ['เงินสด', 'รับเงิน', 'ชำระโดย', 'บัตรเครดิต', 'พร้อมเพย์', 'โอนเงิน'], re: /(\bcash\b|\bcard\b|credit|payment|paid|promptpay|\bqr\b)/i, w: 45 }
  ];

  /* บรรทัดที่ไม่ใช่ยอดที่จ่ายจริง */
  var BLOCK_KEYS = ['ภาษีมูลค่าเพิ่ม', 'เลขประจำตัวผู้เสียภาษี', 'เงินทอน', 'ส่วนลด', 'ค่าธรรมเนียม',
    'ยอดคงเหลือ', 'คงเหลือ', 'รหัสอ้างอิง', 'เลขที่อ้างอิง', 'หมายเลขอ้างอิง', 'เลขที่รายการ',
    'เลขที่บัญชี', 'ต่อหน่วย', 'คะแนนสะสม'];
  var BLOCK_RE = /(ภาษี|vat|tax\s*id|ทอน|change|discount|point|\bfee\b|balance|reference|ref\s*no|account|บัญชี|โทร|tel|เลขที่|no\.|unit\s*price)/i;

  function isBlockedLine(line) {
    if (hasAny(line, ['รวมทั้งสิ้น', 'ยอดสุทธิ']) || /grand\s*total/i.test(line)) return false;
    return BLOCK_RE.test(line) || hasAny(line, BLOCK_KEYS);
  }

  /* สลิปโอนเงินจากแอปธนาคาร มีโครงสร้างต่างจากใบเสร็จร้านค้า — ดูจากหลายสัญญาณรวมกัน
     เพราะคำเดียวอาจถูก OCR อ่านเพี้ยนจนหาไม่เจอ */
  var SLIP_SIGNALS = ['โอนเงินสำเร็จ', 'ทำรายการสำเร็จ', 'โอนเงิน', 'ค่าธรรมเนียม', 'รหัสอ้างอิง',
    'เลขที่รายการ', 'พร้อมเพย์', 'วันที่ทำรายการ', 'บันทึกช่วยจำ', 'ไปยัง', 'ผู้รับเงิน'];

  function detectSlip(lines) {
    var hits = 0;
    SLIP_SIGNALS.forEach(function (key) {
      for (var i = 0; i < lines.length; i++) {
        if (fuzzyFind(lines[i], key) >= 0) { hits++; return; }
      }
    });
    if (/(promptpay|transfer\s*(success|complete)|slip)/i.test(lines.join('\n'))) hits++;
    return hits >= 2;
  }

  var TO_KEYS = ['โอนไปยัง', 'โอนไปที่', 'ไปยังบัญชี', 'ไปยัง', 'ไปที่', 'ผู้รับเงิน', 'ผู้รับโอน',
    'ชื่อผู้รับ', 'ผู้รับชำระ', 'ผู้รับ', 'ชื่อบัญชีปลายทาง', 'บัญชีปลายทาง', 'จ่ายให้', 'ชำระให้',
    'ชื่อร้านค้า', 'ร้านค้า', 'ผู้ขาย', 'ถึง'];
  var TO_EN_RE = /^(to|payee|merchant|to\s*account)\s*[:：]?\s*(.*)$/i;
  var FROM_KEYS = ['ผู้โอน', 'ชื่อผู้โอน', 'บัญชีต้นทาง'];
  var FROM_RE = /^(จาก|from)\s*[:：]?/i;
  var NOTE_KEYS = ['บันทึกช่วยจำ', 'หมายเหตุ'];
  var NOTE_EN_RE = /(memo|remark|note)\s*[:：]?\s*(.*)$/i;
  var DATE_LABEL_KEYS = ['วันที่ทำรายการ', 'วันเวลาทำรายการ', 'เวลาทำรายการ', 'วันที่โอน', 'วันที่ชำระ',
    'วันที่ออก', 'วันที่รับเงิน', 'วันที่'];
  var DATE_LABEL_RE = /(transaction\s*date|date\s*\/?\s*time|\bdate\b)/i;
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

  /* ---------- จับคู่คำแบบทนความเพี้ยนของ OCR ----------
     OCR ภาษาไทยมักทำสระ/วรรณยุกต์หาย และสลับพยัญชนะหน้าตาคล้ายกัน
     (จำนวนเงิน -> ขำนวนเงน, บันทึกช่วยจำ -> ปันทึกชวยจำ)
     จึงเทียบกันที่ "โครงพยัญชนะ" และยอมให้ต่างกันได้ 1 ตัวอักษร */
  var STRIP_RE = /[\u0E31\u0E33-\u0E3A\u0E40-\u0E4E\s.,:：;_'"()\[\]\-]/;

  function skeletonMap(text) {
    var str = String(text).toLowerCase();
    var sk = '', map = [];
    for (var i = 0; i < str.length; i++) {
      if (STRIP_RE.test(str[i])) continue;
      sk += str[i];
      map.push(i);
    }
    map.push(str.length);
    return { sk: sk, map: map };
  }

  function skeleton(text) { return skeletonMap(text).sk; }

  /* ต่างกันไม่เกิน 1 ตัวอักษร (แทนที่ / เพิ่ม / ขาด) */
  function withinOneEdit(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la === lb) { i++; j++; }
      else if (la > lb) i++;
      else j++;
    }
    return edits + (la - i) + (lb - j) <= 1;
  }

  /* คืนตำแหน่งท้ายคำในสตริงเดิมถ้าเจอคำนี้ (แบบทนเพี้ยน) ไม่เจอคืน -1
     ยอมให้เพี้ยนได้เฉพาะคำยาวพอ และต้องขึ้นต้นคำใหม่ ไม่ใช่โผล่กลางคำอื่น */
  var FUZZY_MIN = 6;

  /* คำนี้ขึ้นต้นคำใหม่หรือไม่ — ดูช่องว่าง/เครื่องหมายคั่นก่อนหน้า
     (เทียบบนสตริงเดิม เพราะโครงพยัญชนะตัดสระนำอย่าง ไ เ โ ออกไปแล้ว) */
  function isWordStart(line, map, idx) {
    if (idx <= 0) return true;
    var between = String(line).slice(map[idx - 1] + 1, map[idx]);
    return /[\s:：,;|()\[\]\-\/]/.test(between);
  }

  function fuzzyFind(line, keyword) {
    var k = skeleton(keyword);
    if (!k) return -1;
    var m = skeletonMap(line);
    var from = 0, idx;
    while ((idx = m.sk.indexOf(k, from)) >= 0) {              // ตรงตัวก่อน
      if (isWordStart(line, m.map, idx)) return m.map[idx + k.length];
      from = idx + 1;
    }
    if (k.length < FUZZY_MIN) return -1;
    for (var i = 0; i + k.length - 1 <= m.sk.length; i++) {
      if (!isWordStart(line, m.map, i)) continue;
      for (var d = -1; d <= 1; d++) {
        var len = k.length + d;
        if (len <= 0 || i + len > m.sk.length) continue;
        if (withinOneEdit(m.sk.substr(i, len), k)) return m.map[i + len];
      }
    }
    return -1;
  }

  function hasAny(line, keywords) {
    for (var i = 0; i < keywords.length; i++) if (fuzzyFind(line, keywords[i]) >= 0) return true;
    return false;
  }

  /* ข้อความที่อยู่หลังป้ายกำกับในบรรทัดเดียวกัน */
  function tailAfter(line, keywords) {
    var best = -1;
    keywords.forEach(function (k) {
      var end = fuzzyFind(line, k);
      if (end > best) best = end;
    });
    return best < 0 ? null : String(line).slice(best);
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

  function matchHint(line) {
    for (var h = 0; h < TOTAL_HINTS.length; h++) {
      var hint = TOTAL_HINTS[h];
      if (hint.needColon && line.indexOf(':') === -1 && line.indexOf('：') === -1) continue;
      if (hint.re && hint.re.test(line)) return hint;
      if (hint.keys && hasAny(line, hint.keys)) return hint;
    }
    return null;
  }

  function findAmount(lines) {
    var best = null;
    lines.forEach(function (line, i) {
      if (isBlockedLine(line)) return;
      var hint = matchHint(line);
      if (!hint) return;
      var nums = moneyIn(line);
      // บางใบเสร็จ/สลิปขึ้นบรรทัดใหม่ก่อนตัวเลข และ OCR อาจแทรกบรรทัดขยะคั่นไว้
      for (var k = 1; k <= 3 && !nums.length; k++) {
        var nextLine = lines[i + k];
        if (!nextLine || isBlockedLine(nextLine) || matchHint(nextLine)) break;
        nums = moneyIn(nextLine);
      }
      // คำใบ้อ่อน (เงินสด/โอนเงิน) ต้องเป็นตัวเลขที่หน้าตาเหมือนเงินจริงๆ เท่านั้น
      // และบรรทัดที่มีเวลาหรือวันที่ (เช่นหัวสลิป "โอนเงินสำเร็จ 4 ก.ย. 69 13:49 น.") ไม่ใช่ยอดเงิน
      if (hint.w <= 45) {
        if (/\d{1,2}\s*[:.]\s*\d{2}\s*(น\.|น|am|pm)?/i.test(line) || datesInLine(line).length) return;
        nums = nums.filter(function (n) { return n.hasDecimals || n.grouped; });
      }
      if (!nums.length) return;
      var pick = nums[nums.length - 1];
      var score = hint.w + (pick.hasDecimals ? 6 : 0) + (pick.grouped ? 3 : 0) + i * 0.1;
      if (!best || score > best.score) best = { value: pick.value, score: score, line: line, decimals: pick.hasDecimals };
    });
    if (best) return { amount: best.value, amountSource: best.line, confident: best.score >= 60,
      amountScore: best.score, amountHasDecimals: best.decimals };

    // ไม่พบคำใบ้ — เดาจากตัวเลขที่มีทศนิยมและมีค่ามากที่สุดในครึ่งล่างของใบเสร็จ
    var start = Math.floor(lines.length * 0.35);
    var fallback = null;
    for (var i = start; i < lines.length; i++) {
      if (isBlockedLine(lines[i])) continue;
      moneyIn(lines[i]).forEach(function (n) {
        if (n.hasDecimals && (!fallback || n.value > fallback.value)) fallback = { value: n.value, line: lines[i] };  // เดาจากตัวเลขที่มีทศนิยม
      });
    }
    if (fallback) return { amount: fallback.value, amountSource: fallback.line, confident: false,
      amountScore: 10, amountHasDecimals: true };
    return { amount: null, amountSource: '', confident: false, amountScore: 0, amountHasDecimals: false };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function makeDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var years = [];
    if (y > 2400) years.push(y - 543);                 // พ.ศ. เต็ม
    else if (y >= 1900) years.push(y);                 // ค.ศ. เต็ม
    else if (y < 100) {
      years.push(2000 + y);                            // ค.ศ. 2 หลัก เช่น 24 -> 2024
      years.push(2500 + y - 543);                      // พ.ศ. 2 หลัก เช่น 69 -> 2569 -> 2026
      if (y > 70) years.push(1900 + y);
    }
    var now = new Date();
    var limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var best = null;
    years.forEach(function (year) {
      if (year < 1990 || year > 2100) return;
      var dt = new Date(year, m - 1, d);
      if (dt.getMonth() !== m - 1) return;             // เช่น 31 ก.พ.
      // เลือกปีที่ไม่ใช่อนาคต และใกล้ปัจจุบันที่สุด (ใบเสร็จลงวันที่อนาคตไม่ได้)
      var future = dt > limit;
      var distance = Math.abs(dt - now);
      if (!best || (best.future && !future) || (best.future === future && distance < best.distance)) {
        best = { year: year, future: future, distance: distance };
      }
    });
    if (!best) return null;
    return best.year + '-' + pad(m) + '-' + pad(d);
  }

  function monthIndexFromName(name) {
    var raw = String(name).toLowerCase().replace(/[.\s]/g, '');
    var all = [];
    for (var i = 0; i < 12; i++) {
      all.push({ m: i + 1, text: MONTHS_TH[i].replace(/\./g, '') });
      all.push({ m: i + 1, text: MONTHS_TH_FULL[i] });
      all.push({ m: i + 1, text: MONTHS_EN[i] });
    }
    for (var j = 0; j < all.length; j++) if (raw.indexOf(all[j].text) === 0) return all[j].m;
    // OCR ชอบใส่สระเกินหรือทำสระหาย เช่น "กุย" แทน "ก.ย." — ยอมให้ต่างกัน 1 ตัว
    // แต่ต้องได้คำตอบเดียวเท่านั้น ไม่งั้นเสี่ยงสับสนระหว่าง ม.ค. กับ มี.ค.
    var hits = {};
    all.forEach(function (cand) {
      if (cand.text.length < 2) return;
      var head = raw.slice(0, cand.text.length + 1);
      if (withinOneEdit(raw.slice(0, cand.text.length), cand.text) || withinOneEdit(head, cand.text)) hits[cand.m] = true;
    });
    var months = Object.keys(hits);
    return months.length === 1 ? +months[0] : 0;
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
    var re3 = /\b(\d{1,2})\s*([฀-๿][฀-๿.\s]{1,11}|[A-Za-z]{3,9})\.?\s*(\d{2,4})\b/g;  // 31 ธ.ค. 2567
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
  /* เลขที่รายการของหลายธนาคารขึ้นต้นด้วยวันที่ เช่น 202609021632359 = 2026-09-02 */
  function dateInsideId(line) {
    var m = String(line).match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{4,}\b/);
    return m ? makeDate(+m[1], +m[2], +m[3]) : null;
  }

  function findDate(lines) {
    var today = new Date();
    var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    var best = null;

    lines.forEach(function (line, i) {
      var labeled = DATE_LABEL_RE.test(line) || hasAny(line, DATE_LABEL_KEYS);
      var found = datesInLine(line);
      // ป้ายกำกับอยู่บรรทัดหนึ่ง แต่ค่าตกไปอีกบรรทัด (สลิปแบบสองคอลัมน์)
      if (!found.length && labeled && lines[i + 1]) found = datesInLine(lines[i + 1]);
      var embedded = dateInsideId(line);
      if (embedded && found.indexOf(embedded) === -1) found.push(embedded);
      found.forEach(function (iso) {
        var score = (labeled ? 100 : (iso === embedded ? 60 : 0)) - i * 0.1;
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
      .replace(/\s+\)/g, ')')
      .replace(/\(\s+/g, '(')
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

  function tidyName(value) {
    var tokens = String(value).split(/\s+/).filter(Boolean);
    var isJunk = function (t) {
      var letters = t.replace(/[^฀-๿A-Za-z]/g, '');
      if (letters.length <= 1) return true;
      return /^[a-z]{1,3}$/.test(t);   // เศษอักษรละตินตัวเล็ก ไม่ใช่ตัวย่ออย่าง SCB
    };
    while (tokens.length && isJunk(tokens[0])) tokens.shift();
    while (tokens.length && isJunk(tokens[tokens.length - 1])) tokens.pop();
    var out = cleanName(tokens.join(' '));
    // OCR มักเอาตัวอักษรข้างเคียงมาติดหน้าคำนำหน้าชื่อ เช่น "วนางสาวอัครยุภา"
    var m = out.match(/(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|บริษัท|บจก\.|หจก\.|ร้าน)/);
    if (m && m.index > 0 && m.index <= 3) out = cleanName(out.slice(m.index));
    return out;
  }

  /* บรรทัดหัวสลิป ป้ายกำกับ และลายน้ำ ไม่ใช่ชื่อคน/ร้าน */
  var NAME_NOISE_RE = /(^จาก$|^ถึง$|^ไปยัง$|^ผู้รับ|^ผู้โอน|รายการชำระ|สำเร็จ|สาเร็จ|โอนเงิน|ทำรายการ|พร้อมเพย์|พรอมเพย|promptpay|prompt|สแกน|ตรวจสอบสลิป|เลขที่รายการ|รหัสอ้างอิง|จำนวน|ค่าธรรมเนียม|ยอดคงเหลือ|วันที่|เวลา|บาท|ธนาคาร|บันทึกช่วยจำ|หมายเหตุ|ขอบคุณ|มั่งมี|slip|scan)/i;
  var BANK_APP_RE = /^(krungthai|kasikorn|kbank|k\s*plus|scb\s*easy|scb|bualuang|ttb|gsb|uob|cimb|ktb|mymo)\b.{0,14}$/i;

  function nameLike(line, strict) {
    if (strict && (NAME_NOISE_RE.test(line) || BANK_APP_RE.test(String(line).trim()) || BANK_RE.test(line))) return '';
    var v = tidyName(stripBankParts(line));
    if (v.length < 3 || looksLikeGarbage(v)) return '';
    // ต้องมีตัวอักษรไทยพอสมควร หรือเป็นคำอังกฤษที่ยาวพอ ไม่ใช่เศษอักษรอย่าง "TRE"
    if (!/[฀-๿]{3}/.test(v) && v.replace(/[^A-Za-z]/g, '').length < 5) return '';
    return v;
  }

  var TITLE_RE = /^(ร้าน|บริษัท|บจก|หจก|ห้าง|คุณ|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)/;

  /* ในกลุ่มชื่อที่เจอ ให้ความสำคัญกับชื่อที่มีคำนำหน้า (ร้าน/บจก./นาย/นาง) ก่อน */
  function preferTitled(names) {
    for (var i = 0; i < names.length; i++) if (TITLE_RE.test(names[i])) return names[i];
    return names[0] || '';
  }

  /* ชื่อร้านที่ยาวข้ามบรรทัด — ต่อบรรทัดถัดไปให้เมื่อวงเล็บยังไม่ปิด */
  function withContinuation(name, lines, index) {
    if (!name || name.indexOf('(') === -1 || name.indexOf(')') !== -1) return name;
    var next = lines[index + 1];
    if (!next || next.indexOf(')') === -1) return name;
    return cleanName(name + ' ' + next.replace(/\s*\)\s*$/, ')'));
  }

  /* เลขบัญชีที่ถูกปิดบัง หรือเลขยาวๆ — ใช้เป็นเส้นแบ่งระหว่างบล็อกผู้โอนกับผู้รับ */
  var ACCOUNT_RE = /(x{3,}[\dx*\-]*|\d{2,}-[\dx]+-[\dx]+)/i;

  function pickName(candidates, lines) {
    var picked = preferTitled(candidates.map(function (c) { return c.name; }));
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].name === picked) return withContinuation(picked, lines, candidates[i].index);
    }
    return picked;
  }

  /* สลิปโอนเงิน: "ร้าน" ที่มีความหมายคือปลายทางที่โอนไป — คน ร้าน หรือบริษัทที่รับเงิน */
  function findPayee(lines) {
    var i, j;
    for (i = 0; i < lines.length; i++) {
      if (FROM_RE.test(lines[i]) || hasAny(lines[i], FROM_KEYS)) continue;
      var en = lines[i].match(TO_EN_RE);
      var tail = en ? en[2] : tailAfter(lines[i], TO_KEYS);
      if (tail === null) continue;
      var inline = nameLike(tail);                 // ชื่ออยู่บรรทัดเดียวกับป้ายกำกับ
      if (inline) return withContinuation(inline, lines, i);
      for (j = i + 1; j < Math.min(i + 4, lines.length); j++) {   // ชื่ออยู่บรรทัดถัดไป
        if (tailAfter(lines[j], TO_KEYS) !== null || FROM_RE.test(lines[j])) break;
        var next = nameLike(lines[j], true);
        if (next) return withContinuation(next, lines, j);
      }
    }
    // OCR อ่านป้าย "ไปยัง" ไม่ออก — ใช้ชื่อถัดจากชื่อผู้โอน (คนแรกคือผู้โอน คนถัดไปคือผู้รับ)
    for (i = 0; i < lines.length; i++) {
      if (!FROM_RE.test(lines[i]) && !hasAny(lines[i], FROM_KEYS)) continue;
      var afterFrom = [];
      for (j = i + 1; j < lines.length; j++) {
        if (isBlockedLine(lines[j]) || matchHint(lines[j])) break;
        var c1 = nameLike(lines[j], true);
        if (c1) afterFrom.push({ name: c1, index: j });
      }
      if (afterFrom.length >= 2) return pickName(afterFrom.slice(1), lines);
      break;
    }

    // สลิปที่ไม่มีป้ายกำกับเลย (เช่น K+ ที่ใช้ลูกศร) — ผู้รับอยู่ถัดจากบล็อกเลขบัญชีของผู้โอน
    for (i = 0; i < lines.length; i++) {
      if (!ACCOUNT_RE.test(lines[i])) continue;
      var afterAccount = [];
      for (j = i + 1; j < lines.length; j++) {
        if (isBlockedLine(lines[j]) || matchHint(lines[j])) break;   // ถึงบล็อกเลขที่รายการ/ยอดเงินแล้วหยุด
        var c2 = nameLike(lines[j], true);
        if (c2) afterAccount.push({ name: c2, index: j });
      }
      if (afterAccount.length) return pickName(afterAccount, lines);
      break;
    }

    // ทางเลือกสุดท้าย: ชื่อแรกมักเป็นผู้โอน ชื่อถัดไปคือผู้รับ
    var names = [];
    lines.forEach(function (line, idx) {
      var cand = nameLike(line, true);
      if (cand) names.push({ name: cand, index: idx });
    });
    if (names.length >= 2) return pickName(names.slice(1), lines);
    return names.length === 1 ? names[0].name : '';
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
      var en = lines[i].match(NOTE_EN_RE);
      var tail = en ? en[2] : tailAfter(lines[i], NOTE_KEYS);
      if (tail === null) continue;
      var value = cleanName(tail);
      if (!value && lines[i + 1]) value = cleanName(lines[i + 1]);
      if (value.length >= 2 && /[฀-๿A-Za-z]/.test(value) && !looksLikeGarbage(value)) return value.slice(0, 80);
    }
    return '';
  }

  var REF_KEYS = ['เลขที่รายการ', 'รหัสอ้างอิง', 'เลขที่อ้างอิง', 'หมายเลขอ้างอิง', 'รหัสธุรกรรม'];
  var REF_EN_RE = /(reference|ref\s*no|transaction\s*(id|no))\s*[:：]?\s*([A-Za-z0-9]{6,})/i;

  /* เลขอ้างอิงของสลิป — ถ้าตรงกันแปลว่าเป็นใบเดียวกันแน่ๆ */
  function findRef(lines) {
    for (var i = 0; i < lines.length; i++) {
      var en = lines[i].match(REF_EN_RE);
      var tail = en ? en[3] : tailAfter(lines[i], REF_KEYS);
      if (tail === null) continue;
      var value = String(tail).replace(/[^A-Za-z0-9]/g, '');
      if (!value && lines[i + 1]) value = String(lines[i + 1]).replace(/[^A-Za-z0-9]/g, '');
      if (value.length >= 8) return value.toUpperCase().slice(0, 40);
    }
    return '';
  }

  /* เดาหมวดจากคำที่เจอ โดยชื่อร้านกับบันทึกช่วยจำมีน้ำหนักมากกว่าข้อความทั้งใบ
     และคำที่เจาะจงกว่า (ยาวกว่า) ชนะคำกว้างๆ เช่น "ค่าน้ำมัน" ชนะ "น้ำ" */
  function guessCategory(fullText, strongText) {
    var hay = String(fullText || '').toLowerCase();
    var strong = String(strongText || '').toLowerCase();
    var best = null;
    CATEGORIES.forEach(function (cat) {
      var score = 0;
      cat.words.forEach(function (word) {
        var w = word.toLowerCase();
        var weight = Math.min(4, Math.max(1, Math.ceil(w.length / 3)));
        if (strong && strong.indexOf(w) !== -1) score += weight * 4;      // เจอในชื่อร้าน/บันทึกช่วยจำ
        else if (hay.indexOf(w) !== -1) score += weight;                   // เจอที่อื่นในใบเสร็จ
      });
      if (score && (!best || score > best.score)) best = { key: cat.key, score: score };
    });
    return best ? best.key : OTHER.key;
  }

  function findItems(lines) {
    var items = [];
    lines.forEach(function (line) {
      if (isBlockedLine(line) || matchHint(line)) return;
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
    var isSlip = detectSlip(lines);
    var amountInfo = findAmount(lines);
    var note = findNote(lines);
    var merchantName = findMerchant(lines, isSlip);
    return {
      text: text,
      isSlip: isSlip,
      date: findDate(lines),
      merchant: merchantName,
      amount: amountInfo.amount,
      amountSource: amountInfo.amountSource,
      confident: amountInfo.confident,
      amountScore: amountInfo.amountScore,
      amountHasDecimals: amountInfo.amountHasDecimals,
      note: note,
      ref: findRef(lines),
      category: guessCategory(text + ' ' + note, merchantName + ' ' + note),
      items: isSlip ? [] : findItems(lines)
    };
  }

  return {
    parse: parse,
    categories: CATEGORIES.concat([OTHER]),
    /* เดาหมวดจากชื่อร้าน/บันทึกช่วยจำอย่างเดียว (ใช้ตอนผู้ใช้พิมพ์ชื่อร้านเอง) */
    guessCategory: function (merchant, note) {
      var joined = (merchant || '') + ' ' + (note || '');
      return guessCategory(joined, joined);
    },
    categoryLabel: function (key) {
      var all = CATEGORIES.concat([OTHER]);
      for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i].label;
      return OTHER.label;
    },
    toNumber: toNumber,
    normalizeText: normalizeText,
    /* ใช้ตรวจว่าใบเสร็จนี้เคยบันทึกไปแล้วหรือยัง */
    refOf: function (rawText) { return findRef(normalizeText(rawText || '').split('\n')); }
  };
})();
