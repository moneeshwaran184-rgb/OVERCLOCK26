-- Run after 20261030_confirmed_duplicates.sql. No existing reports are deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campusops_ai_pair_reviews (
 pair_key text PRIMARY KEY, college_id uuid NOT NULL, source_id uuid NOT NULL,
 target_id uuid NOT NULL, verdict jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.campusops_ai_pair_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campusops_ai_pair_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.campusops_ai_pair_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.campusops_ai_group_candidates(p_college uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='report_admin') THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id) FROM (
 SELECT r.id,r.college_id,r.description,r.room_id,r.asset_id,r.category,r.equipment_description,r.created_at,r.incident_id
 FROM public.campusops_reports r JOIN public.campusops_incidents i ON i.id=r.incident_id AND i.college_id=r.college_id
 WHERE r.college_id=p_college AND r.room_id IS NOT NULL AND r.status NOT IN ('resolved','closed') AND i.status IN ('open','in_progress')
 AND EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=r.college_id AND m.user_id=r.reporter_id AND m.role='student')
 AND NOT EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates d WHERE d.report_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM public.campusops_work_orders w WHERE w.college_id=r.college_id AND w.incident_id=r.incident_id)
 ) q),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.campusops_ai_group_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_ai_group_candidates(uuid) TO authenticated;

-- Only the Edge Function service client can call this writer. Model output alone
-- cannot bypass membership, location, freshness or work-history checks.
CREATE OR REPLACE FUNCTION public.campusops_apply_ai_group(p_actor uuid,p_source jsonb,p_target jsonb,p_verdict jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.campusops_reports; t public.campusops_reports; original uuid; child record;
BEGIN
 SELECT * INTO s FROM public.campusops_reports WHERE id=(p_source->>'id')::uuid;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=s.college_id AND user_id=p_actor AND active AND role='report_admin') THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 PERFORM campusops_private.lock_college(s.college_id);
 SELECT * INTO s FROM public.campusops_reports WHERE id=(p_source->>'id')::uuid FOR UPDATE;
 SELECT * INTO t FROM public.campusops_reports WHERE id=(p_target->>'id')::uuid AND college_id=s.college_id FOR UPDATE;
 IF NOT FOUND OR s.id=t.id OR s.room_id IS NULL OR s.room_id IS DISTINCT FROM t.room_id OR s.category IS DISTINCT FROM t.category THEN RETURN false; END IF;
 IF s.asset_id IS NOT NULL AND t.asset_id IS NOT NULL AND s.asset_id<>t.asset_id THEN RETURN false; END IF;
 IF s.status IN ('resolved','closed') OR t.status IN ('resolved','closed') OR EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates WHERE report_id IN(s.id,t.id)) THEN RETURN false; END IF;
 IF p_verdict->>'duplicate'<>'true' OR coalesce((p_verdict->>'confidence')::numeric,0)<0.95 THEN RETURN false; END IF;
 IF s.description IS DISTINCT FROM p_source->>'description' OR t.description IS DISTINCT FROM p_target->>'description'
 OR s.room_id::text IS DISTINCT FROM p_source->>'room_id' OR t.room_id::text IS DISTINCT FROM p_target->>'room_id'
 OR s.category IS DISTINCT FROM p_source->>'category' OR t.category IS DISTINCT FROM p_target->>'category'
 OR s.equipment_description IS DISTINCT FROM p_source->>'equipment_description' OR t.equipment_description IS DISTINCT FROM p_target->>'equipment_description'
 OR s.asset_id::text IS DISTINCT FROM p_source->>'asset_id' OR t.asset_id::text IS DISTINCT FROM p_target->>'asset_id' THEN RETURN false; END IF;
 PERFORM 1 FROM public.campusops_incidents WHERE id IN(s.incident_id,t.incident_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.campusops_incidents WHERE id IN(s.incident_id,t.incident_id) AND status NOT IN ('open','in_progress'))
 OR EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE incident_id IN(s.incident_id,t.incident_id)) THEN RETURN false; END IF;
 -- Explicit unlink decisions must not be reversed by the automatic scanner.
 IF EXISTS(SELECT 1 FROM public.campusops_duplicate_events WHERE action='unlink' AND ((report_id=s.id AND canonical_id=t.id) OR (report_id=t.id AND canonical_id=s.id))) THEN RETURN false; END IF;
 original=s.incident_id;
 -- A legacy submission may already share an incident; reserve a distinct incident
 -- so the existing unlink operation really restores a separate issue.
 IF original=t.incident_id THEN
 INSERT INTO public.campusops_incidents(college_id,campus_id,department_id,title,category,priority,status)
 VALUES(s.college_id,s.campus_id,s.department_id,left(s.description,160),s.category,s.priority,'closed') RETURNING id INTO original;
 INSERT INTO public.campusops_incident_rooms(college_id,incident_id,room_id) VALUES(s.college_id,original,s.room_id);
 END IF;
 INSERT INTO public.campusops_confirmed_duplicates(report_id,canonical_id,college_id,original_incident_id,confirmed_by)
 VALUES(s.id,t.id,s.college_id,original,p_actor);
 FOR child IN SELECT report_id FROM public.campusops_confirmed_duplicates WHERE canonical_id=s.id LOOP
 UPDATE public.campusops_confirmed_duplicates SET canonical_id=t.id WHERE report_id=child.report_id;
 UPDATE public.campusops_reports SET incident_id=t.incident_id,duplicate_of=t.id WHERE id=child.report_id;
 INSERT INTO public.campusops_duplicate_events(college_id,report_id,canonical_id,actor_id,action) VALUES(s.college_id,child.report_id,t.id,p_actor,'ai_regroup');
 END LOOP;
 UPDATE public.campusops_reports SET incident_id=t.incident_id,duplicate_of=t.id WHERE id=s.id;
 IF s.incident_id<>t.incident_id AND NOT EXISTS(SELECT 1 FROM public.campusops_reports WHERE incident_id=s.incident_id) THEN
 UPDATE public.campusops_incidents SET status='closed' WHERE id=s.incident_id; END IF;
 UPDATE public.campusops_incidents SET priority=least(priority,s.priority) WHERE id=t.incident_id;
 INSERT INTO public.campusops_duplicate_events(college_id,report_id,canonical_id,actor_id,action) VALUES(s.college_id,s.id,t.id,p_actor,'ai_group');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.campusops_apply_ai_group(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_apply_ai_group(uuid,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
