/* Supabase Edge Function: รับ Database Webhook จากตาราง debt_claims แล้วส่ง Web Push ให้อีกฝ่าย
   ตั้งค่า (Dashboard → Edge Functions → Secrets):
     VAPID_PUBLIC_KEY  = คีย์สาธารณะ (ตัวเดียวกับใน assets/config.js)
     VAPID_PRIVATE_KEY = คีย์ลับ
     VAPID_SUBJECT     = mailto:อีเมลของคุณ
     WEBHOOK_SECRET    = รหัสลับที่ตั้งเอง ใส่เป็น header x-webhook-secret ใน Database Webhook
   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ระบบใส่ให้เองอยู่แล้ว */
import { sendWebPush, type PushSubscription, type VapidKeys } from './webpush.ts';

interface ClaimRow {
  id: string; from_user: string; from_email: string; from_name: string; to_email: string;
  amount: number | string; note: string; status: string; reply: string; deleted: boolean;
}
interface WebhookBody { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; record: ClaimRow | null; old_record: ClaimRow | null }
interface SubRow { endpoint: string; p256dh: string; auth: string; user_id: string; email: string }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const money = (n: number | string) => '฿' + (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
}
async function subsByEmail(email: string): Promise<SubRow[]> {
  const r = await rest(`push_subscriptions?select=endpoint,p256dh,auth,user_id,email&email=eq.${encodeURIComponent(email.toLowerCase())}`);
  return r.ok ? await r.json() : [];
}
async function subsByUser(userId: string): Promise<SubRow[]> {
  const r = await rest(`push_subscriptions?select=endpoint,p256dh,auth,user_id,email&user_id=eq.${encodeURIComponent(userId)}`);
  return r.ok ? await r.json() : [];
}
async function friendName(userId: string, email: string): Promise<string> {
  const r = await rest(`friends?select=name&user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`);
  const rows = r.ok ? await r.json() : [];
  return (rows[0] && rows[0].name) || email;
}

/* ตัดสินว่าเหตุการณ์นี้ต้องแจ้งใคร ด้วยข้อความอะไร */
export async function planNotification(body: WebhookBody): Promise<{ subs: SubRow[]; title: string; text: string } | null> {
  const rec = body.record;
  if (!rec || body.table !== 'debt_claims' || rec.deleted) return null;
  const old = body.old_record;
  const who = rec.from_name || rec.from_email;
  const note = rec.note ? ` · ${rec.note}` : '';

  if (body.type === 'INSERT') {
    if (rec.status !== 'pending') return null;
    return { subs: await subsByEmail(rec.to_email), title: `${who} ส่งยอด ${money(rec.amount)} มาให้คุณ`, text: `รอจ่าย${note}` };
  }
  if (body.type !== 'UPDATE' || !old) return null;
  const statusChanged = old.status !== rec.status;
  if (statusChanged && rec.status === 'paid') {
    const name = await friendName(rec.from_user, rec.to_email);
    return { subs: await subsByUser(rec.from_user), title: `${name} แจ้งว่าจ่าย ${money(rec.amount)} แล้ว`, text: (rec.reply ? `“${rec.reply}”` : 'กดยืนยันได้รับในแอป') + note };
  }
  if (statusChanged && rec.status === 'confirmed') {
    return { subs: await subsByEmail(rec.to_email), title: `${who} ยืนยันรับเงิน ${money(rec.amount)} แล้ว`, text: `เคลียร์เรียบร้อย ✅${note}` };
  }
  if (statusChanged && rec.status === 'cancelled') {
    return { subs: await subsByEmail(rec.to_email), title: `${who} ยกเลิกยอด ${money(rec.amount)}`, text: `ไม่ต้องจ่ายแล้ว${note}` };
  }
  if (statusChanged && rec.status === 'pending' && old.status === 'paid') {
    return { subs: await subsByEmail(rec.to_email), title: `${who} ยังไม่ได้รับเงิน ${money(rec.amount)}`, text: `สถานะกลับเป็นรอจ่าย${note}` };
  }
  if (!statusChanged && rec.status === 'pending' && Number(old.amount) !== Number(rec.amount)) {
    return { subs: await subsByEmail(rec.to_email), title: `${who} แก้ยอดเป็น ${money(rec.amount)}`, text: `เดิม ${money(old.amount)}${note}` };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('WEBHOOK_SECRET') ?? '';
  if (secret && req.headers.get('x-webhook-secret') !== secret) return new Response('forbidden', { status: 403 });

  const vapid: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  };
  if (!vapid.publicKey || !vapid.privateKey) return new Response('missing VAPID keys', { status: 500 });

  let body: WebhookBody;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const plan = await planNotification(body);
  if (!plan || !plan.subs.length) return Response.json({ sent: 0 });

  const payload = JSON.stringify({ title: plan.title, body: plan.text, url: '/#bell', tag: 'claim-' + (body.record?.id ?? '') });
  let sent = 0, dropped = 0;
  await Promise.all(plan.subs.map(async (s) => {
    const sub: PushSubscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      const status = await sendWebPush(sub, payload, vapid);
      if (status === 404 || status === 410) {           // เครื่องนั้นเลิกรับแล้ว
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
        dropped++;
      } else if (status >= 200 && status < 300) sent++;
      else console.error('push failed', status, s.endpoint.slice(0, 60));
    } catch (e) { console.error('push error', e); }
  }));
  return Response.json({ sent, dropped });
});
