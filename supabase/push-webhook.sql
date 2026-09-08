-- Webhook ให้ตาราง debt_claims เรียก Edge Function push-notify ทุกครั้งที่มีการเพิ่ม/แก้แถว
-- ใช้แทนการสร้าง Database Webhook ในหน้าเว็บ (ผลเหมือนกัน แต่ทำผ่าน SQL ได้)
-- วิธีใช้: แทนที่ <PROJECT_REF> และ <WEBHOOK_SECRET> (ค่าเดียวกับ secret ของฟังก์ชัน) แล้วรันใน SQL Editor

create extension if not exists pg_net with schema extensions;

create or replace function public.push_notify_hook() returns trigger
language plpgsql security definer set search_path = public, extensions, net as $fn$
begin
  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notify',
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
                               'record', to_jsonb(NEW), 'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end),
    headers := '{"Content-Type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}'::jsonb,
    timeout_milliseconds := 5000);
  return NEW;
end $fn$;

drop trigger if exists push_notify_hook on public.debt_claims;
create trigger push_notify_hook after insert or update on public.debt_claims
  for each row execute function public.push_notify_hook();

-- ตรวจผลการส่งล่าสุด (status_code 200 = ฟังก์ชันรับแล้ว, body บอกจำนวนเครื่องที่ส่งถึง)
-- select id, status_code, content, error_msg from net._http_response order by id desc limit 5;
