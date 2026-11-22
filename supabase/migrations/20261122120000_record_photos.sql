-- A record's own front and back photos, kept in a private bucket readable only by the shelf's members.
alter table public.records
  add column back_path text,
  add constraint records_cover_path_shape check (cover_path is null
    or cover_path ~ ('^' || shelf_id::text || '/' || id::text || '/front-[0-9a-f-]{36}\.jpg$')),
  add constraint records_back_path_shape check (back_path is null
    or back_path ~ ('^' || shelf_id::text || '/' || id::text || '/back-[0-9a-f-]{36}\.jpg$'));

grant update (back_path) on public.records to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- The first folder of a photo's name is its shelf.
create function public.can_use_cover(p_name text) returns boolean language sql stable set search_path = '' as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_member(split_part(p_name, '/', 1)::uuid)
    else false
  end $$;
revoke all on function public.can_use_cover(text) from public, anon;
grant execute on function public.can_use_cover(text) to authenticated;

create policy "members see their shelf's photos" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members add photos to their shelf" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members replace their shelf's photos" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name)) with check (bucket_id = 'covers' and public.can_use_cover(name));
create policy "members remove their shelf's photos" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.can_use_cover(name));
