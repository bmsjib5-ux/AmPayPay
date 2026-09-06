/* ตั้งค่าเชื่อมต่อ Supabase — กรอกค่าจากหน้า Supabase → Settings → API
   anon key เป็นคีย์สาธารณะ ออกแบบมาให้ฝังในหน้าเว็บได้ ความปลอดภัยมาจาก
   Row Level Security ในฐานข้อมูล (ดูไฟล์ supabase/schema.sql)
   ปล่อยว่างไว้ = ปิดการซิงก์ แอปจะทำงานเก็บข้อมูลในเครื่องเหมือนเดิมทุกอย่าง */
window.SUPABASE_CONFIG = {
  url: 'https://wbmstqhrlnlruvpqgikw.supabase.co',
  anonKey: 'sb_publishable_O40Dp52fpK2gmPwkjB6mAg_kXdliZGE'
};
