alter table public.profiles
  add column latitude numeric,
  add column longitude numeric,
  add column location_accuracy_m numeric,
  add column location_source text not null default 'manual' check (location_source in ('manual', 'browser'));

create index profiles_location_source_idx
  on public.profiles (location_source);
