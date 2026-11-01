BEGIN;
CREATE TABLE IF NOT EXISTS public.campusops_confirmed_duplicates (
 report_id uuid PRIMARY KEY REFERENCES public.campusops_reports(id),
 canonical_id uuid NOT NULL REFERENCES public.campusops_reports(id),
 college_id uuid NOT NULL REFERENCES public.campusops_colleges(id),
 original_incident_id uuid NOT NULL REFERENCES public.campusops_incidents(id),
 confirmed_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(report_id<>canonical_id));
CREATE INDEX IF NOT EXISTS campusops_confirmed_duplicates_canonical_id_idx ON public.campusops_confirmed_duplicates(canonical_id);
CREATE TABLE IF NOT EXISTS public.campusops_duplicate_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,college_id uuid NOT NULL,
 report_id uuid NOT NULL,canonical_id uuid NOT NULL,actor_id uuid NOT NULL,
 action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.campusops_confirmed_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_duplicate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campusops_confirmed_duplicates,public.campusops_duplicate_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.campusops_confirmed_duplicates,public.campusops_duplicate_events TO authenticated;
DROP POLICY IF EXISTS duplicate_admin_read ON public.campusops_confirmed_duplicates;
CREATE POLICY duplicate_admin_read ON public.campusops_confirmed_duplicates FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=campusops_confirmed_duplicates.college_id AND m.user_id=auth.uid() AND m.active AND m.role='report_admin'));
DROP POLICY IF EXISTS duplicate_audit_read ON public.campusops_duplicate_events;
CREATE POLICY duplicate_audit_read ON public.campusops_duplicate_events FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=campusops_duplicate_events.college_id AND m.user_id=auth.uid() AND m.active AND m.role='report_admin'));
DROP FUNCTION IF EXISTS public.campusops_submit_ai_report(uuid);
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
 IF inc IS NULL THEN
 INSERT INTO public.campusops_incidents(college_id,campus_id,department_id,title,category,priority)
 VALUES(p_college,p_campus,p_department,left(p_description,160),cat,pri) RETURNING id INTO inc;
 IF p_room IS NOT NULL THEN
 INSERT INTO public.campusops_incident_rooms(college_id,incident_id,room_id) VALUES(p_college,inc,p_room); END IF;
 ELSE UPDATE public.campusops_incidents SET priority=least(priority,pri) WHERE id=inc; END IF;
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

CREATE OR REPLACE FUNCTION public.campusops_submit_ai_report(p_assessment uuid,p_choice text DEFAULT NULL,p_target uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.campusops_ai_assessments; v jsonb; response jsonb; pri integer; target public.campusops_reports; rid uuid;
BEGIN
 SELECT * INTO a FROM public.campusops_ai_assessments WHERE id=p_assessment FOR UPDATE;
 IF NOT FOUND OR a.user_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=a.college_id AND user_id=auth.uid() AND active AND role='student') THEN RAISE EXCEPTION 'Valid student AI assessment required'; END IF;
 IF a.report_id IS NOT NULL THEN RETURN jsonb_build_object('report_id',a.report_id); END IF;
 IF a.created_at<now()-interval '1 hour' THEN RAISE EXCEPTION 'AI review expired. Edit your description and review again.'; END IF;
 v=a.input;pri=(a.result->>'priority')::integer;
 PERFORM campusops_private.lock_college(a.college_id);
 IF jsonb_array_length(coalesce(a.result->'duplicates','[]'::jsonb))>0 AND (p_choice IS NULL OR p_choice NOT IN ('join','separate')) THEN
 RAISE EXCEPTION 'Choose Join existing issue or Submit separately'; END IF;
 IF p_choice='join' THEN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.result->'duplicates') d WHERE d->>'id'=p_target::text) THEN RAISE EXCEPTION 'Target must be an AI suggestion'; END IF;
 SELECT * INTO target FROM public.campusops_reports WHERE id=p_target AND college_id=a.college_id FOR UPDATE;
 IF NOT FOUND OR target.status IN ('resolved','closed') OR target.room_id IS DISTINCT FROM (v->>'room_id')::uuid OR EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates WHERE report_id=target.id) THEN RAISE EXCEPTION 'Suggested issue changed. Review again'; END IF;
 PERFORM 1 FROM public.campusops_incidents WHERE id=target.incident_id AND college_id=a.college_id AND status IN ('open','in_progress') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Issue is no longer active'; END IF;
 END IF;

 response=campusops_private.submit_ai_report(a.college_id,(v->>'campus_id')::uuid,(v->>'department_id')::uuid,v->>'description',nullif(v->>'room_id','')::uuid,NULL,v->>'category',pri);
 UPDATE public.campusops_reports SET equipment_description=nullif(v->>'equipment',''),extraction=extraction||jsonb_build_object('ai',a.result,'priority_reason',a.result->>'priority_reason') WHERE id=(response->>'report_id')::uuid;

 rid=(response->>'report_id')::uuid;
 IF p_choice='join' THEN
 INSERT INTO public.campusops_confirmed_duplicates(report_id,canonical_id,college_id,original_incident_id,confirmed_by)
 VALUES(rid,target.id,a.college_id,(response->>'incident_id')::uuid,auth.uid());
 UPDATE public.campusops_reports SET incident_id=target.incident_id,duplicate_of=target.id,status=target.status WHERE id=rid;
 UPDATE public.campusops_incidents SET status='closed' WHERE id=(response->>'incident_id')::uuid;
 UPDATE public.campusops_notifications SET entity_id=target.incident_id WHERE college_id=a.college_id AND entity_id=(response->>'incident_id')::uuid AND dedupe_key='report:'||rid::text;
 UPDATE public.campusops_incidents SET priority=least(priority,pri) WHERE id=target.incident_id;
 INSERT INTO public.campusops_duplicate_events(college_id,report_id,canonical_id,actor_id,action) VALUES(a.college_id,rid,target.id,auth.uid(),'join');
 response=response||jsonb_build_object('incident_id',target.incident_id,'canonical_id',target.id);
 END IF;
 UPDATE public.campusops_ai_assessments SET report_id=(response->>'report_id')::uuid WHERE id=a.id;
 RETURN response;
END $$;

REVOKE ALL ON FUNCTION public.campusops_submit_ai_report(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_submit_ai_report(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.campusops_duplicate_candidates(p_college uuid,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='student') THEN RAISE EXCEPTION 'Student membership required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT r.id,r.description,r.room_id,r.category,r.equipment_description FROM public.campusops_reports r JOIN public.campusops_incidents i ON i.id=r.incident_id WHERE r.college_id=p_college AND r.status NOT IN ('resolved','closed') AND i.status IN ('open','in_progress') AND NOT EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates d WHERE d.report_id=r.id) ORDER BY r.created_at,r.id OFFSET greatest(p_offset,0) LIMIT 100) q),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.campusops_duplicate_candidates(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_duplicate_candidates(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.campusops_admin_report_groups(p_college uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='report_admin') THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(q.row ORDER BY q.created_at DESC) FROM (
 SELECT r.created_at,to_jsonb(r)||jsonb_build_object('reporter',jsonb_build_object('full_name',m.full_name),'campus',jsonb_build_object('name',c.name),'department',jsonb_build_object('name',dp.name),'room',jsonb_build_object('name',rm.name,'building',jsonb_build_object('name',b.name)),
 'affected_count',(SELECT count(DISTINCT u) FROM (SELECT r.reporter_id u UNION ALL SELECT rr.reporter_id FROM public.campusops_confirmed_duplicates d JOIN public.campusops_reports rr ON rr.id=d.report_id WHERE d.canonical_id=r.id UNION ALL SELECT sp.user_id FROM public.campusops_report_supporters sp WHERE sp.report_id=r.id OR sp.report_id IN (SELECT report_id FROM public.campusops_confirmed_duplicates WHERE canonical_id=r.id)) users),
 'linked_reports',coalesce((SELECT jsonb_agg(jsonb_build_object('id',rr.id,'description',rr.description,'created_at',rr.created_at,'reporter_name',mm.full_name)) FROM public.campusops_confirmed_duplicates d JOIN public.campusops_reports rr ON rr.id=d.report_id LEFT JOIN public.campusops_members mm ON mm.college_id=rr.college_id AND mm.user_id=rr.reporter_id WHERE d.canonical_id=r.id),'[]'::jsonb)) row
 FROM public.campusops_reports r JOIN public.campusops_members m ON m.college_id=r.college_id AND m.user_id=r.reporter_id
 LEFT JOIN public.campusops_campuses c ON c.id=r.campus_id LEFT JOIN public.campusops_departments dp ON dp.id=r.department_id LEFT JOIN public.campusops_rooms rm ON rm.id=r.room_id LEFT JOIN public.campusops_buildings b ON b.id=rm.building_id
 WHERE r.college_id=p_college AND m.role='student' AND NOT EXISTS(SELECT 1 FROM public.campusops_confirmed_duplicates d WHERE d.report_id=r.id)
 ) q),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.campusops_admin_report_groups(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_admin_report_groups(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.campusops_unlink_duplicate(p_report uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.campusops_confirmed_duplicates; BEGIN
 SELECT * INTO d FROM public.campusops_confirmed_duplicates WHERE report_id=p_report;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link no longer exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=d.college_id AND user_id=auth.uid() AND active AND role='report_admin') THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 PERFORM campusops_private.lock_college(d.college_id);
 SELECT * INTO d FROM public.campusops_confirmed_duplicates WHERE report_id=p_report FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link no longer exists'; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_reports WHERE id=p_report AND status IN ('resolved','closed')) OR EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE incident_id=(SELECT incident_id FROM public.campusops_reports WHERE id=p_report)) THEN RAISE EXCEPTION 'Unlink only before work orders exist; retain dispatched and completed history'; END IF;
 UPDATE public.campusops_reports SET incident_id=d.original_incident_id,duplicate_of=NULL,status='submitted' WHERE id=p_report;
 UPDATE public.campusops_incidents SET status='open' WHERE id=d.original_incident_id;
 DELETE FROM public.campusops_confirmed_duplicates WHERE report_id=p_report;
 INSERT INTO public.campusops_duplicate_events(college_id,report_id,canonical_id,actor_id,action) VALUES(d.college_id,p_report,d.canonical_id,auth.uid(),'unlink');
END $$;
REVOKE ALL ON FUNCTION public.campusops_unlink_duplicate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_unlink_duplicate(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
