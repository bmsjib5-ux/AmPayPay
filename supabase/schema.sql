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

-- การหารบิลกับเพื่อน: ใครติดเท่าไหร่ จ่ายคืนแล้วหรือยัง
alter table public.expenses add column if not exists split jsonb not null default '{"people": []}'::jsonb;

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

-- ---------- เพื่อน (สมุดที่อยู่ส่วนตัว ใช้เลือกตอนหารบิล) ----------
create table if not exists public.friends (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  email       text        not null,
  name        text        not null default '',
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, email)
);

-- เพื่อนแบบสองทาง: เก็บอีเมล/ชื่อเล่นของคนที่เพิ่ม เพื่อให้ฝั่งที่ถูกเพิ่มเห็นเราในรายชื่อของเขาด้วย
alter table public.friends add column if not exists owner_email text not null default '';
alter table public.friends add column if not exists owner_name  text not null default '';

create index if not exists friends_email_idx
  on public.friends (lower(email));

-- ---------- ใบแจ้งหนี้ระหว่างเพื่อน ----------
-- ใช้อีเมลเป็นตัวชี้ตัวลูกหนี้ เพราะเพื่อนอาจยังไม่ได้สมัครตอนที่ส่งไป
create table if not exists public.debt_claims (
  id          text        not null primary key,
  from_user   uuid        not null references auth.users (id) on delete cascade,
  from_email  text        not null default '',
  from_name   text        not null default '',
  to_email    text        not null,
  amount      numeric(12,2) not null default 0,
  note        text        not null default '',
  expense_id  text        not null default '',
  person_id   text        not null default '',
  -- pending = รอจ่าย · paid = เพื่อนแจ้งว่าจ่ายแล้ว · confirmed = เจ้าหนี้ยืนยันได้รับ · cancelled = ยกเลิก
  status      text        not null default 'pending',
  reply       text        not null default '',
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- รูปย่อใบเสร็จ (data URL ขนาดเล็ก) ให้ลูกหนี้เปิดดูได้ว่าเป็นบิลอะไร
alter table public.debt_claims add column if not exists image text not null default '';

-- พร้อมเพย์ของเจ้าหนี้ (เบอร์/เลขบัตร) ให้ลูกหนี้สแกน QR โอนคืนได้ทันที
alter table public.debt_claims add column if not exists promptpay text not null default '';

create index if not exists debt_claims_to_email_idx
  on public.debt_claims (lower(to_email), updated_at desc);
create index if not exists debt_claims_from_user_idx
  on public.debt_claims (from_user, updated_at desc);

-- ---------- เครื่องที่เปิดรับ push แจ้งเตือน (หนึ่งแถวต่อเบราว์เซอร์/เครื่อง) ----------
-- Edge Function push-notify อ่านตารางนี้ด้วย service role เพื่อส่งแจ้งเตือนหาอีกฝ่าย
create table if not exists public.push_subscriptions (
  endpoint    text        not null primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  email       text        not null default '',
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_email_idx on public.push_subscriptions (lower(email));
create index if not exists push_subscriptions_user_idx  on public.push_subscriptions (user_id);

-- ---------- Row Level Security: แต่ละคนเห็นและแก้ได้เฉพาะข้อมูลตัวเอง ----------
alter table public.books       enable row level security;
alter table public.expenses    enable row level security;
alter table public.budgets     enable row level security;
alter table public.friends     enable row level security;
alter table public.debt_claims enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "books_own_rows" on public.books;
create policy "books_own_rows" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "expenses_own_rows" on public.expenses;
create policy "expenses_own_rows" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "budgets_own_row" on public.budgets;
create policy "budgets_own_row" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "friends_own_rows" on public.friends;
create policy "friends_own_rows" on public.friends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- คนที่ถูกเพิ่มเป็นเพื่อน อ่านแถวที่ชี้มาหาตัวเองได้ (แค่อ่าน แก้ไม่ได้) เพื่อเพิ่มกลับให้อัตโนมัติ
drop policy if exists "friends_added_me_read" on public.friends;
create policy "friends_added_me_read" on public.friends
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "push_subscriptions_own_rows" on public.push_subscriptions;
create policy "push_subscriptions_own_rows" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ใบแจ้งหนี้มีสองฝ่าย: เจ้าหนี้ (from_user) และลูกหนี้ (to_email)
drop policy if exists "debt_claims_owner" on public.debt_claims;
create policy "debt_claims_owner" on public.debt_claims
  for all using (auth.uid() = from_user) with check (auth.uid() = from_user);

drop policy if exists "debt_claims_debtor_read" on public.debt_claims;
create policy "debt_claims_debtor_read" on public.debt_claims
  for select using (lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "debt_claims_debtor_update" on public.debt_claims;
create policy "debt_claims_debtor_update" on public.debt_claims
  for update using (lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
           with check (lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- RLS คุมได้แค่ระดับแถว ลูกหนี้จึงยังแก้ยอดเงินได้ถ้ายิง API ตรงๆ
-- ตัวนี้กันไว้อีกชั้น: ลูกหนี้เปลี่ยนได้เฉพาะสถานะว่าจ่ายแล้วกับข้อความตอบกลับ
create or replace function public.debt_claims_guard()
returns trigger language plpgsql security definer as $guard$
begin
  if auth.uid() = old.from_user then
    return new;                                  -- เจ้าหนี้แก้ได้ทุกช่อง
  end if;
  new.id         := old.id;
  new.from_user  := old.from_user;
  new.from_email := old.from_email;
  new.from_name  := old.from_name;
  new.to_email   := old.to_email;
  new.amount     := old.amount;
  new.note       := old.note;
  new.expense_id := old.expense_id;
  new.person_id  := old.person_id;
  new.promptpay  := old.promptpay;
  new.image      := old.image;
  new.deleted    := old.deleted;
  new.created_at := old.created_at;
  if new.status not in ('pending', 'paid') then  -- ยืนยันรับเงินได้เฉพาะเจ้าหนี้
    new.status := old.status;
  end if;
  return new;
end $guard$;

drop trigger if exists debt_claims_guard_trg on public.debt_claims;
create trigger debt_claims_guard_trg before update on public.debt_claims
  for each row execute function public.debt_claims_guard();

-- หมายเหตุ: รูปใบเสร็จไม่ถูกอัปโหลด เก็บอยู่ในเบราว์เซอร์ของแต่ละเครื่องเท่านั้น
