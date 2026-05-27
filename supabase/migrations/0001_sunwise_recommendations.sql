create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.activity_intensity as enum ('Easy', 'Balanced', 'Active');
create type public.activity_venue as enum ('Outdoor', 'Mixed', 'Indoor');
create type public.outfit_style as enum ('Breezy', 'Sporty', 'Polished');
create type public.recommendation_source as enum ('openai', 'local');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  location text not null default 'Toronto',
  phone_e164 text,
  sms_enabled boolean not null default false,
  daily_send_time time not null default '08:00',
  timezone text not null default 'America/Toronto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.preference_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hobbies text[] not null default '{}',
  intensity public.activity_intensity not null default 'Balanced',
  venue public.activity_venue not null default 'Mixed',
  heat_sensitive boolean not null default false,
  sun_sensitive boolean not null default false,
  budget integer not null default 35 check (budget >= 0 and budget <= 1000),
  accessibility boolean not null default false,
  accessibility_notes text,
  outfit_style public.outfit_style not null default 'Breezy',
  preference_embedding extensions.vector(1536),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  hobbies text[] not null default '{}',
  intensity public.activity_intensity not null,
  venue public.activity_venue not null,
  estimated_cost integer not null default 0 check (estimated_cost >= 0),
  weather_tags text[] not null default '{}',
  accessibility_notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.activity_embeddings (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  embedding extensions.vector(1536) not null,
  embedding_model text not null default 'text-embedding-3-small',
  content_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.daily_forecasts (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  forecast_date date not null,
  provider text not null,
  payload jsonb not null,
  summary text not null,
  temperature_c numeric not null,
  feels_like_c numeric not null,
  uv_index numeric not null,
  rain_chance numeric not null,
  wind_kph numeric not null,
  humidity numeric not null,
  heat_risk text not null,
  best_window text not null,
  created_at timestamptz not null default now(),
  unique (location, forecast_date, provider)
);

create table public.daily_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  forecast_id uuid references public.daily_forecasts(id) on delete set null,
  recommendation_date date not null default current_date,
  source public.recommendation_source not null,
  model text,
  recommendations jsonb not null,
  outfit text not null,
  sms_copy text not null,
  guardrails_applied text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.daily_recommendations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_slug text,
  action text not null check (action in ('clicked', 'saved', 'dismissed', 'completed', 'thumbs_up', 'thumbs_down')),
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));

  insert into public.preference_profiles (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create index profiles_sms_due_idx
  on public.profiles (daily_send_time, timezone)
  where sms_enabled = true and phone_e164 is not null;

create index activities_active_venue_idx
  on public.activities (venue, intensity)
  where active = true;

create index activities_hobbies_gin_idx
  on public.activities using gin (hobbies);

create index daily_forecasts_lookup_idx
  on public.daily_forecasts (location, forecast_date desc);

create index daily_recommendations_user_date_idx
  on public.daily_recommendations (user_id, recommendation_date desc);

create index recommendation_feedback_user_action_idx
  on public.recommendation_feedback (user_id, action, created_at desc);

create index activity_embeddings_vector_idx
  on public.activity_embeddings
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

alter table public.profiles enable row level security;
alter table public.preference_profiles enable row level security;
alter table public.daily_recommendations enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table public.activities enable row level security;
alter table public.activity_embeddings enable row level security;
alter table public.daily_forecasts enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can read own preferences"
  on public.preference_profiles for select
  using (auth.uid() = user_id);

create policy "Users can upsert own preferences"
  on public.preference_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read own recommendations"
  on public.daily_recommendations for select
  using (auth.uid() = user_id);

create policy "Users can insert own feedback"
  on public.recommendation_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can read own feedback"
  on public.recommendation_feedback for select
  using (auth.uid() = user_id);

create policy "Activities are readable"
  on public.activities for select
  using (active = true);

create policy "Forecasts are readable"
  on public.daily_forecasts for select
  using (true);

create policy "Activity embeddings are service-only"
  on public.activity_embeddings for all
  using (false)
  with check (false);
