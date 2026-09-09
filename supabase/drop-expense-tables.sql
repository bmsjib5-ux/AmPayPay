-- ลบตารางรายจ่ายเก่าออกจากฐานข้อมูล
--
-- ตั้งแต่เวอร์ชัน 67 เป็นต้นไป รายจ่าย งบประมาณ และสมุด เก็บอยู่ในเครื่องผู้ใช้อย่างเดียว
-- ไม่ถูกอัปโหลดขึ้น Supabase อีกแล้ว ตารางสามตัวนี้จึงไม่มีอะไรมาเขียนเพิ่ม
--
-- ⚠️ รันแล้วข้อมูลที่เคยซิงก์ขึ้นไปจะหายถาวร
--    ถ้ายังอยากเก็บไว้ ให้ผู้ใช้แต่ละคนเปิดแอปในเครื่องที่มีข้อมูลครบแล้วกด "สำรองข้อมูล" ก่อน
--    (ข้อมูลในเครื่องไม่ได้หายไปกับคำสั่งนี้ — ลบเฉพาะสำเนาบนเซิร์ฟเวอร์)
--
-- วิธีใช้: Supabase → SQL Editor → วางไฟล์นี้ → Run

begin;

drop table if exists public.expenses cascade;
drop table if exists public.budgets  cascade;
drop table if exists public.books    cascade;

commit;

-- ตรวจว่าเหลือเฉพาะตารางที่ต้องมี
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;
-- ควรเห็นแค่: debt_claims (view) · debt_claims_data · friends (view) · friends_data
--             push_subscriptions (view) · push_subscriptions_data
