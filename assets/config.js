/* ตั้งค่าเชื่อมต่อ Supabase — กรอกค่าจากหน้า Supabase → Settings → API
   anon key เป็นคีย์สาธารณะ ออกแบบมาให้ฝังในหน้าเว็บได้ ความปลอดภัยมาจาก
   Row Level Security ในฐานข้อมูล (ดูไฟล์ supabase/schema.sql)
   ปล่อยว่างไว้ = ปิดการซิงก์ แอปจะทำงานเก็บข้อมูลในเครื่องเหมือนเดิมทุกอย่าง */
window.SUPABASE_CONFIG = {
  url: 'https://wbmstqhrlnlruvpqgikw.supabase.co',
  anonKey: 'sb_publishable_O40Dp52fpK2gmPwkjB6mAg_kXdliZGE'
};

/* Web Push แจ้งเตือนตอนปิดแอป — คีย์สาธารณะ VAPID (คู่กับคีย์ลับที่เก็บใน Supabase Edge Function secrets)
   ปล่อยว่าง = ซ่อนปุ่มเปิด push · วิธีตั้งค่าดู README หัวข้อ "แจ้งเตือนตอนปิดแอป" */
window.PUSH_CONFIG = {
  vapidPublicKey: 'BJhuP3IgQcMT9LtOu9JNIPytP6X9yHTnkkci5jEYeBamh3t4VJpK5SbIazNH7HmZ8eufwI34LVtchTXwUZPpKJQ'
};
