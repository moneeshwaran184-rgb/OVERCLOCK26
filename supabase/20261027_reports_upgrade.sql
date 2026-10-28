-- CampusOps upgrade: run this entire file ONCE in Supabase SQL Editor.
-- Additive and rerunnable. Existing reports/photos remain intact. Existing passwords are never reset.
-- To provision demo logins, set app.campusops_demo_password privately in this SQL session before running.
 BEGIN;
DO $$ BEGIN
 IF NULLIF(current_setting('app.campusops_demo_password', true), '') IS NULL THEN
  RAISE EXCEPTION 'Set app.campusops_demo_password privately before running this account-seeding migration';
 END IF;
END $$;
ALTER TABLE public.campusops_members DROP CONSTRAINT IF EXISTS campusops_members_role_check;
ALTER TABLE public.campusops_members ADD CONSTRAINT campusops_members_role_check CHECK(role IN ('student','faculty','technician','report_admin','department_manager','facilities_admin','procurement_approver','system_admin'));
ALTER TABLE public.campusops_reports ADD COLUMN IF NOT EXISTS equipment_description text CHECK(length(equipment_description)<=200);
ALTER TABLE public.campusops_work_orders ADD COLUMN IF NOT EXISTS manual_assignment boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.campusops_priority_rules(id text PRIMARY KEY,priority integer NOT NULL CHECK(priority BETWEEN 1 AND 4),pattern text NOT NULL,reason text NOT NULL,examples jsonb NOT NULL);
ALTER TABLE public.campusops_priority_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read ON public.campusops_priority_rules;
CREATE POLICY read ON public.campusops_priority_rules FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.campusops_priority_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.campusops_priority_rules TO authenticated;
GRANT ALL ON public.campusops_priority_rules TO service_role;
INSERT INTO public.campusops_priority_rules(id,priority,pattern,reason,examples) VALUES
('fire',1,'(^|[^a-z])(fire(?! (alarm|extinguisher|drill|exit))|flames|burning|smoke)([^a-z]|$)','Possible fire or smoke hazard.','["Smoke coming from the switchboard","Flames near the generator"]'::jsonb),
('electric_hazard',1,'(^|[^a-z])(sparks?|sparking|electric shock|exposed (live )?wires?|live wire)([^a-z]|$)','Possible immediate electrical danger.','["Exposed live wire beside the desk","Socket is sparking"]'::jsonb),
('gas',1,'(^|[^a-z])(gas leak|smell of gas)([^a-z]|$)','Possible gas leak.','["Smell of gas near the workshop"]'::jsonb),
('structural',1,'(^|[^a-z])(ceiling collapse|collapsing|structural collapse)([^a-z]|$)','Possible structural danger.','["The ceiling is collapsing"]'::jsonb),
('flood',1,'(^|[^a-z])(flooding|flooded|water near (electrical|electric)|water on (electrical|electric))([^a-z]|$)','Flooding or water near electricity.','["Lab is flooded","Water near electrical equipment"]'::jsonb),
('blocked_exit',1,'(^|[^a-z])(blocked (fire |emergency )?exit|emergency exit blocked)([^a-z]|$)','An emergency exit may be blocked.','["Blocked emergency exit in the hall"]'::jsonb),
('outage',2,'(^|[^a-z])(power outage|no power|blackout)([^a-z]|$)','Loss of power affects service.','["No power in the classroom"]'::jsonb),
('water_supply',2,'(^|[^a-z])(burst pipe|pipe burst|no water|sewage overflow)([^a-z]|$)','Major water or sanitation disruption.','["Burst pipe beside the washroom"]'::jsonb),
('network',2,'(^|[^a-z])(network outage|internet outage|no internet|all computers offline)([^a-z]|$)','Network service disruption.','["No internet in the computer lab"]'::jsonb),
('access',2,'(^|[^a-z])(door (is )?stuck|locked inside|cannot open (the )?door)([^a-z]|$)','Access to a room is obstructed.','["The classroom door is stuck"]'::jsonb),
('machinery',2,'(^|[^a-z])(machine jammed|machinery stopped|lift stuck|elevator stuck)([^a-z]|$)','Mechanical service disruption.','["Workshop machine jammed"]'::jsonb),
('safety_device',2,'(^|[^a-z])(extinguisher (is )?empty|fire alarm (is )?faulty|fire alarm (is )?not working)([^a-z]|$)','Safety equipment requires prompt repair.','["The fire alarm is not working"]'::jsonb),
('glass',2,'(^|[^a-z])(broken glass|broken stair|broken railing)([^a-z]|$)','Broken fittings may cause injury.','["Broken glass near the window"]'::jsonb),
('leak',3,'(^|[^a-z])(leaking|water leak|dripping|tap leak)([^a-z]|$)','A localized leak needs maintenance.','["Tap leaking in the washroom"]'::jsonb),
('device',3,'(^|[^a-z])(not working|faulty|broken|damaged)([^a-z]|$)','Equipment needs routine repair.','["Projector not working","Broken desk in classroom"]'::jsonb),
('cleaning',3,'(^|[^a-z])(dirty|spill|waste|garbage|unclean)([^a-z]|$)','Cleaning or sanitation is needed.','["Garbage near the classroom"]'::jsonb),
('cosmetic',4,'(^|[^a-z])(scratch|scratches|repaint|paint peeling|cosmetic)([^a-z]|$)','Cosmetic maintenance can be scheduled.','["Paint peeling on the corridor wall"]'::jsonb),
('minor',4,'(^|[^a-z])(squeaky|loose label|faded sign)([^a-z]|$)','Minor maintenance can be scheduled.','["Squeaky chair in the classroom"]'::jsonb)
ON CONFLICT(id) DO UPDATE SET priority=excluded.priority,pattern=excluded.pattern,reason=excluded.reason,examples=excluded.examples;
CREATE TABLE IF NOT EXISTS public.campusops_report_categories(college_id uuid NOT NULL REFERENCES public.campusops_colleges(id),code text NOT NULL,name text NOT NULL,skill_id uuid NOT NULL,PRIMARY KEY(college_id,code),FOREIGN KEY(college_id,skill_id) REFERENCES public.campusops_skills(college_id,id));
CREATE TABLE IF NOT EXISTS public.campusops_staff_campuses(college_id uuid NOT NULL,user_id uuid NOT NULL,campus_id uuid NOT NULL,PRIMARY KEY(college_id,user_id,campus_id),FOREIGN KEY(college_id,user_id) REFERENCES public.campusops_staff(college_id,user_id),FOREIGN KEY(college_id,campus_id) REFERENCES public.campusops_campuses(college_id,id));
ALTER TABLE public.campusops_report_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_staff_campuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read ON public.campusops_report_categories;
CREATE POLICY read ON public.campusops_report_categories FOR SELECT TO authenticated USING(campusops_private.member(college_id));
DROP POLICY IF EXISTS read ON public.campusops_staff_campuses;
CREATE POLICY read ON public.campusops_staff_campuses FOR SELECT TO authenticated USING(user_id=auth.uid() OR campusops_private.has_role(college_id,ARRAY['facilities_admin','report_admin']));
REVOKE ALL ON public.campusops_report_categories,public.campusops_staff_campuses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.campusops_report_categories,public.campusops_staff_campuses TO authenticated;
GRANT ALL ON public.campusops_report_categories,public.campusops_staff_campuses TO service_role;

CREATE OR REPLACE FUNCTION campusops_private.review_student_incident(c uuid,i uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT campusops_private.has_role(c,ARRAY['report_admin']) AND EXISTS(SELECT 1 FROM public.campusops_reports r JOIN public.campusops_members m ON m.college_id=r.college_id AND m.user_id=r.reporter_id WHERE r.college_id=c AND r.incident_id=i AND m.role='student');
$$;
CREATE OR REPLACE FUNCTION campusops_private.can_report(c uuid,r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.campusops_reports x WHERE x.college_id=c AND x.id=r AND campusops_private.member(c)
 AND (x.reporter_id=auth.uid() OR (campusops_private.has_role(c,ARRAY['report_admin']) AND EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=c AND m.user_id=x.reporter_id AND m.role='student')) OR campusops_private.ops(c,x.department_id) OR EXISTS
 (SELECT 1 FROM public.campusops_work_orders w WHERE w.college_id=c AND w.incident_id=x.incident_id AND w.assigned_to=auth.uid()
 AND campusops_private.has_role(c,ARRAY['technician']))));
$$;
CREATE OR REPLACE FUNCTION campusops_private.can_work(c uuid,w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.campusops_work_orders x WHERE x.college_id=c AND x.id=w
 AND (campusops_private.ops(c,x.department_id) OR campusops_private.review_student_incident(c,x.incident_id) OR (x.assigned_to=auth.uid() AND campusops_private.has_role(c,ARRAY['technician']))));
$$;
DROP POLICY IF EXISTS report_admin_read ON public.campusops_incidents;
CREATE POLICY report_admin_read ON public.campusops_incidents FOR SELECT TO authenticated USING(campusops_private.review_student_incident(college_id,id));
DROP POLICY IF EXISTS report_admin_directory ON public.campusops_members;
CREATE POLICY report_admin_directory ON public.campusops_members FOR SELECT TO authenticated USING(role IN ('student','technician') AND campusops_private.has_role(college_id,ARRAY['report_admin']));
DROP POLICY IF EXISTS report_admin_directory ON public.campusops_staff;
CREATE POLICY report_admin_directory ON public.campusops_staff FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['report_admin']));
DROP POLICY IF EXISTS report_admin_directory ON public.campusops_staff_skills;
CREATE POLICY report_admin_directory ON public.campusops_staff_skills FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['report_admin']));

-- Notification recipient rules apply on the server, including the five-minute scheduler.
CREATE OR REPLACE FUNCTION campusops_private.notify(c uuid,u uuid,k text,t text,b text,e uuid,dk text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.campusops_notifications(college_id,user_id,kind,title,body,entity_id,dedupe_key)
 SELECT c,u,CASE WHEN m.role='student' THEN CASE WHEN dk LIKE 'resolved:%' THEN 'report_resolved' ELSE 'report_submitted' END ELSE k END,
 CASE WHEN m.role='student' THEN CASE WHEN dk LIKE 'resolved:%' THEN 'Report resolved' ELSE 'Report submitted' END ELSE t END,b,e,dk
 FROM public.campusops_members m WHERE m.college_id=c AND m.user_id=u AND m.active
 AND (k<>'booking' OR m.role='faculty')
 AND (m.role<>'student' OR (k='report' AND dk LIKE 'report:%') OR (k='incident' AND dk LIKE 'resolved:%'))
 ON CONFLICT(college_id,user_id,dedupe_key) DO NOTHING;
$$;
UPDATE public.campusops_notifications n SET kind=CASE WHEN n.dedupe_key LIKE 'resolved:%' THEN 'report_resolved' ELSE 'report_submitted' END,title=CASE WHEN n.dedupe_key LIKE 'resolved:%' THEN 'Report resolved' ELSE 'Report submitted' END
FROM public.campusops_members m WHERE m.college_id=n.college_id AND m.user_id=n.user_id AND m.role='student'
AND ((n.kind='report' AND n.dedupe_key LIKE 'report:%') OR (n.kind='incident' AND n.dedupe_key LIKE 'resolved:%'));
DROP POLICY IF EXISTS read ON public.campusops_notifications;
CREATE POLICY read ON public.campusops_notifications FOR SELECT TO authenticated USING(user_id=auth.uid() AND campusops_private.member(college_id)
AND (NOT campusops_private.has_role(college_id,ARRAY['student']) OR kind IN ('report_submitted','report_resolved'))
AND (kind<>'booking' OR campusops_private.has_role(college_id,ARRAY['faculty'])));
DROP POLICY IF EXISTS read ON public.campusops_bookings;
CREATE POLICY read ON public.campusops_bookings FOR SELECT TO authenticated USING(campusops_private.member(college_id) AND NOT campusops_private.has_role(college_id,ARRAY['student','report_admin']) AND (requested_by=auth.uid() OR campusops_private.ops(college_id,department_id)));
DROP POLICY IF EXISTS read ON public.campusops_classes;
CREATE POLICY read ON public.campusops_classes FOR SELECT TO authenticated USING(campusops_private.member(college_id) AND (faculty_id=auth.uid() OR campusops_private.ops(college_id,department_id)));
CREATE OR REPLACE FUNCTION public.campusops_classify_priority(p_description text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('priority',r.priority,'reason',r.reason,'rule',r.id) FROM public.campusops_priority_rules r WHERE left(coalesce(p_description,''),10000) ~* r.pattern ORDER BY r.priority,r.id LIMIT 1),jsonb_build_object('priority',3,'reason','Routine maintenance; no urgency rule matched.','rule','default'));
$$;
CREATE OR REPLACE FUNCTION public.campusops_submit_report(p_college uuid,p_campus uuid,p_department uuid,p_description text,
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
 pri=(public.campusops_classify_priority(p_description)->>'priority')::integer;
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
 jsonb_build_object('method','priority_rule_dataset','priority_reason',public.campusops_classify_priority(p_description)->>'reason','category',cat,'priority',pri,'confidence',CASE WHEN p_category IS NOT NULL THEN 1.0 ELSE 0.6 END,
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
CREATE OR REPLACE FUNCTION public.campusops_submit_report_v2(p_college uuid,p_campus uuid,p_department uuid,p_description text,p_room uuid DEFAULT NULL,p_category text DEFAULT 'general',p_equipment text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; BEGIN
 IF length(coalesce(p_equipment,''))>200 THEN RAISE EXCEPTION 'Equipment description must be at most 200 characters'; END IF;
 result=public.campusops_submit_report(p_college,p_campus,p_department,p_description,p_room,NULL,p_category,NULL);
 UPDATE public.campusops_reports SET equipment_description=nullif(trim(p_equipment),'') WHERE id=(result->>'report_id')::uuid;
 RETURN result||jsonb_build_object('priority',public.campusops_classify_priority(p_description));
END $$;
CREATE OR REPLACE FUNCTION campusops_private.eligible(c uuid,w uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.campusops_staff s JOIN public.campusops_members m USING(college_id,user_id)
 JOIN public.campusops_work_orders x ON x.college_id=s.college_id AND x.id=w
 JOIN public.campusops_incidents i ON i.id=x.incident_id
 WHERE s.college_id=c AND s.user_id=u AND s.available AND m.active AND m.role='technician' AND (s.campus_id=i.campus_id OR EXISTS(SELECT 1 FROM public.campusops_staff_campuses sc WHERE sc.college_id=c AND sc.user_id=u AND sc.campus_id=i.campus_id))
 AND EXISTS(SELECT 1 FROM public.campusops_shifts sh WHERE sh.college_id=c AND sh.user_id=u AND sh.starts_at<=now() AND sh.ends_at>=now()+x.estimated_minutes*interval '1 minute')
 AND NOT EXISTS(SELECT 1 FROM public.campusops_time_off t WHERE t.college_id=c AND t.user_id=u AND tstzrange(t.starts_at,t.ends_at,'[)') && tstzrange(now(),now()+x.estimated_minutes*interval '1 minute','[)'))
 AND NOT EXISTS(SELECT 1 FROM public.campusops_work_skills ws WHERE ws.work_order_id=w AND NOT EXISTS(SELECT 1 FROM public.campusops_staff_skills ss WHERE ss.college_id=c AND ss.user_id=u AND ss.skill_id=ws.skill_id))
 AND (SELECT count(*) FROM public.campusops_work_orders j WHERE j.college_id=c AND j.assigned_to=u AND j.id<>w AND j.status NOT IN ('completed','cancelled'))<s.max_open_jobs);
$$;
CREATE OR REPLACE FUNCTION campusops_private.assign_work(wid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.campusops_work_orders; selected uuid; BEGIN
 SELECT * INTO STRICT w FROM public.campusops_work_orders WHERE id=wid;
 PERFORM campusops_private.lock_college(w.college_id);
 IF w.manual_assignment OR w.status IN ('completed','cancelled') THEN RETURN w.assigned_to; END IF;
 SELECT s.user_id INTO selected FROM public.campusops_staff s WHERE s.college_id=w.college_id AND campusops_private.eligible(w.college_id,w.id,s.user_id)
 ORDER BY (SELECT coalesce(sum(j.estimated_minutes),0) FROM public.campusops_work_orders j WHERE j.college_id=w.college_id AND j.assigned_to=s.user_id AND j.id<>w.id AND j.status NOT IN ('completed','cancelled')),
 (SELECT coalesce(sum(ss.level),0) FROM public.campusops_staff_skills ss JOIN public.campusops_work_skills ws ON ws.skill_id=ss.skill_id AND ws.work_order_id=w.id WHERE ss.college_id=w.college_id AND ss.user_id=s.user_id) DESC,s.user_id LIMIT 1;
 UPDATE public.campusops_work_orders SET assigned_to=selected,
 status=CASE WHEN status IN ('open','assigned') THEN CASE WHEN selected IS NULL THEN 'open' ELSE 'assigned' END ELSE status END WHERE id=w.id;
 IF selected IS DISTINCT FROM w.assigned_to THEN
 IF w.assigned_to IS NOT NULL THEN PERFORM campusops_private.notify(w.college_id,w.assigned_to,'assignment','Work reassigned',w.title,w.id,'unassign:'||w.id||':'||clock_timestamp()); END IF;
 IF selected IS NOT NULL THEN PERFORM campusops_private.notify(w.college_id,selected,'assignment','New work order',w.title,w.id,'assign:'||w.id||':'||clock_timestamp()); END IF;
 END IF; RETURN selected; END $$;
CREATE OR REPLACE FUNCTION public.campusops_resolve_incident(p_incident uuid,p_summary text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.campusops_incidents; BEGIN SELECT * INTO i FROM public.campusops_incidents WHERE id=p_incident;
 IF NOT FOUND OR NOT (campusops_private.ops(i.college_id,i.department_id) OR campusops_private.review_student_incident(i.college_id,i.id)) THEN RAISE EXCEPTION 'Incident not accessible'; END IF;
 PERFORM campusops_private.lock_college(i.college_id);
 IF campusops_private.has_role(i.college_id,ARRAY['report_admin']) AND NOT EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE incident_id=i.id AND status='completed') THEN RAISE EXCEPTION 'A technician must complete the work first'; END IF;
 IF length(trim(coalesce(p_summary,'')))<5 THEN RAISE EXCEPTION 'Resolution summary required'; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE incident_id=i.id AND status NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'Finish or cancel all work orders first'; END IF;
 UPDATE public.campusops_incidents SET status='resolved',summary=p_summary WHERE id=i.id;
 UPDATE public.campusops_incident_rooms SET ends_at=greatest(now(),starts_at+interval '1 microsecond') WHERE incident_id=i.id AND ends_at IS NULL;
 UPDATE public.campusops_reports SET status='resolved' WHERE incident_id=i.id;
 PERFORM campusops_private.notify(i.college_id,r.reporter_id,'incident','Incident resolved',p_summary,i.id,'resolved:'||i.id)
 FROM public.campusops_reports r WHERE r.incident_id=i.id;
 END $$;
CREATE OR REPLACE FUNCTION public.campusops_complete_work(p_work uuid,p_note text,p_actual_cost numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.campusops_work_orders; BEGIN SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work;
 IF NOT FOUND OR w.assigned_to IS DISTINCT FROM auth.uid() OR NOT campusops_private.has_role(w.college_id,ARRAY['technician']) THEN RAISE EXCEPTION 'Assigned technician required'; END IF;
 PERFORM campusops_private.lock_college(w.college_id);
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work FOR UPDATE;
 IF w.assigned_to IS DISTINCT FROM auth.uid() OR w.status<>'in_progress' THEN RAISE EXCEPTION 'Only assigned work in progress can be completed'; END IF;
 IF length(trim(coalesce(p_note,'')))<5 OR p_actual_cost IS NULL OR p_actual_cost<0 OR p_actual_cost>w.budget_hold THEN RAISE EXCEPTION 'Completion note required; actual cost must not exceed approved/reserved estimate'; END IF;
 IF w.budget_id IS NOT NULL THEN UPDATE public.campusops_budgets SET reserved=reserved-w.budget_hold,spent=spent+p_actual_cost WHERE id=w.budget_id; END IF;
 UPDATE public.campusops_work_orders SET status='completed',completed_at=now(),completion_note=p_note,actual_cost=p_actual_cost,budget_hold=0 WHERE id=w.id;
 UPDATE public.campusops_bookings SET status='completed' WHERE work_order_id=w.id AND status='confirmed';
 IF w.asset_id IS NOT NULL THEN
 INSERT INTO public.campusops_maintenance_history(college_id,asset_id,work_order_id,technician_id,note,cost) VALUES(w.college_id,w.asset_id,w.id,auth.uid(),p_note,p_actual_cost);
 UPDATE public.campusops_assets SET status='operational' WHERE id=w.asset_id; END IF;
 -- Facilities explicitly close the incident after reviewing every associated job.
 PERFORM campusops_private.notify(w.college_id,m.user_id,'work','Work completed; review incident',p_note,w.id,'completed:'||w.id)
 FROM public.campusops_members m WHERE m.college_id=w.college_id AND m.active AND
 (m.role='facilities_admin' OR (m.role='report_admin' AND EXISTS(SELECT 1 FROM public.campusops_reports r JOIN public.campusops_members sm ON sm.college_id=r.college_id AND sm.user_id=r.reporter_id WHERE r.incident_id=w.incident_id AND sm.role='student')) OR (m.role='department_manager' AND m.department_id=w.department_id));
 END $$;
-- A separate report-admin role can dispatch student incidents, without booking, budget or account permissions.
CREATE OR REPLACE FUNCTION public.campusops_report_technicians(p_report uuid)
RETURNS TABLE(user_id uuid,full_name text,skills text,open_jobs bigint,max_jobs integer,can_assign boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_reports; BEGIN
 SELECT * INTO r FROM public.campusops_reports WHERE id=p_report;
 IF NOT FOUND OR NOT campusops_private.can_report(r.college_id,r.id) OR NOT (campusops_private.review_student_incident(r.college_id,r.incident_id) OR campusops_private.ops(r.college_id,r.department_id)) THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 RETURN QUERY SELECT s.user_id,m.full_name,
 (SELECT string_agg(sk.name,', ' ORDER BY sk.name) FROM public.campusops_staff_skills ss JOIN public.campusops_skills sk ON sk.id=ss.skill_id WHERE ss.college_id=s.college_id AND ss.user_id=s.user_id),
 j.total,s.max_open_jobs,
 s.available AND j.total<s.max_open_jobs
 AND EXISTS(SELECT 1 FROM public.campusops_shifts sh WHERE sh.college_id=r.college_id AND sh.user_id=s.user_id AND sh.starts_at<=now() AND sh.ends_at>=now()+interval '60 minutes')
 AND NOT EXISTS(SELECT 1 FROM public.campusops_time_off t WHERE t.college_id=r.college_id AND t.user_id=s.user_id AND tstzrange(t.starts_at,t.ends_at,'[)') && tstzrange(now(),now()+interval '60 minutes','[)'))
 FROM public.campusops_staff s JOIN public.campusops_members m USING(college_id,user_id)
 CROSS JOIN LATERAL (SELECT count(*) total FROM public.campusops_work_orders w WHERE w.college_id=s.college_id AND w.assigned_to=s.user_id AND w.incident_id<>r.incident_id AND w.status NOT IN ('completed','cancelled')) j
 WHERE s.college_id=r.college_id AND m.role='technician' AND m.active
 AND (s.campus_id=r.campus_id OR EXISTS(SELECT 1 FROM public.campusops_staff_campuses sc WHERE sc.college_id=r.college_id AND sc.user_id=s.user_id AND sc.campus_id=r.campus_id))
 AND EXISTS(SELECT 1 FROM public.campusops_report_categories cat JOIN public.campusops_staff_skills ss ON ss.college_id=cat.college_id AND ss.skill_id=cat.skill_id WHERE cat.college_id=r.college_id AND cat.code=r.category AND ss.user_id=s.user_id)
 ORDER BY m.full_name;
END $$;
CREATE OR REPLACE FUNCTION public.campusops_dispatch_report(p_report uuid,p_technician uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_reports; i public.campusops_incidents; w public.campusops_work_orders; sl public.campusops_sla_policies; sk uuid; wid uuid; BEGIN
 SELECT * INTO r FROM public.campusops_reports WHERE id=p_report;
 IF NOT FOUND OR NOT campusops_private.can_report(r.college_id,r.id) OR NOT (campusops_private.review_student_incident(r.college_id,r.incident_id) OR campusops_private.ops(r.college_id,r.department_id)) THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 PERFORM campusops_private.lock_college(r.college_id);
 SELECT * INTO r FROM public.campusops_reports WHERE id=p_report FOR UPDATE;
 SELECT * INTO i FROM public.campusops_incidents WHERE id=r.incident_id FOR UPDATE;
 IF i.status IN ('resolved','closed') THEN RAISE EXCEPTION 'This incident is already resolved'; END IF;
 IF r.room_id IS NULL THEN RAISE EXCEPTION 'Ask the reporter to supply the room before dispatching'; END IF;
 SELECT skill_id INTO sk FROM public.campusops_report_categories WHERE college_id=r.college_id AND code=i.category;
 IF sk IS NULL THEN RAISE EXCEPTION 'Configure the technician skill for this category'; END IF;
 SELECT * INTO w FROM public.campusops_work_orders WHERE incident_id=i.id AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   IF NOT w.manual_assignment OR w.status NOT IN ('open','assigned') THEN RAISE EXCEPTION 'Work already started or completed; review its status before dispatching'; END IF;
   wid=w.id;
 ELSE
   SELECT * INTO STRICT sl FROM public.campusops_sla_policies WHERE college_id=r.college_id AND category=i.category AND priority=i.priority;
   INSERT INTO public.campusops_work_orders(college_id,incident_id,department_id,title,priority,requested_by,estimated_minutes,response_due_at,due_at,manual_assignment)
   VALUES(r.college_id,i.id,r.department_id,left(r.description,160),i.priority,auth.uid(),60,i.created_at+sl.response_minutes*interval '1 minute',i.created_at+sl.resolution_minutes*interval '1 minute',true) RETURNING id INTO wid;
   INSERT INTO public.campusops_work_skills(college_id,work_order_id,skill_id) VALUES(r.college_id,wid,sk);
 END IF;
 IF NOT campusops_private.eligible(r.college_id,wid,p_technician) THEN RAISE EXCEPTION 'Technician must cover this campus and skill, be available, on shift and below capacity'; END IF;
 IF w.assigned_to IS NOT NULL AND w.assigned_to<>p_technician THEN
 PERFORM campusops_private.notify(r.college_id,w.assigned_to,'assignment','Work reassigned',r.description,wid,'unassign:'||wid||':'||clock_timestamp()); END IF;
 UPDATE public.campusops_work_orders SET assigned_to=p_technician,status='assigned',manual_assignment=true,acknowledged_at=CASE WHEN assigned_to=p_technician THEN acknowledged_at ELSE NULL END WHERE id=wid;
 UPDATE public.campusops_reports SET status='triaged' WHERE incident_id=i.id AND status='submitted';
 IF w.assigned_to IS DISTINCT FROM p_technician THEN
 PERFORM campusops_private.notify(r.college_id,p_technician,'assignment','New student report assigned',r.description,wid,'dispatch:'||wid||':'||clock_timestamp()); END IF;
 RETURN wid;
END $$;

DO $seed$
DECLARE
 c uuid='10000000-0000-4000-8000-000000000001'; main uuid='20000000-0000-4000-8000-000000000001';
 cse uuid='30000000-0000-4000-8000-000000000001'; itdept uuid; ecedept uuid; sub uuid; techblock uuid; eblock uuid;
 sk uuid; uid uuid; existing uuid; n integer; p integer; row record; skillname text;
 emails text[]=ARRAY['reportsadmin','mechanic','carpenter','cleaning','civil','safety'];
 names text[]=ARRAY['Report Administrator','Mani - Mechanic','Kavya - Carpenter','Sana - Housekeeping','Ravi - Civil Maintenance','Leela - Safety Equipment'];
 specialties text[]=ARRAY['','Mechanical','Carpentry','Cleaning','Civil repairs','Safety equipment'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_colleges WHERE id=c) THEN RAISE EXCEPTION 'Run the original CampusOps setup first'; END IF;
 UPDATE public.campusops_departments SET name='CSE' WHERE id=cse AND college_id=c AND name='Engineering';
 INSERT INTO public.campusops_departments(college_id,name) VALUES(c,'IT') ON CONFLICT(college_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO itdept;
 INSERT INTO public.campusops_departments(college_id,name) VALUES(c,'ECE') ON CONFLICT(college_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO ecedept;
 UPDATE public.campusops_members SET department_id=itdept WHERE college_id=c AND user_id='b0000000-0000-4000-8000-000000000002';
 UPDATE public.campusops_members SET department_id=ecedept WHERE college_id=c AND user_id='b0000000-0000-4000-8000-000000000003';
 INSERT INTO public.campusops_campuses(college_id,name,address) VALUES(c,'Sub Campus','Secondary teaching and technology campus') ON CONFLICT(college_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO sub;
 INSERT INTO public.campusops_buildings(college_id,campus_id,name) VALUES(c,sub,'Technology Block') ON CONFLICT(college_id,campus_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO techblock;
 INSERT INTO public.campusops_buildings(college_id,campus_id,name) VALUES(c,sub,'Electronics Block') ON CONFLICT(college_id,campus_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO eblock;
 INSERT INTO public.campusops_rooms(college_id,building_id,department_id,name,capacity,equipment) VALUES
 (c,techblock,cse,'T-101',60,ARRAY['Projector','Whiteboard']), (c,techblock,cse,'T-102',40,ARRAY['Computers','Network access']),
 (c,techblock,itdept,'T-201',40,ARRAY['Computers','Projector']), (c,eblock,ecedept,'E-101',50,ARRAY['Whiteboard','Projector']),
 (c,eblock,ecedept,'E-102',30,ARRAY['Oscilloscopes','Workbenches']), (c,eblock,itdept,'E-201',30,ARRAY['Computers','Network access'])
 ON CONFLICT(college_id,building_id,name) DO NOTHING;
 FOR row IN SELECT * FROM (VALUES
 ('electrical','Electrical','Electrical'),('plumbing','Plumbing & water','Plumbing'),('it','IT & network','IT support'),('hvac','Air conditioning & ventilation','HVAC'),
 ('mechanical','Mechanical equipment','Mechanical'),('carpentry','Furniture & carpentry','Carpentry'),('cleaning','Cleaning & sanitation','Cleaning'),('civil','Buildings & civil repairs','Civil repairs'),('safety','Fire & safety equipment','Safety equipment'),('general','General maintenance','General maintenance')
 ) AS x(code,label,skill) LOOP
 INSERT INTO public.campusops_skills(college_id,name) VALUES(c,row.skill) ON CONFLICT(college_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO sk;
 INSERT INTO public.campusops_report_categories(college_id,code,name,skill_id) VALUES(c,row.code,row.label,sk) ON CONFLICT(college_id,code) DO UPDATE SET name=excluded.name,skill_id=excluded.skill_id;
 FOR p IN 1..4 LOOP
 INSERT INTO public.campusops_sla_policies(college_id,category,priority,response_minutes,resolution_minutes) VALUES(c,row.code,p,(ARRAY[15,60,240,480])[p],(ARRAY[120,480,1440,4320])[p]) ON CONFLICT(college_id,category,priority) DO NOTHING;
 END LOOP; END LOOP;
 FOR n IN 1..6 LOOP
 uid=('b0000000-0000-4000-8000-'||lpad((n+12)::text,12,'0'))::uuid;
 SELECT id INTO existing FROM auth.users WHERE lower(email)=emails[n]||'@campusops.example';
 IF existing IS NOT NULL AND existing<>uid THEN RAISE EXCEPTION 'Email already belongs to another account: %',emails[n]; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND lower(email)<>emails[n]||'@campusops.example') THEN RAISE EXCEPTION 'Account ID collision; no account changed'; END IF;
 IF existing IS NULL THEN
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token,email_change_confirm_status,is_sso_user,is_anonymous)
 VALUES('00000000-0000-0000-0000-000000000000',uid,'authenticated','authenticated',emails[n]||'@campusops.example',extensions.crypt(current_setting('app.campusops_demo_password'),extensions.gen_salt('bf',10)),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',names[n]),false,now(),now(),'','','','','','','','',0,false,false);
 INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) VALUES(gen_random_uuid(),uid::text,uid,jsonb_build_object('sub',uid::text,'email',emails[n]||'@campusops.example','email_verified',true,'phone_verified',false),'email',now(),now(),now());
 END IF;
 INSERT INTO public.campusops_members(college_id,user_id,full_name,role,department_id) VALUES(c,uid,names[n],CASE WHEN n=1 THEN 'report_admin' ELSE 'technician' END,NULL) ON CONFLICT(college_id,user_id) DO NOTHING;
 IF n>1 THEN
 INSERT INTO public.campusops_staff(college_id,user_id,campus_id) VALUES(c,uid,sub) ON CONFLICT(college_id,user_id) DO NOTHING;
 SELECT id INTO sk FROM public.campusops_skills WHERE college_id=c AND name=specialties[n];
 INSERT INTO public.campusops_staff_skills(college_id,user_id,skill_id,level) VALUES(c,uid,sk,5) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_shifts WHERE college_id=c AND user_id=uid AND reason='Campus expansion demo coverage') THEN
 INSERT INTO public.campusops_shifts(college_id,user_id,starts_at,ends_at,reason) VALUES(c,uid,now()-interval '1 hour',now()+interval '30 days','Campus expansion demo coverage'); END IF;
 END IF; END LOOP;
 -- Explicit multi-campus coverage for this college's demo maintenance team.
 INSERT INTO public.campusops_staff_campuses(college_id,user_id,campus_id) SELECT s.college_id,s.user_id,cp.id FROM public.campusops_staff s JOIN public.campusops_campuses cp ON cp.college_id=s.college_id WHERE s.college_id=c ON CONFLICT DO NOTHING;
 SELECT id INTO sk FROM public.campusops_skills WHERE college_id=c AND name='General maintenance';
 INSERT INTO public.campusops_staff_skills(college_id,user_id,skill_id,level) SELECT college_id,user_id,sk,3 FROM public.campusops_staff WHERE college_id=c ON CONFLICT DO NOTHING;
END $seed$;
REVOKE ALL ON FUNCTION campusops_private.review_student_incident(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION campusops_private.review_student_incident(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.campusops_classify_priority(text),public.campusops_submit_report_v2(uuid,uuid,uuid,text,uuid,text,text),public.campusops_report_technicians(uuid),public.campusops_dispatch_report(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_classify_priority(text),public.campusops_submit_report_v2(uuid,uuid,uuid,text,uuid,text,text),public.campusops_report_technicians(uuid),public.campusops_dispatch_report(uuid,uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'CampusOps report-admin upgrade installed' AS result;
