-- Each shelf gets its own sections (the dividers on that person's real shelf), and records point at one.
-- Picture: the nine fixed genre cards become dividers each shelf owns; a record sits behind one divider.
-- Changeover: phones still on the old app read and write records.genre. Each section carries the old
-- genre it replaces (legacy_genre), and a trigger keeps records.genre and records.section_id in step,
-- whichever one a phone writes. The genre column and these triggers go in a later plan.

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null check (color in (
    'jazz', 'rock', 'popsoul', 'popularpop', 'misc', 'country', 'reggae', 'soundtracks', 'christmas', 'teal', 'slate', 'sand'
  )),
  position int not null,
  discogs_genres text[] not null default '{}' check (discogs_genres <@ array[
    'Blues', 'Brass & Military', 'Children''s', 'Classical', 'Electronic', 'Folk, World, & Country', 'Funk / Soul',
    'Hip Hop', 'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'
  ]::text[]),
  takes_holiday boolean not null default false,
  is_catch_all boolean not null default false,
  legacy_genre public.genre not null default 'misc',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sections_one_catch_all on public.sections (shelf_id) where is_catch_all;
create unique index sections_one_holiday on public.sections (shelf_id) where takes_holiday;
create trigger sections_touch before insert or update on public.sections for each row execute function public.touch_updated_at();

-- Where a merged section's records went, so a late write from another phone lands on the survivor.
create table public.section_redirects (
  from_id uuid primary key,
  into_id uuid not null,
  shelf_id uuid not null references public.shelves (id) on delete cascade
);

alter table public.records add column section_id uuid references public.sections (id) on delete restrict;

-- The ids the migration and bootstrap() give the sets: the phone works out the same one itself.
create function public.section_id_for(p_shelf uuid, p_genre public.genre) returns uuid
language sql immutable set search_path = '' as $$
  select md5(p_shelf::text || ':' || p_genre::text)::uuid
$$;

-- Kahrman's nine (his real dividers) or the starter set, at positions 0–8.
create function public.seed_sections(p_shelf uuid, p_kahrmans boolean) returns void
language sql set search_path = '' as $$
  insert into public.sections (id, shelf_id, name, color, position, discogs_genres, takes_holiday, is_catch_all, legacy_genre)
  select public.section_id_for(p_shelf, x.legacy_genre), p_shelf, x.name, x.legacy_genre::text, x.position, x.discogs_genres,
    x.takes_holiday, x.is_catch_all, x.legacy_genre
  from (
    values
      (true, 0, 'jazz'::public.genre, 'Jazz / big band', '{Jazz}'::text[], false, false),
      (true, 1, 'rock', 'Rock', '{Rock}', false, false),
      (true, 2, 'popsoul', 'Pop / soul / contemporary', '{"Funk / Soul"}', false, false),
      (true, 3, 'popularpop', 'Popular pop', '{Pop}', false, false),
      (true, 4, 'misc', 'Miscellaneous', '{}', false, true),
      (true, 5, 'country', 'Country', '{"Folk, World, & Country"}', false, false),
      (true, 6, 'reggae', 'Reggae', '{Reggae}', false, false),
      (true, 7, 'soundtracks', 'Soundtracks', '{"Stage & Screen"}', false, false),
      (true, 8, 'christmas', 'Christmas', '{}', true, false),
      (false, 0, 'jazz', 'Jazz', '{Jazz}', false, false),
      (false, 1, 'rock', 'Rock', '{Rock}', false, false),
      (false, 2, 'popsoul', 'Soul & Funk', '{"Funk / Soul"}', false, false),
      (false, 3, 'popularpop', 'Pop', '{Pop}', false, false),
      (false, 4, 'country', 'Country & Folk', '{"Folk, World, & Country"}', false, false),
      (false, 5, 'reggae', 'Reggae', '{Reggae}', false, false),
      (false, 6, 'soundtracks', 'Soundtracks', '{"Stage & Screen"}', false, false),
      (false, 7, 'christmas', 'Christmas', '{}', true, false),
      (false, 8, 'misc', 'Everything else', '{}', false, true)
  ) as x (kahrmans, position, legacy_genre, name, discogs_genres, takes_holiday, is_catch_all)
  where x.kahrmans = p_kahrmans
$$;

-- The changeover, on every record write. In order:
--   1. an old-app write (no section on insert, or only the genre changed) moves to the genre's section,
--      or, if that was merged away, to the section derived from the genre, which step 2 then follows;
--   2. a section that was merged away is followed to its survivor; an unknown one means the catch-all;
--   3. a section from another shelf is refused;
--   4. genre is set from the section, so old phones keep reading the right one.
create function public.records_fill_section() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := new.section_id;
  v_section public.sections%rowtype;
begin
  if new.section_id is null
     or (tg_op = 'UPDATE' and new.genre is distinct from old.genre and new.section_id is not distinct from old.section_id) then
    select s.id into v_id from public.sections s
    where s.shelf_id = new.shelf_id and s.legacy_genre = new.genre
    order by s.position, s.id limit 1;
    v_id := coalesce(v_id, public.section_id_for(new.shelf_id, new.genre));
  end if;

  -- The key-share lock waits out a merge in flight on this section (it holds the row for update),
  -- then finds the row gone and reads the redirect that merge committed, instead of failing the
  -- foreign key check later.
  for hop in 1..10 loop
    exit when v_id is null;
    perform 1 from public.sections s where s.id = v_id for key share;
    exit when found;
    select r.into_id into v_id from public.section_redirects r where r.from_id = v_id;
  end loop;

  select * into v_section from public.sections s where s.id = v_id;
  if not found then
    select * into v_section from public.sections s where s.shelf_id = new.shelf_id and s.is_catch_all;
    if not found then
      raise exception 'shelf has no catch-all section';
    end if;
  end if;

  if v_section.shelf_id <> new.shelf_id then
    raise exception 'section belongs to another shelf';
  end if;

  new.section_id := v_section.id;
  new.genre := v_section.legacy_genre;
  return new;
end $$;
revoke execute on function public.records_fill_section() from public, anon, authenticated;

-- One holiday section and one owner per Discogs genre on a shelf: the section that claims one takes it
-- off the others. Those updates run one trigger level down, where this trigger lets them through as-is.
create function public.sections_claim() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Depth 1 is a write made by the app, merge_section(), bootstrap() or a migration; deeper is this
  -- trigger's own updates below. Two consequences: section writes must be one row per statement (two
  -- rows claiming the same genre in one statement aren't checked against each other), and a section
  -- written from inside some other trigger skips claims entirely.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.takes_holiday and (tg_op = 'INSERT' or not old.takes_holiday) then
    update public.sections s set takes_holiday = false
    where s.shelf_id = new.shelf_id and s.id <> new.id and s.takes_holiday;
  end if;

  if tg_op = 'INSERT' or new.discogs_genres is distinct from old.discogs_genres then
    update public.sections s
    set discogs_genres = array(
      select g from unnest(s.discogs_genres) with ordinality as t (g, n) where g <> all (new.discogs_genres) order by n
    )
    where s.shelf_id = new.shelf_id and s.id <> new.id and s.discogs_genres && new.discogs_genres;
  end if;

  return new;
end $$;
revoke execute on function public.sections_claim() from public, anon, authenticated;
create trigger sections_claim before insert or update on public.sections for each row execute function public.sections_claim();

-- Moves every record (deleted ones too) from one section into another on the same shelf, hands over
-- its Discogs genres and holiday flag, leaves a redirect for late writes, and removes it.
-- Runs with the caller's own rights, so the rules below apply to every step.
create function public.merge_section(p_from uuid, p_into uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_from public.sections%rowtype;
  v_into public.sections%rowtype;
begin
  if p_from = p_into then
    raise exception 'a section can''t be merged into itself';
  end if;

  -- Locked in id order, so two merges racing over the same pair wait rather than deadlock.
  perform 1 from public.sections s where s.id in (p_from, p_into) order by s.id for update;
  select * into v_from from public.sections s where s.id = p_from;
  select * into v_into from public.sections s where s.id = p_into;

  if v_from.id is null or v_into.id is null then
    raise exception 'section not found';
  end if;
  if v_from.shelf_id <> v_into.shelf_id then
    raise exception 'sections are on different shelves';
  end if;
  if not public.is_member(v_from.shelf_id) then
    raise exception 'not a member of this shelf';
  end if;
  if v_from.is_catch_all then
    raise exception 'the catch-all section can''t be merged away';
  end if;

  update public.records set section_id = p_into where section_id = p_from;

  update public.sections s set
    discogs_genres = s.discogs_genres || array(
      select g from unnest(v_from.discogs_genres) with ordinality as t (g, n) where g <> all (s.discogs_genres) order by n
    ),
    takes_holiday = s.takes_holiday or v_from.takes_holiday
  where s.id = p_into;

  -- A redirect already written from this section (by hand, before any merge) gives way to this one.
  insert into public.section_redirects (from_id, into_id, shelf_id) values (p_from, p_into, v_from.shelf_id)
  on conflict (from_id) do update set into_id = excluded.into_id;
  update public.section_redirects r set into_id = p_into where r.into_id = p_from;

  delete from public.sections s where s.id = p_from;
  if not found then
    raise exception 'section could not be removed';
  end if;
end $$;
revoke all on function public.merge_section(uuid, uuid) from public, anon;
grant execute on function public.merge_section(uuid, uuid) to authenticated;

revoke all on function public.section_id_for(uuid, public.genre), public.seed_sections(uuid, boolean) from public, anon, authenticated;

-- Existing shelves: Kahrman's (the one with imported records) keeps his nine, every other gets the starter set.
select public.seed_sections(s.id, exists (select 1 from public.records r where r.shelf_id = s.id and r.import_key is not null))
from public.shelves s;

-- The trigger goes on before the backfill, so a record written meanwhile is placed too, even if this
-- file isn't run as one transaction.
create trigger records_section before insert or update on public.records for each row execute function public.records_fill_section();

update public.records set section_id = public.section_id_for(shelf_id, genre);
alter table public.records alter column section_id set not null;
create index records_section on public.records (section_id);

-- bootstrap(): same body as 20261111120100_bootstrap_requires_email.sql, plus seeding a new shelf's sections.
create or replace function public.bootstrap(p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  -- The JWT's email claim can be set by someone who never confirmed it (e.g. password
  -- sign-up with confirmations off), so it is only trusted for the display-name fallback,
  -- never for matching invites.
  v_jwt_email text := lower(trim(auth.jwt() ->> 'email'));
  v_verified_email text;
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_has_own_records boolean;
  v_shelf uuid;
  v_invite record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if v_jwt_email is null or v_jwt_email = '' then
    raise exception 'Sign-in has no email';
  end if;

  if v_name is not null and length(v_name) > 60 then
    raise exception 'Name is too long';
  end if;

  -- Must run first: this row lock on the caller's profile serializes concurrent
  -- bootstrap() calls for the same person, so the invite-acceptance and shelf-selection
  -- below never race against another in-flight call for the same uid.
  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(v_name, nullif(split_part(v_jwt_email, '@', 1), ''), 'Me'))
  on conflict (id) do update set display_name = coalesce(v_name, public.profiles.display_name);

  -- Invites are only accepted on a verified email; unconfirmed accounts accept none.
  select lower(trim(u.email)) into v_verified_email
  from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;

  -- People who already own a shelf with records on it keep it: open invites stay
  -- unaccepted rather than silently switching them onto someone else's shelf.
  select exists (
    select 1 from public.shelves s
    where s.created_by = v_uid and exists (select 1 from public.records r where r.shelf_id = s.id)
  ) into v_has_own_records;

  if v_verified_email is not null and not v_has_own_records then
    for v_invite in
      select i.id, i.shelf_id from public.shelf_invites i where i.email = v_verified_email and i.accepted_at is null
    loop
      insert into public.shelf_members (shelf_id, user_id, role) values (v_invite.shelf_id, v_uid, 'member')
      on conflict (shelf_id, user_id) do nothing;
      update public.shelf_invites set accepted_at = now() where id = v_invite.id;

      -- One shelf per person for now: drop their own shelves that are empty and unshared.
      delete from public.shelves s
      where s.created_by = v_uid
        and s.id <> v_invite.shelf_id
        and not exists (select 1 from public.records r where r.shelf_id = s.id)
        and (select count(*) from public.shelf_members m where m.shelf_id = s.id) = 1;
    end loop;
  end if;

  select m.shelf_id into v_shelf
  from public.shelf_members m where m.user_id = v_uid
  order by m.created_at desc limit 1;

  if v_shelf is null then
    insert into public.shelves (name, created_by) values ('The Shelf', v_uid) returning id into v_shelf;
    insert into public.shelf_members (shelf_id, user_id, role) values (v_shelf, v_uid, 'owner');
    perform public.seed_sections(v_shelf, false);
  end if;

  return v_shelf;
end $$;

revoke all on function public.bootstrap(text) from public, anon;
grant execute on function public.bootstrap(text) to authenticated;

-- Rules. Hosted Supabase grants everything on new tables to anon and authenticated, so start from nothing.
alter table public.sections enable row level security;
alter table public.section_redirects enable row level security;
revoke all on public.sections, public.section_redirects from anon, authenticated;

grant select, insert, delete on public.sections to authenticated;
-- Which shelf a section is on, whether it's the catch-all and the old genre it stands for are fixed.
grant update (name, color, position, discogs_genres, takes_holiday) on public.sections to authenticated;
create policy "members see sections" on public.sections for select to authenticated using (public.is_member(shelf_id));
create policy "members add sections" on public.sections for insert to authenticated
  with check (public.is_member(shelf_id) and not is_catch_all and legacy_genre = 'misc');
create policy "members edit sections" on public.sections for update to authenticated
  using (public.is_member(shelf_id)) with check (public.is_member(shelf_id));
-- A section with records (deleted ones too) is also refused, by records' foreign key.
create policy "members remove sections, never the catch-all" on public.sections for delete to authenticated
  using (public.is_member(shelf_id) and not is_catch_all);

-- merge_section() runs with the caller's rights, so it writes redirects as them: only between two live
-- sections on their own shelf, never away from the catch-all.
grant select, insert on public.section_redirects to authenticated;
grant update (into_id) on public.section_redirects to authenticated;
create policy "members see redirects" on public.section_redirects for select to authenticated using (public.is_member(shelf_id));
create policy "merging records a redirect" on public.section_redirects for insert to authenticated
  with check (
    public.is_member(shelf_id)
    and exists (select 1 from public.sections s where s.id = from_id and s.shelf_id = section_redirects.shelf_id and not s.is_catch_all)
    and exists (select 1 from public.sections s where s.id = into_id and s.shelf_id = section_redirects.shelf_id)
  );
create policy "merging re-points redirects" on public.section_redirects for update to authenticated
  using (public.is_member(shelf_id))
  with check (
    public.is_member(shelf_id)
    and exists (select 1 from public.sections s where s.id = into_id and s.shelf_id = section_redirects.shelf_id)
  );

grant update (section_id) on public.records to authenticated;
