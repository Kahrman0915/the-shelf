-- A first rating means someone has played it: move it from New arrivals onto the shelf.
-- Runs with the rater's own rights (they already hold update(status) and pass "members edit records").
create function public.shelve_on_first_rating() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.records set status = 'owned' where id = new.record_id and status = 'new_arrival';
  return null;
end $$;
revoke execute on function public.shelve_on_first_rating() from public, anon, authenticated;
create trigger ratings_shelve_on_first_rating after insert on public.ratings
  for each row execute function public.shelve_on_first_rating();
