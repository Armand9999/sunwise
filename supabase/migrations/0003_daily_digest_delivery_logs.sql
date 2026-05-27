create table public.daily_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recommendation_id uuid references public.daily_recommendations(id) on delete set null,
  delivery_date date not null,
  channel text not null default 'sms' check (channel in ('sms')),
  status text not null check (status in ('pending', 'sent', 'dry_run', 'skipped', 'failed')),
  provider text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, delivery_date, channel)
);

create index daily_digest_deliveries_status_idx
  on public.daily_digest_deliveries (status, created_at desc);

alter table public.daily_digest_deliveries enable row level security;

create policy "Users can read own digest deliveries"
  on public.daily_digest_deliveries for select
  using (auth.uid() = user_id);
