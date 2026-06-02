alter table public.profiles
  add column sms_verified_at timestamptz,
  add column sms_verified_phone_e164 text,
  add column sms_consent_at timestamptz,
  add column sms_consent_text text,
  add column sms_consent_ip text,
  add column sms_consent_user_agent text;

create table public.sms_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_e164 text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index sms_verification_codes_user_created_idx
  on public.sms_verification_codes (user_id, created_at desc);

create index sms_verification_codes_expires_idx
  on public.sms_verification_codes (expires_at)
  where consumed_at is null;

update public.profiles
set sms_enabled = false
where sms_enabled = true
  and (sms_verified_at is null or sms_consent_at is null);

drop index if exists profiles_sms_due_idx;

create index profiles_sms_due_idx
  on public.profiles (daily_send_time, timezone)
  where sms_enabled = true
    and phone_e164 is not null
    and sms_verified_phone_e164 = phone_e164
    and sms_verified_at is not null
    and sms_consent_at is not null;

alter table public.sms_verification_codes enable row level security;

create policy "SMS verification codes are service-only"
  on public.sms_verification_codes for all
  using (false)
  with check (false);
