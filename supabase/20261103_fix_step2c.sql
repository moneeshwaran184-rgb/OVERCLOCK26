-- STEP 2C — admin review + grouped admin inbox.
-- Run without RLS. Expected: two rows, "STEP 2C OK" and "STEP 2C OK".

create or replace function public.campusops_review_grievance(
  p_id uuid,
  p_status text,
  p_response text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_root uuid;
  v_row record;
  v_response text := trim(coalesce(p_response,''));
begin
  if p_status not in ('new','in_progress','resolved') then
    raise exception 'Unknown grievance status';
  end if;
  if length(v_response)>4000 then raise exception 'Response is too long'; end if;

  select coalesce(duplicate_of,id) into v_root
  from public.campusops_grievances where id=p_id;
  if v_root is null then raise exception 'Grievance not found'; end if;

  if not exists(
    select 1 from public.campusops_grievances g
    join public.campusops_members m
      on m.college_id=g.college_id and m.user_id=auth.uid()
    where g.id=v_root and m.active and m.role='report_admin'
  ) then raise exception 'Report administrator required'; end if;

  for v_row in
    select id from public.campusops_grievances
    where id=v_root or duplicate_of=v_root
    for update
  loop
    update public.campusops_grievances
    set status=p_status,admin_response=v_response,updated_at=now()
    where id=v_row.id;

    insert into public.campusops_grievance_history(grievance_id,status,response)
    values(v_row.id,p_status,v_response);
  end loop;
end $$;

revoke all on function public.campusops_review_grievance(uuid,text,text) from public, anon;
grant execute on function public.campusops_review_grievance(uuid,text,text) to authenticated;

select 'STEP 2C OK' as result;

create or replace function public.campusops_admin_grievance_groups(
  p_college uuid,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(
    select 1 from public.campusops_members
    where college_id=p_college and user_id=auth.uid() and active and role='report_admin'
  ) then raise exception 'Report administrator required'; end if;

  return coalesce((
    select jsonb_agg(q.payload order by q.created_at desc)
    from (
      select g.created_at,
        to_jsonb(g)||jsonb_build_object(
          'student_name',m.full_name,
          'affected_count',1+(
            select count(*) from public.campusops_grievances d where d.duplicate_of=g.id
          ),
          'linked_reports',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',d.id,
              'description',d.description,
              'page',d.page,
              'status',d.status,
              'created_at',d.created_at,
              'student_name',dm.full_name
            ) order by d.created_at)
            from public.campusops_grievances d
            left join public.campusops_members dm
              on dm.college_id=d.college_id and dm.user_id=d.student_id
            where d.duplicate_of=g.id
          ),'[]'::jsonb)
        ) as payload
      from public.campusops_grievances g
      left join public.campusops_members m
        on m.college_id=g.college_id and m.user_id=g.student_id
      where g.college_id=p_college
        and g.kind='website'
        and g.channel='ai_help'
        and coalesce(g.ai_is_website_problem,true)
        and g.duplicate_of is null
      order by g.created_at desc,g.id
      offset greatest(coalesce(p_offset,0),0)
      limit least(greatest(coalesce(p_limit,20),1),50)
    ) q
  ),'[]'::jsonb);
end $$;

revoke all on function public.campusops_admin_grievance_groups(uuid,integer,integer) from public, anon;
grant execute on function public.campusops_admin_grievance_groups(uuid,integer,integer) to authenticated;

select 'STEP 2C OK' as result;
