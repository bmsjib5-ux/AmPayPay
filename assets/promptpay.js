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

  root.PromptPay = { payload: payload, normalizeId: normalizeId, crc16: crc16 };
})(typeof window !== 'undefined' ? window : globalThis);
