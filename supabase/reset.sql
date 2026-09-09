-- =====================================================================
--  ล้างข้อมูลของ AmPayPay ใน Supabase (เพื่อน + ใบแจ้งหนี้ + การแจ้งเตือน)
--  รายจ่ายไม่ได้เก็บบนเซิร์ฟเวอร์แล้ว จึงต้องล้างจากในแอปของแต่ละเครื่องแทน
--  ⚠️ ลบแล้วกู้คืนไม่ได้ — สำรองข้อมูลจากในแอป (ปุ่ม "💾 สำรองข้อมูล") ก่อนถ้ายังอยากเก็บไว้
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางเฉพาะส่วนที่ต้องการ → Run
-- =====================================================================


-- ---------------------------------------------------------------------
--  แบบที่ 1 (แนะนำ) — ลบเฉพาะข้อมูล เก็บโครงตารางไว้เหมือนเดิม
--  บัญชีผู้ใช้ยังอยู่ ล็อกอินเดิมได้เลย แค่ข้อมูลว่างเปล่า
-- ---------------------------------------------------------------------
truncate table public.debt_claims_data;
truncate table public.friends_data;
truncate table public.push_subscriptions_data;


-- ---------------------------------------------------------------------
--  แบบที่ 2 — ลบเฉพาะข้อมูลของบัญชีเดียว (ที่เหลือไม่ถูกแตะ)
--  แก้อีเมลข้างล่างให้เป็นบัญชีที่ต้องการ แล้วรันทั้งบล็อก
-- ---------------------------------------------------------------------
-- do $$
-- declare uid uuid;
-- begin
--   select id into uid from auth.users where email = 'ใส่อีเมลตรงนี้@example.com';
--   if uid is null then raise notice 'ไม่พบบัญชีนี้'; return; end if;
--   delete from public.debt_claims_data where from_user = uid;
--   delete from public.expenses    where user_id  = uid;
--   delete from public.budgets     where user_id  = uid;
--   delete from public.books       where user_id  = uid;
--   delete from public.friends_data     where user_id  = uid;
--   delete from public.push_subscriptions_data where user_id = uid;
--   raise notice 'ล้างข้อมูลของ % แล้ว', uid;
-- end $$;


-- ---------------------------------------------------------------------
--  แบบที่ 3 — รื้อตารางทิ้งทั้งหมดแล้วสร้างใหม่
--  ใช้เมื่ออยากเริ่มจากศูนย์จริงๆ · รันบล็อกนี้ก่อน แล้วรัน schema.sql ตามทันที
-- ---------------------------------------------------------------------
-- drop trigger if exists debt_claims_guard_trg on public.debt_claims;
-- drop function if exists public.debt_claims_guard();
-- drop view if exists public.debt_claims; drop view if exists public.friends; drop view if exists public.push_subscriptions;
-- drop table if exists public.debt_claims_data;
-- drop table if exists public.friends_data;
-- drop table if exists public.push_subscriptions_data;
-- drop table if exists public.expenses;
-- drop table if exists public.budgets;
-- drop table if exists public.books;
-- -- จากนั้นวางไฟล์ supabase/schema.sql ทั้งไฟล์แล้ว Run อีกครั้ง


-- ---------------------------------------------------------------------
--  แบบที่ 4 — ลบบัญชีผู้ใช้ทิ้งด้วย (ต้องสมัครใหม่)
--  ข้อมูลทุกตารางของบัญชีนั้นจะถูกลบตามไปเอง เพราะตั้ง on delete cascade ไว้
--  ปกติลบผ่านหน้า Authentication → Users จะง่ายกว่า
-- ---------------------------------------------------------------------
-- delete from auth.users where email = 'ใส่อีเมลตรงนี้@example.com';
-- delete from auth.users;   -- ลบทุกบัญชีในโปรเจกต์นี้


-- ---------------------------------------------------------------------
--  ตรวจว่าว่างจริงหรือยัง
-- ---------------------------------------------------------------------
select 'books' as ตาราง, count(*) as จำนวนแถว from public.books
union all select 'expenses',    count(*) from public.expenses
union all select 'budgets',     count(*) from public.budgets
union all select 'friends',     count(*) from public.friends_data
union all select 'debt_claims', count(*) from public.debt_claims_data
union all select 'push_subs',   count(*) from public.push_subscriptions_data;
