/* สร้างข้อมูล QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR) จากเบอร์โทร, เลขบัตรประชาชน หรือ e-Wallet ID
   ทำงานในเครื่องล้วน ไม่ต่อเน็ต — ใช้ทำ QR ให้เพื่อนสแกนโอนเงินคืนตามยอดที่ค้าง */
(function (root) {
  'use strict';

  function crc16(str) {                                 // CRC-16/CCITT-FALSE ตามที่ Thai QR กำหนด
    var crc = 0xFFFF;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function tlv(id, value) {
    value = String(value);
    return id + String(value.length).padStart(2, '0') + value;
  }

  /* แปลงสิ่งที่ผู้ใช้พิมพ์เป็นรหัสตามชนิด: เบอร์โทร → 0066xxxxxxxxx · บัตรประชาชน 13 หลัก · e-Wallet 15 หลัก */
  function normalizeId(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 15) return { type: '03', value: digits, label: 'e-Wallet ' + digits };
    if (digits.length === 13 && !/^0066/.test(digits)) return { type: '02', value: digits, label: 'บัตรประชาชน ' + digits.replace(/(\d)(\d{4})(\d{5})(\d{2})(\d)/, '$1-$2-$3-$4-$5') };
    var phone = digits;
    if (/^66\d{9}$/.test(phone)) phone = '0' + phone.slice(2);
    if (/^0066\d{9}$/.test(phone)) phone = '0' + phone.slice(4);
    if (/^0\d{9}$/.test(phone)) return { type: '01', value: '0066' + phone.slice(1), label: 'เบอร์ ' + phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') };
    return null;
  }

  /* payload สำหรับใส่ใน QR — ใส่ยอดเงินแล้วแอปธนาคารจะเติมยอดให้เอง แก้ไม่ได้ (QR ใช้ครั้งเดียว) */
  function payload(rawId, amount) {
    var id = normalizeId(rawId);
    if (!id) return '';
    var amt = Number(amount) || 0;
    var merchant = tlv('00', 'A000000677010111') + tlv(id.type, id.value);
    var body = tlv('00', '01') + tlv('01', amt > 0 ? '12' : '11') + tlv('29', merchant) +
      tlv('53', '764') + (amt > 0 ? tlv('54', amt.toFixed(2)) : '') + tlv('58', 'TH') + '6304';
    return body + crc16(body);
  }

  /* ---------- อ่าน QR ที่สแกนมา (EMVCo TLV) ----------
     ใช้ตอนสแกน QR ของร้านค้าเพื่อดูว่าจ่ายให้ใคร เท่าไหร่ แล้วบันทึกเป็นรายจ่ายได้เลย */
  function parseTLV(str) {
    var out = {}, i = 0;
    while (i + 4 <= str.length) {
      var id = str.slice(i, i + 2);
      var len = parseInt(str.slice(i + 2, i + 4), 10);
      if (!/^\d{2}$/.test(id) || isNaN(len) || len < 0) return null;
      var value = str.slice(i + 4, i + 4 + len);
      if (value.length < len) return null;
      out[id] = value;
      i += 4 + len;
    }
    return i === str.length ? out : null;
  }

  /* คืน null ถ้าไม่ใช่ QR รับเงินตามมาตรฐาน (เช่นเป็นลิงก์เว็บธรรมดา) */
  function parse(text) {
    var str = String(text || '').trim();
    if (!/^000201/.test(str) || str.length < 20) return null;
    var body = str.slice(0, -4), crc = str.slice(-4).toUpperCase();
    if (!/^6304$/.test(str.slice(-8, -4))) return null;
    var root = parseTLV(str);
    if (!root || !root['00']) return null;

    var info = {
      valid: crc16(body) === crc,
      oneTime: root['01'] === '12',                       // 11 = สแกนได้หลายครั้ง · 12 = ใช้ครั้งเดียว
      amount: root['54'] ? Number(root['54']) : null,
      currency: root['53'] || '',
      country: root['58'] || '',
      merchant: (root['59'] || '').trim(),                // ชื่อร้าน (ถ้าใส่มา)
      city: (root['60'] || '').trim(),
      ref: '', target: '', targetLabel: '', kind: ''
    };
    if (info.amount != null && !isFinite(info.amount)) info.amount = null;

    var m29 = root['29'] ? parseTLV(root['29']) : null;   // พร้อมเพย์บุคคล/ร้านค้า
    var m30 = root['30'] ? parseTLV(root['30']) : null;   // บิลเลอร์ (จ่ายบิล)
    if (m29 && /^A000000677010111$/.test(m29['00'] || '')) {
      info.kind = 'promptpay';
      if (m29['01']) { info.target = m29['01']; info.targetLabel = phoneLabel(m29['01']); }
      else if (m29['02']) { info.target = m29['02']; info.targetLabel = 'บัตรประชาชน/ภาษี ' + m29['02']; }
      else if (m29['03']) { info.target = m29['03']; info.targetLabel = 'e-Wallet ' + m29['03']; }
    } else if (m30 && /^A000000677010112$/.test(m30['00'] || '')) {
      info.kind = 'bill';
      info.target = m30['01'] || '';
      info.targetLabel = 'รหัสผู้รับชำระ ' + info.target;
      info.ref = m30['02'] || '';
    } else if (m29 || m30) {
      info.kind = 'other';
      info.targetLabel = '';
    } else { return null; }
    return info;
  }
  function phoneLabel(v) {
    var d = String(v || '');
    if (/^0066\d{9}$/.test(d)) {
      var local = '0' + d.slice(4);
      return 'เบอร์ ' + local.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    }
    return 'พร้อมเพย์ ' + d;
  }

  root.PromptPay = { payload: payload, normalizeId: normalizeId, crc16: crc16, parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
