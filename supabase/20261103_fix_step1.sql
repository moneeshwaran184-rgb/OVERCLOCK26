-- STEP 1 of 2 — CampusOps grievance columns + AI review table.
-- Paste ONLY this file, press Run, and check the result grid.
-- It should return exactly one row: STEP 1 OK
-- If it errors, the red message names the failing line — send that text.

alter table public.campusops_grievances add column if not exists page text not null default '';
alter table public.campusops_grievances add column if not exists status text not null default 'new';
alter table public.campusops_grievances add column if not exists admin_response text not null default '';
alter table public.campusops_grievances add column if not exists created_at timestamptz not null default now();
alter table public.campusops_grievances add column if not exists updated_at timestamptz not null default now();

alter table public.campusops_grievances add column if not exists kind text not null default 'website';
alter table public.campusops_grievances add column if not exists channel text not null default 'ai_help';
alter table public.campusops_grievances add column if not exists ai_is_website_problem boolean;
alter table public.campusops_grievances add column if not exists ai_category text;
alter table public.campusops_grievances add column if not exists ai_summary text;
alter table public.campusops_grievances add column if not exists ai_severity text;
alter table public.campusops_grievances add column if not exists ai_checked_at timestamptz;
alter table public.campusops_grievances add column if not exists duplicate_of uuid;
alter table public.campusops_grievances add column if not exists grouped_at timestamptz;

create index if not exists campusops_grievances_college_status_idx
  on public.campusops_grievances(college_id,status,created_at desc);
create index if not exists campusops_grievances_duplicate_of_idx
  on public.campusops_grievances(duplicate_of);

create table if not exists public.campusops_grievance_ai_reviews (
  pair_key text primary key,
  college_id uuid not null,
  source_id uuid not null,
  target_id uuid not null,
  verdict jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.campusops_grievance_ai_reviews enable row level security;
revoke all on public.campusops_grievance_ai_reviews from public, anon, authenticated;
grant all on public.campusops_grievance_ai_reviews to service_role;

select 'STEP 1 OK' as result,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='campusops_grievances'
            and column_name in ('kind','channel','duplicate_of','ai_category','grouped_at')) as new_columns,
       to_regclass('public.campusops_grievance_ai_reviews') is not null as ai_reviews_table;
