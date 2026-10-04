-- familiacb — schema inicial
-- Execute no SQL Editor do Supabase (ou via `supabase db push`).
-- Princípio: o navegador NUNCA lê credenciais; tabelas sensíveis não têm policies
-- para usuários e só são acessadas pelo servidor com a service role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Perfis
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  role            text not null default 'member' check (role in ('admin','member')),
  limit_per_op    numeric(14,2) not null default 5000 check (limit_per_op > 0),
  limit_per_day   numeric(14,2) not null default 15000 check (limit_per_day > 0),
  disabled        boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "perfil: ler o próprio"
  on public.profiles for select
  using (auth.uid() = id);
-- Sem policy de update/insert/delete: só o servidor altera perfis.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Credenciais das exchanges (cifradas com AES-256-GCM no servidor)
-- ---------------------------------------------------------------------------
create table public.exchange_credentials (
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('mercadobitcoin','bitso')),
  key_hint      text not null,              -- últimos 4 caracteres do id da chave
  ciphertext    text not null,              -- base64
  iv            text not null,              -- base64 (12 bytes)
  auth_tag      text not null,              -- base64 (16 bytes)
  key_version   smallint not null default 1,
  validated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.exchange_credentials enable row level security;
-- Nenhuma policy: inacessível com a chave anon/sessão do usuário.

-- ---------------------------------------------------------------------------
-- Configurações do usuário (dados não secretos)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  mb_account_id         text,
  bitso_usdt_address    text,          -- endereço de depósito USDT (Polygon) na Bitso
  travel_rule_name      text,          -- nome do titular para a Travel Rule
  updated_at            timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "config: ler a própria" on public.user_settings
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Contas bancárias argentinas salvas (CBU / CVU / alias)
-- ---------------------------------------------------------------------------
create table public.bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 40),
  kind        text not null check (kind in ('cbu','cvu','alias')),
  value       text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, value)
);
alter table public.bank_accounts enable row level security;
create policy "contas: ler as próprias" on public.bank_accounts
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Operações (máquina de estados)
-- ---------------------------------------------------------------------------
create table public.operations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  status              text not null default 'created',
  failed_at_status    text,
  error_message       text,
  input_mode          text not null check (input_mode in ('brl','ars')),
  brl_amount          numeric(14,2) not null check (brl_amount > 0),
  network             text not null default 'polygon',
  estimate            jsonb not null,           -- cotação mostrada na confirmação
  -- Mercado Bitcoin
  mb_external_id      text not null,
  mb_order_id         text,
  mb_avg_price        numeric(20,8),
  usdt_bought         numeric(20,8),
  mb_trade_fee_usdt   numeric(20,8),
  mb_withdraw_id      text,
  mb_withdraw_fee     numeric(20,8),
  usdt_withdrawn      numeric(20,8),
  withdraw_tx         text,
  withdraw_sent_at    timestamptz,
  -- Bitso
  bitso_funding_id    text,
  usdt_received       numeric(20,8),
  bitso_origin_id     text not null,
  bitso_order_id      text,
  usdt_sold           numeric(20,8),
  bitso_avg_price     numeric(20,8),
  bitso_fee_ars       numeric(20,2),
  ars_received        numeric(20,2),
  -- controle
  lock_until          timestamptz,
  next_check_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index operations_user_created on public.operations (user_id, created_at desc);
-- Apenas UMA operação ativa por usuário.
create unique index operations_one_active_per_user on public.operations (user_id)
  where status not in ('completed','failed');

alter table public.operations enable row level security;
create policy "operações: ler as próprias" on public.operations
  for select using (auth.uid() = user_id);

create table public.operation_events (
  id            bigint generated always as identity primary key,
  operation_id  uuid not null references public.operations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null,
  kind          text not null check (kind in ('info','step','warning','error')),
  message       text not null,
  data          jsonb,
  created_at    timestamptz not null default now()
);
create index operation_events_op on public.operation_events (operation_id, id);
alter table public.operation_events enable row level security;
create policy "eventos: ler os próprios" on public.operation_events
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Saques em pesos (Bitso → CBU/CVU/alias)
-- ---------------------------------------------------------------------------
create table public.payouts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  operation_id        uuid references public.operations(id) on delete set null,
  amount_ars          numeric(20,2) not null check (amount_ars > 0),
  destination_kind    text not null check (destination_kind in ('cbu','cvu','alias')),
  destination_masked  text not null,
  origin_id           text not null unique,
  bitso_wid           text,
  status              text not null default 'submitted',
  error_message       text,
  created_at          timestamptz not null default now()
);
alter table public.payouts enable row level security;
create policy "saques: ler os próprios" on public.payouts
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auditoria, rate limit e anti-replay de códigos 2FA
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  action      text not null,
  ip          text,
  user_agent  text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
alter table public.audit_log enable row level security;

create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  count         integer not null
);
alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                     then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                     then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke all on function public.check_rate_limit(text,int,int) from public, anon, authenticated;

create table public.totp_used (
  user_id     uuid not null,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, code_hash)
);
alter table public.totp_used enable row level security;

-- ---------------------------------------------------------------------------
-- Criação atômica de operação com verificação de limites
-- (lock por usuário evita duas operações simultâneas furarem o limite diário)
-- ---------------------------------------------------------------------------
create or replace function public.create_operation(
  p_user_id uuid, p_input_mode text, p_brl numeric, p_estimate jsonb
) returns public.operations
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
  v_today numeric;
  v_op public.operations;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform pg_advisory_xact_lock(hashtext('op:' || p_user_id::text));

  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null or v_profile.disabled then
    raise exception 'USUARIO_BLOQUEADO';
  end if;
  if p_brl > v_profile.limit_per_op then
    raise exception 'LIMITE_POR_OPERACAO';
  end if;

  select coalesce(sum(brl_amount),0) into v_today
    from public.operations
   where user_id = p_user_id
     and created_at >= v_day_start
     and not (status = 'failed' and mb_order_id is null);   -- falhas antes da compra não contam
  if v_today + p_brl > v_profile.limit_per_day then
    raise exception 'LIMITE_DIARIO';
  end if;

  insert into public.operations (user_id, input_mode, brl_amount, estimate, mb_external_id, bitso_origin_id)
  values (p_user_id, p_input_mode, p_brl, p_estimate,
          'fcb' || replace(gen_random_uuid()::text,'-',''),
          'fcb-' || replace(gen_random_uuid()::text,'-',''))
  returning * into v_op;
  return v_op;
end $$;
revoke all on function public.create_operation(uuid,text,numeric,jsonb) from public, anon, authenticated;

-- Limpeza periódica (opcional): rode manualmente ou via pg_cron
-- delete from public.totp_used where created_at < now() - interval '1 day';
-- delete from public.rate_limits where window_start < now() - interval '1 day';
