-- Records Claude suggests for a shelf. The Edge Function writes new rows with the caller's own
-- sign-in, through the member insert policy; members read them and mark them added or dismissed.

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  artist text not null check (char_length(btrim(artist)) between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  reason text not null check (char_length(btrim(reason)) between 1 and 140),
  discogs_release_id int,
  discogs_genres text[] not null default '{}',
  discogs_styles text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  round_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suggestions_shelf_idx on public.suggestions (shelf_id);
create trigger suggestions_touch before insert or update on public.suggestions for each row execute function public.touch_updated_at();

revoke all on public.suggestions from anon, authenticated;
grant select, insert on public.suggestions to authenticated;
grant update (status, decided_by, decided_at) on public.suggestions to authenticated;

alter table public.suggestions enable row level security;
create policy suggestions_select on public.suggestions for select to authenticated using (public.is_member(shelf_id));
create policy suggestions_insert on public.suggestions for insert to authenticated
  with check (public.is_member(shelf_id) and status = 'pending');
create policy suggestions_update on public.suggestions for update to authenticated
  using (public.is_member(shelf_id) and (decided_by is null or decided_by = auth.uid()))
  with check (public.is_member(shelf_id) and (decided_by is null or decided_by = auth.uid()));
