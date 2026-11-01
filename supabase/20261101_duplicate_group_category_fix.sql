-- Fix: duplicate detection silently skipped real duplicates whenever two students
-- picked different report categories (for example "general" vs "electrical").
-- Run after 20261030_admin_ai_grouping.sql. Additive and rerunnable.
--
-- What changed:
--   1. campusops_apply_ai_group now merges reports in the same room when the
--      categories match OR one side is generic ('general', 'other' or empty).
--   2. When the canonical report has a generic category and the merged report
--      has a specific one, the canonical incident/report adopt the specific
--      category so the admin inbox shows the precise fault type.
-- Room, asset, freshness, work-order and unlink protections are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.campusops_apply_ai_group(p_actor uuid,p_source jsonb,p_target jsonb,p_verdict jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.campusops_reports; t public.campusops_reports; original uuid; child record;
 is_generic text[]:=ARRAY['','general','other'];
BEGIN
 SELECT * INTO s FROM public.campusops_reports WHERE id=(p_source->>'id')::uuid;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=s.college_id AND user_id=p_actor AND active AND role='report_admin') THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 PERFORM campusops_private.lock_college(s.college_id);
 SELECT * INTO s FROM public.campusops_reports WHERE id=(p_source->>'id')::uuid FOR UPDATE;
 SELECT * INTO t FROM public.campusops_reports WHERE id=(p_target->>'id')::uuid AND college_id=s.college_id FOR UPDATE;
 IF NOT FOUND OR s.id=t.id OR s.room_id IS NULL OR s.room_id IS DISTINCT FROM t.room_id THEN RETURN false; END IF;
 -- Same category always merges; a generic category on either side is treated as
 -- "not classified yet" instead of a hard mismatch. Two different specific
 -- categories still stay separate.
 IF NOT (s.category IS NOT DISTINCT FROM t.category
  OR coalesce(s.category,'')=ANY(is_generic)
  OR coalesce(t.category,'')=ANY(is_generic)) THEN RETURN false; END IF;
 IF s.asset_id IS NOT NULL AND t.asset_id IS NOT NULL AND s.asset_id<>t.asset_id THEN RETURN false; END IF;
 IF s.status IN ('resolved','closed') OR t.status IN ('resolved','closed') OR EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates WHERE report_id IN(s.id,t.id)) THEN RETURN false; END IF;
 IF p_verdict->>'duplicate'<>'true' OR coalesce((p_verdict->>'confidence')::numeric,0)<0.9 THEN RETURN false; END IF;
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
 -- Promote a generic canonical category to the specific one that was merged in,
 -- so the grouped issue is labelled with the real fault type. Never blocks a merge.
 IF coalesce(t.category,'')=ANY(is_generic) AND NOT (coalesce(s.category,'')=ANY(is_generic)) THEN
  BEGIN
   UPDATE public.campusops_incidents SET category=s.category WHERE id=t.incident_id;
   UPDATE public.campusops_reports SET category=s.category
    WHERE incident_id=t.incident_id AND id<>s.id AND coalesce(category,'')=ANY(is_generic);
  EXCEPTION WHEN others THEN NULL;
  END;
 END IF;
 INSERT INTO public.campusops_duplicate_events(college_id,report_id,canonical_id,actor_id,action) VALUES(s.college_id,s.id,t.id,p_actor,'ai_group');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.campusops_apply_ai_group(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_apply_ai_group(uuid,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
