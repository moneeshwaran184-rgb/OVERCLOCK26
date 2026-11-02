-- STEP 2A — drop old overloads, recreate policies.
-- Run without RLS. Expected: one row, "STEP 2A OK".

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

select 'STEP 2A OK' as result;
