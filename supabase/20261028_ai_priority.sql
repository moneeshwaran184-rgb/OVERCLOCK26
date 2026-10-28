BEGIN;
CREATE TABLE IF NOT EXISTS public.campusops_ai_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,college_id uuid NOT NULL REFERENCES public.campusops_colleges(id),input jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),report_id uuid);
ALTER TABLE public.campusops_ai_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campusops_ai_assessments FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.campusops_ai_assessments TO service_role;
CREATE OR REPLACE FUNCTION campusops_private.submit_ai_report(p_college uuid,p_campus uuid,p_department uuid,p_description text,
 p_room uuid DEFAULT NULL,p_asset uuid DEFAULT NULL,p_category text DEFAULT NULL,p_priority integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cat text; pri integer; inc uuid; dup uuid; rid uuid; v_room public.campusops_rooms; BEGIN
 IF NOT campusops_private.member(p_college) THEN RAISE EXCEPTION 'College membership required'; END IF;
 PERFORM campusops_private.lock_college(p_college);
 IF p_room IS NOT NULL THEN
 SELECT * INTO v_room FROM public.campusops_rooms WHERE college_id=p_college AND id=p_room;
 IF NOT FOUND OR v_room.department_id<>p_department OR NOT EXISTS(SELECT 1 FROM public.campusops_buildings
 WHERE college_id=p_college AND id=v_room.building_id AND campus_id=p_campus) THEN RAISE EXCEPTION 'Room, campus and department do not match'; END IF;
 END IF;
 IF p_asset IS NOT NULL AND (p_room IS NULL OR NOT EXISTS(SELECT 1 FROM public.campusops_assets WHERE college_id=p_college AND id=p_asset AND room_id=p_room)) THEN
 RAISE EXCEPTION 'Asset must belong to the selected room'; END IF;
 cat=coalesce(p_category,CASE
 WHEN p_description ~* '(electric|power|spark|wire|light)' THEN 'electrical'
 WHEN p_description ~* '(water|leak|pipe|toilet)' THEN 'plumbing'
 WHEN p_description ~* '(wifi|network|computer|projector)' THEN 'it'
 WHEN p_description ~* '(air condition|cooling|ac unit)' THEN 'hvac' ELSE 'general' END);
 pri=p_priority; IF pri IS NULL OR pri NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Valid AI priority required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_sla_policies WHERE college_id=p_college AND category=cat AND priority=pri) THEN
 RAISE EXCEPTION 'Unknown category/priority: configure an SLA policy'; END IF;
 IF p_room IS NOT NULL THEN
 SELECT i.id INTO inc FROM public.campusops_incidents i JOIN public.campusops_incident_rooms ir ON ir.incident_id=i.id
 WHERE i.college_id=p_college AND i.department_id=p_department AND ir.room_id=p_room AND i.category=cat
 AND i.status IN ('open','in_progress') AND i.created_at>now()-interval '24 hours' ORDER BY i.created_at DESC LIMIT 1;
 END IF;
 IF inc IS NULL THEN
 INSERT INTO public.campusops_incidents(college_id,campus_id,department_id,title,category,priority)
 VALUES(p_college,p_campus,p_department,left(p_description,160),cat,pri) RETURNING id INTO inc;
 IF p_room IS NOT NULL THEN
 INSERT INTO public.campusops_incident_rooms(college_id,incident_id,room_id) VALUES(p_college,inc,p_room); END IF;
 ELSE UPDATE public.campusops_incidents SET priority=least(priority,pri) WHERE id=inc; END IF;
 SELECT id INTO dup FROM public.campusops_reports WHERE college_id=p_college AND incident_id=inc
 AND lower(trim(description))=lower(trim(p_description)) ORDER BY created_at LIMIT 1;
 INSERT INTO public.campusops_reports(college_id,reporter_id,campus_id,department_id,room_id,asset_id,incident_id,duplicate_of,
 description,category,priority,status,extraction,clarification_needed)
 VALUES(p_college,auth.uid(),p_campus,p_department,p_room,p_asset,inc,dup,p_description,cat,pri,'submitted',
 jsonb_build_object('method','gemini','priority_reason','AI priority assessment','category',cat,'priority',pri,'confidence',CASE WHEN p_category IS NOT NULL THEN 1.0 ELSE 0.6 END,
 'questions',CASE WHEN p_room IS NULL THEN jsonb_build_array('Which room is affected?') ELSE '[]'::jsonb END),p_room IS NULL)
 RETURNING id INTO rid;
 IF p_room IS NULL THEN
 INSERT INTO public.campusops_report_messages(college_id,report_id,author_id,body)
 VALUES(p_college,rid,auth.uid(),'Clarification required: which room is affected?'); END IF;
 PERFORM campusops_private.notify(p_college,auth.uid(),'report','Report received','Your report has been recorded.',rid,'report:'||rid);
 PERFORM campusops_private.notify(p_college,m.user_id,'incident','New campus report',left(p_description,250),inc,'report:'||rid)
 FROM public.campusops_members m WHERE m.college_id=p_college AND m.active AND
 (m.role='facilities_admin' OR (m.role='report_admin' AND campusops_private.has_role(p_college,ARRAY['student'])) OR (m.role='department_manager' AND m.department_id=p_department));
 RETURN jsonb_build_object('report_id',rid,'incident_id',inc,'duplicate',dup IS NOT NULL,'clarification_needed',p_room IS NULL);
END $$;

REVOKE ALL ON FUNCTION campusops_private.submit_ai_report(uuid,uuid,uuid,text,uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.campusops_submit_ai_report(p_assessment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.campusops_ai_assessments; v jsonb; response jsonb; pri integer;
BEGIN
 SELECT * INTO a FROM public.campusops_ai_assessments WHERE id=p_assessment FOR UPDATE;
 IF NOT FOUND OR a.user_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=a.college_id AND user_id=auth.uid() AND active AND role='student') THEN RAISE EXCEPTION 'Valid student AI assessment required'; END IF;
 IF a.report_id IS NOT NULL THEN RETURN jsonb_build_object('report_id',a.report_id); END IF;
 IF a.created_at<now()-interval '1 hour' THEN RAISE EXCEPTION 'AI review expired. Edit your description and review again.'; END IF;
 v=a.input;pri=(a.result->>'priority')::integer;
 response=campusops_private.submit_ai_report(a.college_id,(v->>'campus_id')::uuid,(v->>'department_id')::uuid,v->>'description',nullif(v->>'room_id','')::uuid,NULL,v->>'category',pri);
 UPDATE public.campusops_reports SET equipment_description=nullif(v->>'equipment',''),extraction=extraction||jsonb_build_object('ai',a.result,'priority_reason',a.result->>'priority_reason') WHERE id=(response->>'report_id')::uuid;
 UPDATE public.campusops_ai_assessments SET report_id=(response->>'report_id')::uuid WHERE id=a.id;
 RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.campusops_submit_ai_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_submit_ai_report(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
