-- CampusOps — Grievance Redressal fix (run this ONE file in the Supabase SQL Editor).
--
-- Why this file exists:
--   The first version wrapped everything in BEGIN/COMMIT, so any single error rolled
--   the whole migration back and nothing was created. It also did not remove the older
--   overloads of campusops_submit_grievance / campusops_review_grievance, which left
--   PostgREST unable to pick a function.
--
-- This version:
--   * has NO transaction wrapper, so every section commits on its own;
--   * is fully idempotent (safe to run again and again);
--   * drops the legacy function overloads first;
--   * prints a verification table at the end.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste ALL of this ->
--   press "Run" (not "Run and enable RLS").
-- If a statement fails, the editor shows the failing section number. Send that error.

-- ═══ 1. Legacy function overloads ═══════════════════════════════════════════
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

-- ═══ 2. Base tables (no-ops when they already exist) ════════════════════════
CREATE TABLE IF NOT EXISTS public.campusops_grievances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.campusops_colleges(id),
  student_id uuid NOT NULL,
  description text NOT NULL,
  page text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  admin_response text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS page text NOT NULL DEFAULT '';
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS admin_response text NOT NULL DEFAULT '';
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ═══ 3. Classification + AI grouping columns ════════════════════════════════
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'website';
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'ai_help';
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS ai_is_website_problem boolean;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS ai_category text;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS ai_severity text;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS duplicate_of uuid;
ALTER TABLE public.campusops_grievances ADD COLUMN IF NOT EXISTS grouped_at timestamptz;

CREATE INDEX IF NOT EXISTS campusops_grievances_college_status_idx
  ON public.campusops_grievances(college_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS campusops_grievances_duplicate_of_idx
  ON public.campusops_grievances(duplicate_of);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='campusops_grievances_duplicate_of_fkey'
      AND conrelid='public.campusops_grievances'::regclass
  ) THEN
    ALTER TABLE public.campusops_grievances
      ADD CONSTRAINT campusops_grievances_duplicate_of_fkey
      FOREIGN KEY (duplicate_of) REFERENCES public.campusops_grievances(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══ 4. History / usage / AI review cache tables ════════════════════════════
CREATE TABLE IF NOT EXISTS public.campusops_grievance_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grievance_id uuid NOT NULL REFERENCES public.campusops_grievances(id) ON DELETE CASCADE,
  status text NOT NULL,
  response text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campusops_grievance_history ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
ALTER TABLE public.campusops_grievance_history ADD COLUMN IF NOT EXISTS response text NOT NULL DEFAULT '';
ALTER TABLE public.campusops_grievance_history ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS campusops_grievance_history_grievance_idx
  ON public.campusops_grievance_history(grievance_id,created_at);

CREATE TABLE IF NOT EXISTS public.campusops_chat_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  college_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campusops_chat_usage ADD COLUMN IF NOT EXISTS college_id uuid;
ALTER TABLE public.campusops_chat_usage ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS campusops_chat_usage_user_created_idx
  ON public.campusops_chat_usage(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.campusops_grievance_ai_reviews (
  pair_key text PRIMARY KEY,
  college_id uuid NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  verdict jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ 5. Row level security ══════════════════════════════════════════════════
ALTER TABLE public.campusops_grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_grievance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_grievance_ai_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_chat_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grievance_student_read ON public.campusops_grievances;
CREATE POLICY grievance_student_read ON public.campusops_grievances
  FOR SELECT TO authenticated
  USING (student_id=auth.uid());

DROP POLICY IF EXISTS grievance_admin_read ON public.campusops_grievances;
CREATE POLICY grievance_admin_read ON public.campusops_grievances
  FOR SELECT TO authenticated
  USING (EXISTS(
    SELECT 1 FROM public.campusops_members m
    WHERE m.college_id=campusops_grievances.college_id
      AND m.user_id=auth.uid() AND m.active AND m.role='report_admin'
  ));

DROP POLICY IF EXISTS grievance_history_read ON public.campusops_grievance_history;
CREATE POLICY grievance_history_read ON public.campusops_grievance_history
  FOR SELECT TO authenticated
  USING (EXISTS(
    SELECT 1 FROM public.campusops_grievances g
    WHERE g.id=campusops_grievance_history.grievance_id
      AND (g.student_id=auth.uid() OR EXISTS(
        SELECT 1 FROM public.campusops_members m
        WHERE m.college_id=g.college_id
          AND m.user_id=auth.uid() AND m.active AND m.role='report_admin'
      ))
  ));

GRANT SELECT ON public.campusops_grievances,public.campusops_grievance_history TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.campusops_grievances,public.campusops_grievance_history FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.campusops_grievance_ai_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.campusops_grievance_ai_reviews TO service_role;
REVOKE ALL ON public.campusops_chat_usage FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.campusops_chat_usage TO service_role;

-- ═══ 6. Chat rate limit (used by campusops-chat) ═════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_allow_chat(p_college uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_members
    WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='student'
  ) THEN RAISE EXCEPTION 'Active student membership required'; END IF;

  IF (SELECT count(*) FROM public.campusops_chat_usage
      WHERE user_id=auth.uid() AND created_at>now()-interval '1 hour')>=40
  THEN RETURN false; END IF;

  INSERT INTO public.campusops_chat_usage(user_id,college_id) VALUES(auth.uid(),p_college);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.campusops_allow_chat(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_allow_chat(uuid) TO authenticated;

-- ═══ 7. Student submission ══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_submit_grievance(
  p_id uuid DEFAULT NULL,
  p_college uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_page text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_id uuid := coalesce(p_id,gen_random_uuid());
  v_row public.campusops_grievances;
  v_description text := trim(coalesce(p_description,''));
  v_page text := trim(coalesce(p_page,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_college IS NULL THEN RAISE EXCEPTION 'College is required'; END IF;
  IF length(v_description)<10 OR length(v_description)>6000 THEN
    RAISE EXCEPTION 'Description must contain 10-6000 characters';
  END IF;
  IF length(v_page)>200 THEN RAISE EXCEPTION 'Affected page is too long'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_members
    WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='student'
  ) THEN RAISE EXCEPTION 'Active student membership required'; END IF;

  SELECT * INTO v_row FROM public.campusops_grievances WHERE id=v_id;
  IF FOUND THEN
    IF v_row.student_id<>auth.uid() OR v_row.college_id<>p_college THEN
      RAISE EXCEPTION 'This reference is already in use';
    END IF;
    RETURN v_id;
  END IF;

  IF (SELECT count(*) FROM public.campusops_grievances
      WHERE student_id=auth.uid() AND college_id=p_college
        AND created_at>now()-interval '1 hour')>=10
  THEN RAISE EXCEPTION 'Grievance limit reached (10 per hour). Please try again later.'; END IF;

  INSERT INTO public.campusops_grievances(
    id,college_id,student_id,description,page,status,admin_response,
    kind,channel,duplicate_of,created_at,updated_at
  ) VALUES(
    v_id,p_college,auth.uid(),v_description,v_page,'new','',
    'website','ai_help',NULL,now(),now()
  );

  INSERT INTO public.campusops_grievance_history(grievance_id,status,response)
  VALUES(v_id,'new','');

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.campusops_submit_grievance(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_submit_grievance(uuid,uuid,text,text) TO authenticated;

-- ═══ 8. Admin review (updates the whole group) ══════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_review_grievance(
  p_id uuid,
  p_status text,
  p_response text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_root uuid;
  v_row record;
  v_response text := trim(coalesce(p_response,''));
BEGIN
  IF p_status NOT IN ('new','in_progress','resolved') THEN
    RAISE EXCEPTION 'Unknown grievance status';
  END IF;
  IF length(v_response)>4000 THEN RAISE EXCEPTION 'Response is too long'; END IF;

  SELECT coalesce(duplicate_of,id) INTO v_root
  FROM public.campusops_grievances WHERE id=p_id;
  IF v_root IS NULL THEN RAISE EXCEPTION 'Grievance not found'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_grievances g
    JOIN public.campusops_members m
      ON m.college_id=g.college_id AND m.user_id=auth.uid()
    WHERE g.id=v_root AND m.active AND m.role='report_admin'
  ) THEN RAISE EXCEPTION 'Report administrator required'; END IF;

  FOR v_row IN
    SELECT id FROM public.campusops_grievances
    WHERE id=v_root OR duplicate_of=v_root
    FOR UPDATE
  LOOP
    UPDATE public.campusops_grievances
    SET status=p_status,admin_response=v_response,updated_at=now()
    WHERE id=v_row.id;

    INSERT INTO public.campusops_grievance_history(grievance_id,status,response)
    VALUES(v_row.id,p_status,v_response);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.campusops_review_grievance(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_review_grievance(uuid,text,text) TO authenticated;

-- ═══ 9. Grouped admin inbox ═════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_admin_grievance_groups(
  p_college uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_members
    WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='report_admin'
  ) THEN RAISE EXCEPTION 'Report administrator required'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(q.payload ORDER BY q.created_at DESC)
    FROM (
      SELECT g.created_at,
        to_jsonb(g)||jsonb_build_object(
          'student_name',m.full_name,
          'affected_count',1+(
            SELECT count(*) FROM public.campusops_grievances d WHERE d.duplicate_of=g.id
          ),
          'linked_reports',coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id',d.id,
              'description',d.description,
              'page',d.page,
              'status',d.status,
              'created_at',d.created_at,
              'student_name',dm.full_name
            ) ORDER BY d.created_at)
            FROM public.campusops_grievances d
            LEFT JOIN public.campusops_members dm
              ON dm.college_id=d.college_id AND dm.user_id=d.student_id
            WHERE d.duplicate_of=g.id
          ),'[]'::jsonb)
        ) AS payload
      FROM public.campusops_grievances g
      LEFT JOIN public.campusops_members m
        ON m.college_id=g.college_id AND m.user_id=g.student_id
      WHERE g.college_id=p_college
        AND g.kind='website'
        AND g.channel='ai_help'
        AND coalesce(g.ai_is_website_problem,true)
        AND g.duplicate_of IS NULL
      ORDER BY g.created_at DESC,g.id
      OFFSET greatest(coalesce(p_offset,0),0)
      LIMIT least(greatest(coalesce(p_limit,20),1),50)
    ) q
  ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.campusops_admin_grievance_groups(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_admin_grievance_groups(uuid,integer,integer) TO authenticated;

-- ═══ 10. AI grouping candidates ═════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_ai_grievance_candidates(p_college uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_members
    WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='report_admin'
  ) THEN RAISE EXCEPTION 'Report administrator required'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id)
    FROM (
      SELECT g.id,g.college_id,g.description,g.page,g.ai_category,g.status,g.created_at
      FROM public.campusops_grievances g
      WHERE g.college_id=p_college
        AND g.kind='website'
        AND g.channel='ai_help'
        AND coalesce(g.ai_is_website_problem,true)
        AND g.duplicate_of IS NULL
        AND g.status<>'resolved'
      ORDER BY g.created_at,g.id
      LIMIT 120
    ) q
  ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.campusops_ai_grievance_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_ai_grievance_candidates(uuid) TO authenticated;

-- ═══ 11. AI grouping writer (service role) ══════════════════════════════════
CREATE OR REPLACE FUNCTION public.campusops_apply_ai_grievance_group(
  p_actor uuid,
  p_source jsonb,
  p_target jsonb,
  p_verdict jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s public.campusops_grievances;
  t public.campusops_grievances;
  v_status text;
  v_response text;
BEGIN
  SELECT * INTO s FROM public.campusops_grievances WHERE id=(p_source->>'id')::uuid;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.campusops_members
    WHERE college_id=s.college_id AND user_id=p_actor AND active AND role='report_admin'
  ) THEN RAISE EXCEPTION 'Report administrator required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('campusops_grievances:'||s.college_id::text));

  SELECT * INTO s FROM public.campusops_grievances WHERE id=(p_source->>'id')::uuid FOR UPDATE;
  SELECT * INTO t FROM public.campusops_grievances
  WHERE id=(p_target->>'id')::uuid AND college_id=s.college_id FOR UPDATE;

  IF NOT FOUND OR s.id=t.id THEN RETURN false; END IF;
  IF s.duplicate_of IS NOT NULL OR t.duplicate_of IS NOT NULL THEN RETURN false; END IF;
  IF s.status='resolved' OR t.status='resolved' THEN RETURN false; END IF;
  IF p_verdict->>'duplicate'<>'true'
    OR coalesce((p_verdict->>'confidence')::numeric,0)<0.9 THEN RETURN false; END IF;

  IF s.description IS DISTINCT FROM p_source->>'description'
    OR t.description IS DISTINCT FROM p_target->>'description'
    OR coalesce(s.page,'') IS DISTINCT FROM coalesce(p_source->>'page','')
    OR coalesce(t.page,'') IS DISTINCT FROM coalesce(p_target->>'page','')
  THEN RETURN false; END IF;

  v_status := CASE WHEN s.status='in_progress' OR t.status='in_progress'
                   THEN 'in_progress' ELSE 'new' END;
  v_response := coalesce(nullif(t.admin_response,''),s.admin_response,'');

  UPDATE public.campusops_grievances
  SET status=v_status,admin_response=v_response,updated_at=now()
  WHERE id=t.id;

  UPDATE public.campusops_grievances
  SET duplicate_of=t.id,status=v_status,admin_response=v_response,
      grouped_at=now(),updated_at=now()
  WHERE duplicate_of=s.id;

  UPDATE public.campusops_grievances
  SET duplicate_of=t.id,status=v_status,admin_response=v_response,
      grouped_at=now(),updated_at=now()
  WHERE id=s.id;

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.campusops_apply_ai_grievance_group(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_apply_ai_grievance_group(uuid,jsonb,jsonb,jsonb) TO service_role;

-- ═══ 12. Refresh PostgREST so the new functions are callable immediately ════
NOTIFY pgrst,'reload schema';

-- ═══ 13. Verification — every "ok" must say ok ═════════════════════════════
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
union all select 'column duplicate_of',
       case when exists(select 1 from information_schema.columns
                        where table_schema='public' and table_name='campusops_grievances'
                          and column_name='duplicate_of') then 'ok' else 'MISSING' end
union all select 'table campusops_grievance_ai_reviews',
       case when to_regclass('public.campusops_grievance_ai_reviews') is null then 'MISSING' else 'ok' end
order by 1;
