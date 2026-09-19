-- bootstrap(): runs on every sign-in and app open. Sets the person up and tells the app which shelf is theirs.
create function public.bootstrap(p_display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(auth.jwt() ->> 'email'));
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_shelf uuid;
  v_invite record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(v_name, nullif(split_part(v_email, '@', 1), ''), 'Me'))
  on conflict (id) do update set display_name = coalesce(v_name, public.profiles.display_name);

  for v_invite in
    select i.id, i.shelf_id from public.shelf_invites i where i.email = v_email and i.accepted_at is null
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
