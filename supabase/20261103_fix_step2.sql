-- STEP 2 of 2 — CampusOps grievance policies + RPCs.
-- Run this only after STEP 1 returned "STEP 1 OK".
-- Paste ONLY this file, press Run. The last grid must show 5 rows, all "ok".

-- Remove every older overload so PostgREST cannot get confused.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.proname in (
        'campusops_submit_grievance',
        'campusops_review_grievance',
        'campusops_admin_grievance_groups',
        'campusops_ai_grievance_candidates',
        'campusops_apply_ai_grievance_group'
      )
  loop
    execute 'drop function if exists '||r.sig;
  end loop;
end $$;

-- Policies + grants.
alter table public.campusops_grievances enable row level security;
alter table public.campusops_grievance_history enable row level security;

drop policy if exists grievance_student_read on public.campusops_grievances;
create policy grievance_student_read on public.campusops_grievances
  for select to authenticated
  using (student_id=auth.uid());

drop policy if exists grievance_admin_read on public.campusops_grievances;
create policy grievance_admin_read on public.campusops_grievances
  for select to authenticated
  using (exists(
    select 1 from public.campusops_members m
    where m.college_id=campusops_grievances.college_id
      and m.user_id=auth.uid() and m.active and m.role='report_admin'
  ));

drop policy if exists grievance_history_read on public.campusops_grievance_history;
create policy grievance_history_read on public.campusops_grievance_history
  for select to authenticated
  using (exists(
    select 1 from public.campusops_grievances g
    where g.id=campusops_grievance_history.grievance_id
      and (g.student_id=auth.uid() or exists(
        select 1 from public.campusops_members m
        where m.college_id=g.college_id
          and m.user_id=auth.uid() and m.active and m.role='report_admin'
      ))
  ));

grant select on public.campusops_grievances, public.campusops_grievance_history to authenticated;
revoke insert, update, delete on public.campusops_grievances, public.campusops_grievance_history from public, anon, authenticated;

-- Student submission.
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

-- Admin review (applies to the whole combined group).
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

-- Grouped admin inbox.
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

-- AI grouping candidates.
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

-- AI grouping writer (service role / Edge Function only).
create or replace function public.campusops_apply_ai_grievance_group(
  p_actor uuid,
  p_source jsonb,
  p_target jsonb,
  p_verdict jsonb
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  s public.campusops_grievances;
  t public.campusops_grievances;
  v_status text;
  v_response text;
begin
  select * into s from public.campusops_grievances where id=(p_source->>'id')::uuid;
  if not found then return false; end if;

  if not exists(
    select 1 from public.campusops_members
    where college_id=s.college_id and user_id=p_actor and active and role='report_admin'
  ) then raise exception 'Report administrator required'; end if;

  perform pg_advisory_xact_lock(hashtext('campusops_grievances:'||s.college_id::text));

  select * into s from public.campusops_grievances where id=(p_source->>'id')::uuid for update;
  select * into t from public.campusops_grievances
  where id=(p_target->>'id')::uuid and college_id=s.college_id for update;

  if not found or s.id=t.id then return false; end if;
  if s.duplicate_of is not null or t.duplicate_of is not null then return false; end if;
  if s.status='resolved' or t.status='resolved' then return false; end if;
  if p_verdict->>'duplicate'<>'true'
    or coalesce((p_verdict->>'confidence')::numeric,0)<0.9 then return false; end if;

  if s.description is distinct from p_source->>'description'
    or t.description is distinct from p_target->>'description'
    or coalesce(s.page,'') is distinct from coalesce(p_source->>'page','')
    or coalesce(t.page,'') is distinct from coalesce(p_target->>'page','')
  then return false; end if;

  v_status := case when s.status='in_progress' or t.status='in_progress'
                   then 'in_progress' else 'new' end;
  v_response := coalesce(nullif(t.admin_response,''),s.admin_response,'');

  update public.campusops_grievances
  set status=v_status,admin_response=v_response,updated_at=now()
  where id=t.id;

  update public.campusops_grievances
  set duplicate_of=t.id,status=v_status,admin_response=v_response,
      grouped_at=now(),updated_at=now()
  where duplicate_of=s.id;

  update public.campusops_grievances
  set duplicate_of=t.id,status=v_status,admin_response=v_response,
      grouped_at=now(),updated_at=now()
  where id=s.id;

  return true;
end $$;
revoke all on function public.campusops_apply_ai_grievance_group(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.campusops_apply_ai_grievance_group(uuid,jsonb,jsonb,jsonb) to service_role;

notify pgrst,'reload schema';

select 'campusops_submit_grievance' as item,
       case when to_regprocedure('public.campusops_submit_grievance(uuid,uuid,text,text)') is null then 'MISSING' else 'ok' end as state
union all select 'campusops_review_grievance',
       case when to_regprocedure('public.campusops_review_grievance(uuid,text,text)') is null then 'MISSING' else 'ok' end
union all select 'campusops_admin_grievance_groups',
       case when to_regprocedure('public.campusops_admin_grievance_groups(uuid,integer,integer)') is null then 'MISSING' else 'ok' end
union all select 'campusops_ai_grievance_candidates',
       case when to_regprocedure('public.campusops_ai_grievance_candidates(uuid)') is null then 'MISSING' else 'ok' end
union all select 'campusops_apply_ai_grievance_group',
       case when to_regprocedure('public.campusops_apply_ai_grievance_group(uuid,jsonb,jsonb,jsonb)') is null then 'MISSING' else 'ok' end
order by 1;
