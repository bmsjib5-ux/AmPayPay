-- Webhook ให้ตาราง debt_claims เรียก Edge Function push-notify ทุกครั้งที่มีการเพิ่ม/แก้แถว
-- ใช้แทนการสร้าง Database Webhook ในหน้าเว็บ (ผลเหมือนกัน แต่ทำผ่าน SQL ได้)
-- วิธีใช้: แทนที่ <PROJECT_REF> และ <WEBHOOK_SECRET> (ค่าเดียวกับ secret ของฟังก์ชัน) แล้วรันใน SQL Editor

create extension if not exists pg_net with schema extensions;

-- ตาราง debt_claims_data เก็บอีเมลแบบเข้ารหัส จึงใช้ claim_webhook_payload() (จาก schema.sql) สร้างข้อมูลที่ถอดรหัสแล้ว
-- เฉพาะช่องที่ฟังก์ชันต้องใช้ (ไม่ส่งรูป/พร้อมเพย์)
create or replace function public.push_notify_hook() returns trigger
language plpgsql security definer set search_path = public, extensions, net as $fn$
begin
  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notify',
    body := public.claim_webhook_payload(TG_OP, NEW, case when TG_OP = 'UPDATE' then OLD else null end),
    headers := '{"Content-Type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}'::jsonb,
    timeout_milliseconds := 5000);
  return NEW;
end $fn$;

drop trigger if exists push_notify_hook on public.debt_claims_data;
create trigger push_notify_hook after insert or update on public.debt_claims_data
  for each row execute function public.push_notify_hook();

-- ตรวจผลการส่งล่าสุด (status_code 200 = ฟังก์ชันรับแล้ว, body บอกจำนวนเครื่องที่ส่งถึง)
-- select id, status_code, content, error_msg from net._http_response order by id desc limit 5;
