create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  masked_transactions jsonb not null,
  free_summary jsonb not null,
  premium_reports jsonb default null
);

create index analyses_user_id_created_at_idx
  on public.analyses (user_id, created_at desc);

alter table public.analyses enable row level security;

create policy "select_own_analyses" on public.analyses
  for select
  to authenticated
  using (auth.uid() = user_id);
