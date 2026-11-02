-- STEP 2B — student submission function.
-- Run without RLS. Expected: one row, "STEP 2B OK".

create or replace function public.campusops_submit_grievance(
  p_id uuid default null,
  p_college uuid default null,
  p_description text default null,
  p_page text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid := coalesce(p_id,gen_random_uuid());
  v_row public.campusops_grievances;
  v_description text := trim(coalesce(p_description,''));
  v_page text := trim(coalesce(p_page,''));
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_college is null then raise exception 'College is required'; end if;
  if length(v_description)<10 or length(v_description)>6000 then
    raise exception 'Description must contain 10-6000 characters';
  end if;
  if length(v_page)>200 then raise exception 'Affected page is too long'; end if;
  if not exists(
    select 1 from public.campusops_members
    where college_id=p_college and user_id=auth.uid() and active and role='student'
  ) then raise exception 'Active student membership required'; end if;

  select * into v_row from public.campusops_grievances where id=v_id;
  if found then
    if v_row.student_id<>auth.uid() or v_row.college_id<>p_college then
      raise exception 'This reference is already in use';
    end if;
    return v_id;
  end if;

  if (select count(*) from public.campusops_grievances
      where student_id=auth.uid() and college_id=p_college
        and created_at>now()-interval '1 hour')>=10
  then raise exception 'Grievance limit reached (10 per hour). Please try again later.'; end if;

  insert into public.campusops_grievances(
    id,college_id,student_id,description,page,status,admin_response,
    kind,channel,duplicate_of,created_at,updated_at
  ) values(
    v_id,p_college,auth.uid(),v_description,v_page,'new','',
    'website','ai_help',null,now(),now()
  );

  insert into public.campusops_grievance_history(grievance_id,status,response)
  values(v_id,'new','');

  return v_id;
end $$;

revoke all on function public.campusops_submit_grievance(uuid,uuid,text,text) from public, anon;
grant execute on function public.campusops_submit_grievance(uuid,uuid,text,text) to authenticated;

select 'STEP 2B OK' as result;
