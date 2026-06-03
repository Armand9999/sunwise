alter table public.profiles
  add column sms_opted_out_at timestamptz,
  add column sms_opt_out_keyword text;

create table public.sms_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  from_phone_e164 text not null,
  to_phone_e164 text,
  body text not null default '',
  normalized_body text not null default '',
  keyword text,
  action text not null default 'unknown' check (action in ('stop', 'help', 'start', 'unknown')),
  provider text not null default 'twilio',
  provider_message_id text,
  signature_valid boolean not null default false,
  response_body text,
  created_at timestamptz not null default now()
);

create index sms_inbound_messages_phone_created_idx
  on public.sms_inbound_messages (from_phone_e164, created_at desc);

create index sms_inbound_messages_action_created_idx
  on public.sms_inbound_messages (action, created_at desc);

drop index if exists profiles_sms_due_idx;

create index profiles_sms_due_idx
  on public.profiles (daily_send_time, timezone)
  where sms_enabled = true
    and phone_e164 is not null
    and sms_verified_phone_e164 = phone_e164
    and sms_verified_at is not null
    and sms_consent_at is not null
    and sms_opted_out_at is null;

alter table public.sms_inbound_messages enable row level security;

create policy "SMS inbound messages are service-only"
  on public.sms_inbound_messages for all
  using (false)
  with check (false);
