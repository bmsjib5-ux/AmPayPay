/* ส่ง Web Push ด้วย WebCrypto ล้วน (RFC 8291 aes128gcm + RFC 8292 VAPID)
   ไม่พึ่ง npm เพื่อให้รันได้ทั้งบน Supabase Edge Functions (Deno) และทดสอบได้ใน Node */

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

export interface PushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }

/* เข้ารหัสข้อความตาม aes128gcm — คืน body ที่พร้อมส่ง (header 86 ไบต์ + ciphertext + tag) */
export async function encryptPayload(sub: PushSubscription, plaintext: string): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);

  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));   // 0x02 = ปิดท้ายเรคอร์ดสุดท้าย
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* หัว Authorization แบบ VAPID: JWT ลงชื่อด้วย ES256 อายุ 12 ชม. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys): Promise<string> {
  const pub = fromB64url(vapid.publicKey);            // 65 ไบต์ (0x04 || x || y)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)),
    d: vapid.privateKey
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })));
  const signingInput = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${b64url(sig)}, k=${vapid.publicKey}`;
}

export interface PushRequest { url: string; headers: Record<string, string>; body: Uint8Array }

export async function buildPushRequest(sub: PushSubscription, payload: string, vapid: VapidKeys, ttl = 86400): Promise<PushRequest> {
  const body = await encryptPayload(sub, payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    'Content-Length': String(body.length),
    'TTL': String(ttl),
    'Urgency': 'high',
    'Authorization': await vapidAuthorization(sub.endpoint, vapid)
  };
  return { url: sub.endpoint, headers, body };
}

/* คืนสถานะ HTTP; 404/410 หมายถึงเครื่องนั้นเลิกรับแล้ว ควรลบออกจากตาราง */
export async function sendWebPush(sub: PushSubscription, payload: string, vapid: VapidKeys, ttl = 86400): Promise<number> {
  const req = await buildPushRequest(sub, payload, vapid, ttl);
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  return res.status;
}
