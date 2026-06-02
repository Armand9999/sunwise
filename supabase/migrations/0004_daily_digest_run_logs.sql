create table public.daily_digest_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'manual' check (trigger_source in ('cron', 'manual', 'admin', 'api')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  window_minutes integer not null check (window_minutes > 0),
  limit_count integer not null check (limit_count > 0),
  checked integer not null default 0,
  due integer not null default 0,
  sent integer not null default 0,
  dry_run integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index daily_digest_runs_started_at_idx
  on public.daily_digest_runs (started_at desc);

create index daily_digest_runs_status_idx
  on public.daily_digest_runs (status, started_at desc);

alter table public.daily_digest_runs enable row level security;

create policy "Digest runs are service-only"
  on public.daily_digest_runs for all
  using (false)
  with check (false);
