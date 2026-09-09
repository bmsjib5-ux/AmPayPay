-- ตารางสำหรับ AmPayPay
-- วิธีใช้: เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
-- รันซ้ำได้เสมอ ไม่ทำข้อมูลเดิมหาย (ใช้ if not exists / add column if not exists)
--
-- ฐานข้อมูลเก็บเฉพาะสามอย่าง: บัญชีผู้ใช้ (Supabase Auth) · รายชื่อเพื่อน · ใบแจ้งหนี้ (ลูกหนี้)
-- รายจ่าย งบประมาณ สมุด และรูปใบเสร็จ อยู่ในเครื่องผู้ใช้อย่างเดียว ไม่ถูกอัปโหลดขึ้นที่นี่
-- (เคยรันเวอร์ชันเก่าที่สร้างตาราง books/expenses/budgets ไว้ → ลบทิ้งได้ด้วย supabase/drop-expense-tables.sql)

-- =====================================================================
--  ข้อมูลส่วนตัว (อีเมล / พร้อมเพย์) เก็บแบบเข้ารหัสในตาราง *_data
--  · เข้ารหัสด้วย pgcrypto (pgp_sym_encrypt) ใช้คีย์ที่เก็บใน Supabase Vault ("ampaypay_pii_key")
--  · เก็บ sha256 ของอีเมลไว้คู่กัน (…_hash) เพื่อค้นหา/กำหนดสิทธิ์ (RLS) โดยไม่ต้องถอดรหัส
--  · แอปอ่าน-เขียนผ่าน view ชื่อเดิม (friends, debt_claims, push_subscriptions) ซึ่งถอดรหัสให้เฉพาะแถวที่ RLS อนุญาต
--  · ใน Table Editor จึงเห็นอีเมล/พร้อมเพย์เป็นรหัส (bytea) ไม่ใช่ข้อความ
--  หมายเหตุ: อีเมลที่ใช้ล็อกอิน (Authentication → Users) เป็นของระบบ Supabase เอง ตารางนี้ไม่เกี่ยว
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- คีย์เข้ารหัส: สร้างครั้งเดียว เก็บใน Vault (ไม่โผล่ในตารางไหน)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ampaypay_pii_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ampaypay_pii_key');
  end if;
end $$;

create or replace function public.pii_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ampaypay_pii_key' limit 1
$$;
revoke all on function public.pii_key() from public, anon, authenticated;

create or replace function public.pii_encrypt(v text) returns bytea
language sql stable security definer set search_path = '' as $$
  select case when v is null or v = '' then null else extensions.pgp_sym_encrypt(v, public.pii_key()) end
$$;
create or replace function public.pii_decrypt(b bytea) returns text
language sql stable security definer set search_path = '' as $$
  select case when b is null then '' else extensions.pgp_sym_decrypt(b, public.pii_key()) end
$$;
-- แฮชสำหรับค้นหา: sha256(lower(trim(อีเมล))) เป็น hex — แอปคำนวณแบบเดียวกันได้เอง
create or replace function public.pii_hash(v text) returns text
language sql immutable set search_path = '' as $$
  select case when v is null or btrim(v) = '' then '' else encode(extensions.digest(lower(btrim(v)), 'sha256'), 'hex') end
$$;
create or replace function public.jwt_email() returns text
language sql stable set search_path = '' as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
$$;
create or replace function public.my_email_hash() returns text
language sql stable set search_path = '' as $$
  select public.pii_hash(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- ---------- ย้ายตารางเวอร์ชันเก่าที่เก็บอีเมลเป็นข้อความ → ตาราง *_data แบบเข้ารหัส ----------
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'friends') then
    alter table public.friends rename to friends_data;
    alter table public.friends_data add column if not exists owner_email text not null default '';
    alter table public.friends_data add column if not exists owner_name  text not null default '';
    alter table public.friends_data
      add column email_enc bytea, add column email_hash text, add column owner_email_enc bytea, add column owner_email_hash text;
    update public.friends_data set
      email_enc = public.pii_encrypt(lower(btrim(email))), email_hash = public.pii_hash(email),
      owner_email_enc = public.pii_encrypt(lower(btrim(owner_email))), owner_email_hash = public.pii_hash(owner_email);
    drop policy if exists "friends_own_rows" on public.friends_data;
    drop policy if exists "friends_added_me_read" on public.friends_data;
    drop index if exists public.friends_email_idx;
    alter table public.friends_data drop constraint friends_pkey;
    alter table public.friends_data drop column email, drop column owner_email;
    alter table public.friends_data alter column email_hash set not null;
    update public.friends_data set owner_email_hash = '' where owner_email_hash is null;
    alter table public.friends_data alter column owner_email_hash set not null, alter column owner_email_hash set default '';
    alter table public.friends_data add primary key (user_id, email_hash);
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'debt_claims') then
    drop trigger if exists debt_claims_guard_trg on public.debt_claims;
    drop trigger if exists push_notify_hook on public.debt_claims;
    alter table public.debt_claims rename to debt_claims_data;
    alter table public.debt_claims_data add column if not exists promptpay text not null default '';
    alter table public.debt_claims_data add column if not exists image text not null default '';
    alter table public.debt_claims_data
      add column from_email_enc bytea, add column from_email_hash text, add column to_email_enc bytea, add column to_email_hash text,
      add column promptpay_enc bytea;
    update public.debt_claims_data set
      from_email_enc = public.pii_encrypt(lower(btrim(from_email))), from_email_hash = public.pii_hash(from_email),
      to_email_enc = public.pii_encrypt(lower(btrim(to_email))), to_email_hash = public.pii_hash(to_email),
      promptpay_enc = public.pii_encrypt(promptpay);
    drop policy if exists "debt_claims_owner" on public.debt_claims_data;
    drop policy if exists "debt_claims_debtor_read" on public.debt_claims_data;
    drop policy if exists "debt_claims_debtor_update" on public.debt_claims_data;
    drop index if exists public.debt_claims_to_email_idx;
    alter table public.debt_claims_data drop column from_email, drop column to_email, drop column promptpay;
    update public.debt_claims_data set from_email_hash = '' where from_email_hash is null;
    alter table public.debt_claims_data alter column from_email_hash set not null, alter column from_email_hash set default '',
      alter column to_email_hash set not null;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'push_subscriptions') then
    alter table public.push_subscriptions rename to push_subscriptions_data;
    alter table public.push_subscriptions_data add column email_enc bytea, add column email_hash text;
    update public.push_subscriptions_data set email_enc = public.pii_encrypt(lower(btrim(email))), email_hash = public.pii_hash(email);
    drop policy if exists "push_subscriptions_own_rows" on public.push_subscriptions_data;
    drop index if exists public.push_subscriptions_email_idx;
    alter table public.push_subscriptions_data drop column email;
    update public.push_subscriptions_data set email_hash = '' where email_hash is null;
    alter table public.push_subscriptions_data alter column email_hash set not null, alter column email_hash set default '';
  end if;
end $$;

-- ---------- เพื่อน (สมุดที่อยู่ส่วนตัว ใช้เลือกตอนหารบิล) ----------
create table if not exists public.friends_data (
  user_id          uuid        not null references auth.users (id) on delete cascade,
  email_enc        bytea,                              -- อีเมลเพื่อน (เข้ารหัส)
  email_hash       text        not null,               -- sha256 ของอีเมลเพื่อน ไว้ค้นหา
  name             text        not null default '',
  deleted          boolean     not null default false,
  owner_email_enc  bytea,                              -- อีเมลของเจ้าของรายชื่อ (เข้ารหัส) ให้ฝั่งที่ถูกเพิ่มเห็นเรา
  owner_email_hash text        not null default '',
  owner_name       text        not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, email_hash)
);
create index if not exists friends_data_email_hash_idx on public.friends_data (email_hash);

create or replace view public.friends with (security_invoker = true) as
  select user_id, public.pii_decrypt(email_enc) as email, email_hash, name, deleted,
         public.pii_decrypt(owner_email_enc) as owner_email, owner_email_hash, owner_name, created_at, updated_at
  from public.friends_data;

create or replace function public.friends_view_write() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.friends_data where user_id = old.user_id and email_hash = old.email_hash;
    return old;
  end if;
  new.email := lower(btrim(coalesce(new.email, '')));
  -- อีเมลเจ้าของรายชื่อยึดจากบัญชีที่ล็อกอินเสมอ (ฝั่งที่ถูกเพิ่มจะได้ไม่ถูกหลอกว่าใครเป็นคนเพิ่ม)
  new.owner_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  if tg_op = 'INSERT' then
    insert into public.friends_data (user_id, email_enc, email_hash, name, deleted, owner_email_enc, owner_email_hash, owner_name, created_at, updated_at)
    values (new.user_id, public.pii_encrypt(new.email), public.pii_hash(new.email), coalesce(new.name, ''), coalesce(new.deleted, false),
            public.pii_encrypt(new.owner_email), public.pii_hash(new.owner_email), coalesce(new.owner_name, ''),
            coalesce(new.created_at, now()), coalesce(new.updated_at, now()))
    on conflict (user_id, email_hash) do update set
      name = excluded.name, deleted = excluded.deleted, owner_email_enc = excluded.owner_email_enc,
      owner_email_hash = excluded.owner_email_hash, owner_name = excluded.owner_name, updated_at = excluded.updated_at;
    return new;
  end if;
  update public.friends_data set
    name = coalesce(new.name, ''), deleted = coalesce(new.deleted, false),
    owner_email_enc = public.pii_encrypt(new.owner_email), owner_email_hash = public.pii_hash(new.owner_email),   -- จาก JWT เท่านั้น
    owner_name = coalesce(new.owner_name, ''), updated_at = coalesce(new.updated_at, now())
  where user_id = old.user_id and email_hash = old.email_hash;
  return new;
end $fn$;
drop trigger if exists friends_view_write_trg on public.friends;
create trigger friends_view_write_trg instead of insert or update or delete on public.friends
  for each row execute function public.friends_view_write();

-- ---------- ใบแจ้งหนี้ระหว่างเพื่อน ----------
-- ใช้อีเมล (แบบแฮช) เป็นตัวชี้ตัวลูกหนี้ เพราะเพื่อนอาจยังไม่ได้สมัครตอนที่ส่งไป
create table if not exists public.debt_claims_data (
  id              text        not null primary key,
  from_user       uuid        not null references auth.users (id) on delete cascade,
  from_email_enc  bytea,
  from_email_hash text        not null default '',
  from_name       text        not null default '',
  to_email_enc    bytea,
  to_email_hash   text        not null,
  amount          numeric(12,2) not null default 0,
  note            text        not null default '',
  expense_id      text        not null default '',
  person_id       text        not null default '',
  -- pending = รอจ่าย · paid = เพื่อนแจ้งว่าจ่ายแล้ว · confirmed = เจ้าหนี้ยืนยันได้รับ · cancelled = ยกเลิก
  status          text        not null default 'pending',
  reply           text        not null default '',
  promptpay_enc   bytea,                                -- พร้อมเพย์ของเจ้าหนี้ (เข้ารหัส)
  image           text        not null default '',      -- รูปย่อใบเสร็จ (data URL ขนาดเล็ก)
  deleted         boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists debt_claims_data_to_hash_idx on public.debt_claims_data (to_email_hash, updated_at desc);
create index if not exists debt_claims_from_user_idx on public.debt_claims_data (from_user, updated_at desc);

create or replace view public.debt_claims with (security_invoker = true) as
  select id, from_user, public.pii_decrypt(from_email_enc) as from_email, from_email_hash, from_name,
         public.pii_decrypt(to_email_enc) as to_email, to_email_hash, amount, note, expense_id, person_id,
         status, reply, public.pii_decrypt(promptpay_enc) as promptpay, image, deleted, created_at, updated_at
  from public.debt_claims_data;

create or replace function public.debt_claims_view_write() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.debt_claims_data where id = old.id;
    return old;
  end if;
  if tg_op = 'INSERT' then
    insert into public.debt_claims_data (id, from_user, from_email_enc, from_email_hash, from_name, to_email_enc, to_email_hash,
      amount, note, expense_id, person_id, status, reply, promptpay_enc, image, deleted, created_at, updated_at)
    values (new.id, new.from_user, public.pii_encrypt(public.jwt_email()), public.pii_hash(public.jwt_email()),
      coalesce(new.from_name, ''), public.pii_encrypt(lower(btrim(coalesce(new.to_email, '')))), public.pii_hash(new.to_email),
      coalesce(new.amount, 0), coalesce(new.note, ''), coalesce(new.expense_id, ''), coalesce(new.person_id, ''),
      coalesce(new.status, 'pending'), coalesce(new.reply, ''), public.pii_encrypt(new.promptpay), coalesce(new.image, ''),
      coalesce(new.deleted, false), coalesce(new.created_at, now()), coalesce(new.updated_at, now()))
    on conflict (id) do update set
      from_email_enc = excluded.from_email_enc, from_email_hash = excluded.from_email_hash, from_name = excluded.from_name,   -- อีเมลผู้ส่งยึดจาก JWT
      to_email_enc = excluded.to_email_enc, to_email_hash = excluded.to_email_hash, amount = excluded.amount, note = excluded.note,
      expense_id = excluded.expense_id, person_id = excluded.person_id, status = excluded.status, reply = excluded.reply,
      promptpay_enc = excluded.promptpay_enc, image = excluded.image, deleted = excluded.deleted, updated_at = excluded.updated_at;
    return new;
  end if;
  -- UPDATE: เขียนเฉพาะช่องที่เปลี่ยน (guard ในตารางจริงจะกันไม่ให้ลูกหนี้แก้ช่องอื่นอีกชั้น)
  update public.debt_claims_data set
    from_name = coalesce(new.from_name, from_name),
    amount = coalesce(new.amount, amount), note = coalesce(new.note, note),
    status = coalesce(new.status, status), reply = coalesce(new.reply, reply),
    promptpay_enc = case when new.promptpay is distinct from old.promptpay then public.pii_encrypt(new.promptpay) else promptpay_enc end,
    to_email_enc = case when new.to_email is distinct from old.to_email then public.pii_encrypt(lower(btrim(new.to_email))) else to_email_enc end,
    to_email_hash = case when new.to_email is distinct from old.to_email then public.pii_hash(new.to_email) else to_email_hash end,
    image = coalesce(new.image, image), deleted = coalesce(new.deleted, deleted),
    updated_at = coalesce(new.updated_at, now())
  where id = old.id;
  return new;
end $fn$;
drop trigger if exists debt_claims_view_write_trg on public.debt_claims;
create trigger debt_claims_view_write_trg instead of insert or update or delete on public.debt_claims
  for each row execute function public.debt_claims_view_write();

-- ---------- เครื่องที่เปิดรับ push แจ้งเตือน (หนึ่งแถวต่อเบราว์เซอร์/เครื่อง) ----------
create table if not exists public.push_subscriptions_data (
  endpoint    text        not null primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  email_enc   bytea,
  email_hash  text        not null default '',
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_data_hash_idx on public.push_subscriptions_data (email_hash);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions_data (user_id);

create or replace view public.push_subscriptions with (security_invoker = true) as
  select endpoint, user_id, public.pii_decrypt(email_enc) as email, email_hash, p256dh, auth, user_agent, created_at, updated_at
  from public.push_subscriptions_data;

create or replace function public.push_subscriptions_view_write() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.push_subscriptions_data where endpoint = old.endpoint;
    return old;
  end if;
  -- ยึดอีเมลจากบัญชีที่ล็อกอิน ไม่ให้ตั้งเป็นอีเมลคนอื่นเพื่อดักรับแจ้งเตือนของเขา
  new.email := public.jwt_email();
  insert into public.push_subscriptions_data (endpoint, user_id, email_enc, email_hash, p256dh, auth, user_agent, created_at, updated_at)
  values (new.endpoint, new.user_id, public.pii_encrypt(new.email), public.pii_hash(new.email), new.p256dh, new.auth,
          coalesce(new.user_agent, ''), coalesce(new.created_at, now()), coalesce(new.updated_at, now()))
  on conflict (endpoint) do update set
    user_id = excluded.user_id, email_enc = excluded.email_enc, email_hash = excluded.email_hash,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, updated_at = excluded.updated_at;
  return new;
end $fn$;
drop trigger if exists push_subscriptions_view_write_trg on public.push_subscriptions;
create trigger push_subscriptions_view_write_trg instead of insert or update or delete on public.push_subscriptions
  for each row execute function public.push_subscriptions_view_write();

-- ---------- Row Level Security: แต่ละคนเห็นและแก้ได้เฉพาะข้อมูลตัวเอง ----------
alter table public.friends_data            enable row level security;
alter table public.debt_claims_data        enable row level security;
alter table public.push_subscriptions_data enable row level security;

drop policy if exists "friends_own_rows" on public.friends_data;
create policy "friends_own_rows" on public.friends_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- คนที่ถูกเพิ่มเป็นเพื่อน อ่านแถวที่ชี้มาหาตัวเองได้ (แค่อ่าน แก้ไม่ได้) เพื่อเพิ่มกลับให้อัตโนมัติ
drop policy if exists "friends_added_me_read" on public.friends_data;
create policy "friends_added_me_read" on public.friends_data
  for select using (email_hash <> '' and email_hash = public.my_email_hash());

drop policy if exists "push_subscriptions_own_rows" on public.push_subscriptions_data;
create policy "push_subscriptions_own_rows" on public.push_subscriptions_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ใบแจ้งหนี้มีสองฝ่าย: เจ้าหนี้ (from_user) และลูกหนี้ (to_email_hash)
drop policy if exists "debt_claims_owner" on public.debt_claims_data;
create policy "debt_claims_owner" on public.debt_claims_data
  for all using (auth.uid() = from_user) with check (auth.uid() = from_user);

drop policy if exists "debt_claims_debtor_read" on public.debt_claims_data;
create policy "debt_claims_debtor_read" on public.debt_claims_data
  for select using (to_email_hash <> '' and to_email_hash = public.my_email_hash());

drop policy if exists "debt_claims_debtor_update" on public.debt_claims_data;
create policy "debt_claims_debtor_update" on public.debt_claims_data
  for update using (to_email_hash <> '' and to_email_hash = public.my_email_hash())
           with check (to_email_hash <> '' and to_email_hash = public.my_email_hash());

-- RLS คุมได้แค่ระดับแถว ลูกหนี้จึงยังแก้ยอดเงินได้ถ้ายิง API ตรงๆ
-- ตัวนี้กันไว้อีกชั้น: ลูกหนี้เปลี่ยนได้เฉพาะสถานะว่าจ่ายแล้วกับข้อความตอบกลับ
create or replace function public.debt_claims_guard()
returns trigger language plpgsql security definer set search_path = '' as $guard$
begin
  if auth.uid() = old.from_user then
    return new;                                  -- เจ้าหนี้แก้ได้ทุกช่อง
  end if;
  new.id              := old.id;
  new.from_user       := old.from_user;
  new.from_email_enc  := old.from_email_enc;
  new.from_email_hash := old.from_email_hash;
  new.from_name       := old.from_name;
  new.to_email_enc    := old.to_email_enc;
  new.to_email_hash   := old.to_email_hash;
  new.amount          := old.amount;
  new.note            := old.note;
  new.expense_id      := old.expense_id;
  new.person_id       := old.person_id;
  new.promptpay_enc   := old.promptpay_enc;
  new.image           := old.image;
  new.deleted         := old.deleted;
  new.created_at      := old.created_at;
  if new.status not in ('pending', 'paid') then  -- ยืนยันรับเงินได้เฉพาะเจ้าหนี้
    new.status := old.status;
  end if;
  return new;
end $guard$;

drop trigger if exists debt_claims_guard_trg on public.debt_claims_data;
create trigger debt_claims_guard_trg before update on public.debt_claims_data
  for each row execute function public.debt_claims_guard();

-- ---------- Webhook แจ้งเตือน push: ส่งข้อมูลที่ถอดรหัสแล้ว (เฉพาะช่องที่จำเป็น ไม่ส่งรูป/พร้อมเพย์) ----------
create or replace function public.claim_webhook_payload(op text, n public.debt_claims_data, o public.debt_claims_data) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'type', op, 'table', 'debt_claims', 'schema', 'public',
    'record', jsonb_build_object('id', n.id, 'from_user', n.from_user, 'from_email', public.pii_decrypt(n.from_email_enc),
      'from_name', n.from_name, 'to_email', public.pii_decrypt(n.to_email_enc), 'to_email_hash', n.to_email_hash,
      'amount', n.amount, 'note', n.note, 'status', n.status, 'reply', n.reply, 'deleted', n.deleted),
    'old_record', case when o.id is null then null else jsonb_build_object('id', o.id, 'amount', o.amount, 'status', o.status) end)
$$;
revoke all on function public.claim_webhook_payload(text, public.debt_claims_data, public.debt_claims_data) from public, anon, authenticated;

-- ถ้าเคยสร้าง trigger push_notify_hook (ผ่าน push-webhook.sql หรือระบบตั้งค่าอัตโนมัติ) ให้ปรับมาใช้ payload แบบถอดรหัสโดยอัตโนมัติ
do $$
declare src text; url text; secret text;
begin
  select prosrc into src from pg_proc where proname = 'push_notify_hook' and pronamespace = 'public'::regnamespace;
  if src is null then return; end if;
  url := (regexp_match(src, $re$url\s*:=\s*'([^']+)'$re$))[1];
  secret := (regexp_match(src, $re$x-webhook-secret"\s*:\s*"([^"]+)"$re$))[1];
  if url is null or secret is null then return; end if;
  execute format($f$
    create or replace function public.push_notify_hook() returns trigger
    language plpgsql security definer set search_path = public, extensions, net as $fn$
    begin
      perform net.http_post(
        url := %L,
        body := public.claim_webhook_payload(TG_OP, NEW, case when TG_OP = 'UPDATE' then OLD else null end),
        headers := %L::jsonb,
        timeout_milliseconds := 5000);
      return NEW;
    end $fn$;$f$, url, '{"Content-Type":"application/json","x-webhook-secret":"' || secret || '"}');
  drop trigger if exists push_notify_hook on public.debt_claims_data;
  execute 'create trigger push_notify_hook after insert or update on public.debt_claims_data for each row execute function public.push_notify_hook()';
end $$;

-- หมายเหตุ: รูปใบเสร็จไม่ถูกอัปโหลด เก็บอยู่ในเบราว์เซอร์ของแต่ละเครื่องเท่านั้น
