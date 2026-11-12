-- A fun fact about a record, where it came from, and a link to a cover image.
alter table public.records
  add column fun_fact text,
  add column fun_fact_source text,
  add column cover_image_url text,
  add constraint records_fun_fact_length check (fun_fact is null or char_length(fun_fact) <= 500),
  add constraint records_fun_fact_source_https check (fun_fact_source is null or (fun_fact_source like 'https://%' and fun_fact is not null)),
  add constraint records_cover_image_url_https check (cover_image_url is null or cover_image_url like 'https://%');

grant update (fun_fact, fun_fact_source, cover_image_url) on public.records to authenticated;
