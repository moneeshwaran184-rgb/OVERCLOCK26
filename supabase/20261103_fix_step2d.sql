-- STEP 2D — AI candidates + AI grouping writer.
-- Run without RLS. Expected: one row per select, all "STEP 2D OK".

create or replace function public.campusops_ai_grievance_candidates(p_college uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(
    select 1 from public.campusops_members
    where college_id=p_college and user_id=auth.uid() and active and role='report_admin'
  ) then raise exception 'Report administrator required'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.created_at,q.id)
    from (
      select g.id,g.college_id,g.description,g.page,g.ai_category,g.status,g.created_at
      from public.campusops_grievances g
      where g.college_id=p_college
        and g.kind='website'
        and g.channel='ai_help'
        and coalesce(g.ai_is_website_problem,true)
        and g.duplicate_of is null
        and g.status<>'resolved'
      order by g.created_at,g.id
      limit 120
    ) q
  ),'[]'::jsonb);
end $$;

revoke all on function public.campusops_ai_grievance_candidates(uuid) from public, anon;
grant execute on function public.campusops_ai_grievance_candidates(uuid) to authenticated;

select 'STEP 2D OK' as result;
