-- bootstrap(): runs on every sign-in and app open. Sets the person up and tells the app which shelf is theirs.
create function public.bootstrap(p_display_name text default null) returns uuid
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
  end if;

  return v_shelf;
end $$;

revoke all on function public.bootstrap(text) from public, anon;
grant execute on function public.bootstrap(text) to authenticated;

-- ping(): the keep-awake job calls this every few days so the free project never pauses.
create function public.ping() returns boolean language sql stable set search_path = '' as $$ select true $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
