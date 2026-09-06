-- ตารางสำหรับ "สมุดเก็บรายจ่ายของฉัน"
-- วิธีใช้: เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
-- ปลอดภัยที่จะรันซ้ำได้ (ใช้ if not exists / drop policy if exists)

-- ---------- รายจ่าย ----------
create table if not exists public.expenses (
  id          text        not null,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  date        date        not null,
  merchant    text        not null default '',
  amount      numeric(12,2) not null default 0,
  category    text        not null default 'other',
  note        text        not null default '',
  items       jsonb       not null default '[]'::jsonb,
  raw_text    text        not null default '',
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ดึงเฉพาะรายการที่แก้ไขหลังซิงก์ครั้งก่อน จึงต้องมี index ตรงนี้
create index if not exists expenses_user_updated_idx
  on public.expenses (user_id, updated_at desc);

-- ---------- งบประมาณรายเดือน ----------
create table if not exists public.budgets (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  total       numeric(12,2) not null default 0,
  categories  jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------- Row Level Security: แต่ละคนเห็นและแก้ได้เฉพาะข้อมูลตัวเอง ----------
alter table public.expenses enable row level security;
alter table public.budgets  enable row level security;

drop policy if exists "expenses_own_rows" on public.expenses;
create policy "expenses_own_rows" on public.expenses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "budgets_own_row" on public.budgets;
create policy "budgets_own_row" on public.budgets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- หมายเหตุ: รูปใบเสร็จไม่ถูกอัปโหลด เก็บอยู่ในเบราว์เซอร์ของแต่ละเครื่องเท่านั้น
