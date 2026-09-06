-- ตารางสำหรับ "สมุดเก็บรายจ่ายของฉัน"
-- วิธีใช้: เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
-- รันซ้ำได้เสมอ ไม่ทำข้อมูลเดิมหาย (ใช้ if not exists / add column if not exists)

-- ---------- สมุด (แยกรายจ่ายเป็นหลายเล่มได้ เช่น ส่วนตัว / ร้านค้า / บ้าน) ----------
create table if not exists public.books (
  id          text        not null,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  name        text        not null default 'สมุดของฉัน',
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists books_user_updated_idx
  on public.books (user_id, updated_at desc);

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

-- รายจ่ายอยู่ในสมุดเล่มไหน (ข้อมูลเดิมก่อนมีหลายสมุด จะอยู่ในเล่มแรกโดยอัตโนมัติ)
alter table public.expenses add column if not exists book_id text not null default 'b_default';

-- ดึงเฉพาะรายการที่แก้ไขหลังซิงก์ครั้งก่อน จึงต้องมี index ตรงนี้
create index if not exists expenses_user_updated_idx
  on public.expenses (user_id, updated_at desc);

-- ---------- งบประมาณรายเดือน (แยกตามสมุด) ----------
create table if not exists public.budgets (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  total       numeric(12,2) not null default 0,
  categories  jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.budgets add column if not exists book_id text not null default 'b_default';

-- เปลี่ยนคีย์หลักจาก (user_id) เป็น (user_id, book_id) เพื่อให้มีงบแยกได้เล่มละชุด
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass and contype = 'p'
      and array_length(conkey, 1) = 1
  ) then
    alter table public.budgets drop constraint budgets_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.budgets'::regclass and contype = 'p'
  ) then
    alter table public.budgets add primary key (user_id, book_id);
  end if;
end $$;

-- ---------- Row Level Security: แต่ละคนเห็นและแก้ได้เฉพาะข้อมูลตัวเอง ----------
alter table public.books    enable row level security;
alter table public.expenses enable row level security;
alter table public.budgets  enable row level security;

drop policy if exists "books_own_rows" on public.books;
create policy "books_own_rows" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "expenses_own_rows" on public.expenses;
create policy "expenses_own_rows" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "budgets_own_row" on public.budgets;
create policy "budgets_own_row" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- หมายเหตุ: รูปใบเสร็จไม่ถูกอัปโหลด เก็บอยู่ในเบราว์เซอร์ของแต่ละเครื่องเท่านั้น
