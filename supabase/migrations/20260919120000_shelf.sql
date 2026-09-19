-- The Shelf: people, shelves, members, invites, records and ratings.
-- Picture: the shelf is a house, members hold keys, records sit on it, ratings are one sticky note per person.
-- Row-level security is on for every table; the app's rules and these rules are two locks on the same door.

create type public.genre as enum ('jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas');
create type public.grade as enum ('Sealed', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'P');
create type public.record_status as enum ('wanted', 'new_arrival', 'owned');
create type public.member_role as enum ('owner', 'member');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.shelves (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.shelf_members (
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (shelf_id, user_id)
);

create table public.shelf_invites (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (shelf_id, email)
);

create table public.records (
  id uuid primary key,
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  status public.record_status not null,
  wants_upgrade boolean not null default false,
  upgrade_note text,
  artist text not null check (length(trim(artist)) > 0),
  title text not null check (length(trim(title)) > 0),
  label text,
  catalog text,
  year smallint check (year between 1900 and 2100),
  format text,
  genre public.genre not null,
  disc_grade public.grade,
  sleeve_grade public.grade,
  price_paid numeric(8, 2) check (price_paid >= 0),
  nm_estimate_low numeric(8, 2) check (nm_estimate_low >= 0),
  nm_estimate_high numeric(8, 2) check (nm_estimate_high >= 0),
  value_note text,
  notes text,
  discogs_release_id integer check (discogs_release_id > 0),
  cover_path text,
  bought_at timestamptz,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  import_key text,
  unique (shelf_id, import_key),
  check ((nm_estimate_low is null) = (nm_estimate_high is null)),
  check (nm_estimate_low is null or nm_estimate_low <= nm_estimate_high)
);
create index records_shelf_updated on public.records (shelf_id, updated_at);

create table public.ratings (
  record_id uuid not null references public.records (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null check (value between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (record_id, user_id)
);
create index ratings_user on public.ratings (user_id);

-- Every change moves updated_at, which is how phones know what to pull.
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();
create trigger ratings_touch before update on public.ratings for each row execute function public.touch_updated_at();

-- Helpers run with the owner's rights so policies don't loop through shelf_members' own policy.
create function public.is_member(p_shelf uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shelf_members m where m.shelf_id = p_shelf and m.user_id = auth.uid())
$$;
create function public.is_owner(p_shelf uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shelf_members m where m.shelf_id = p_shelf and m.user_id = auth.uid() and m.role = 'owner')
$$;
create function public.shares_shelf_with(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shelf_members a join public.shelf_members b on a.shelf_id = b.shelf_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;
create function public.record_is_visible(p_record uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.records r join public.shelf_members m on m.shelf_id = r.shelf_id
    where r.id = p_record and m.user_id = auth.uid()
  )
$$;

alter table public.profiles enable row level security;
alter table public.shelves enable row level security;
alter table public.shelf_members enable row level security;
alter table public.shelf_invites enable row level security;
alter table public.records enable row level security;
alter table public.ratings enable row level security;

create policy "see yourself and shelf-mates" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_shelf_with(id));
create policy "rename yourself" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members see their shelves" on public.shelves for select to authenticated using (public.is_member(id));
create policy "owners rename shelves" on public.shelves for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy "members see who is on the shelf" on public.shelf_members for select to authenticated using (public.is_member(shelf_id));
create policy "owners remove other members" on public.shelf_members for delete to authenticated
  using (public.is_owner(shelf_id) and user_id <> auth.uid());

create policy "members see invites" on public.shelf_invites for select to authenticated using (public.is_member(shelf_id));
create policy "owners invite" on public.shelf_invites for insert to authenticated
  with check (public.is_owner(shelf_id) and invited_by = auth.uid());
create policy "owners cancel invites" on public.shelf_invites for delete to authenticated using (public.is_owner(shelf_id));

create policy "members see records" on public.records for select to authenticated using (public.is_member(shelf_id));
create policy "members add records" on public.records for insert to authenticated
  with check (public.is_member(shelf_id) and added_by = auth.uid());
create policy "members edit records" on public.records for update to authenticated
  using (public.is_member(shelf_id)) with check (public.is_member(shelf_id));

create policy "members see ratings" on public.ratings for select to authenticated using (public.record_is_visible(record_id));
create policy "rate for yourself" on public.ratings for insert to authenticated
  with check (user_id = auth.uid() and public.record_is_visible(record_id));
create policy "change your own rating" on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.record_is_visible(record_id));
create policy "remove your own rating" on public.ratings for delete to authenticated using (user_id = auth.uid());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on function public.is_member(uuid), public.is_owner(uuid), public.shares_shelf_with(uuid), public.record_is_visible(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_shelf_with(uuid), public.record_is_visible(uuid) to authenticated;
