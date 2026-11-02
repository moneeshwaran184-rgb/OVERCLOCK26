-- STEP 2E — AI grouping writer + final verification.
-- Run without RLS. Expected: 5 rows, all state = ok.

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
