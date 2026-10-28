-- Run in Supabase SQL Editor after the report-admin upgrade. Transactional and rerunnable.
-- To provision demo faculty logins, set app.campusops_demo_password privately in this SQL session before running.
BEGIN;
DO $$ BEGIN
 IF NULLIF(current_setting('app.campusops_demo_password', true), '') IS NULL THEN
  RAISE EXCEPTION 'Set app.campusops_demo_password privately before running this account-seeding migration';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.campusops_request_repair_approval(p_work uuid,p_reason text,p_emergency boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.campusops_work_orders; result uuid; BEGIN
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work;
 IF NOT FOUND OR NOT (campusops_private.ops(w.college_id,w.department_id) OR (w.assigned_to=auth.uid() AND campusops_private.has_role(w.college_id,ARRAY['technician']))) THEN RAISE EXCEPTION 'Work not accessible'; END IF;
 PERFORM campusops_private.lock_college(w.college_id);
 IF w.status IN ('in_progress','completed','cancelled') THEN RAISE EXCEPTION 'Work has already started or ended'; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=w.id AND kind IN ('repair','emergency') AND status IN ('pending','approved')) THEN RAISE EXCEPTION 'An approval request already exists'; END IF;
 INSERT INTO public.campusops_approvals(college_id,department_id,requested_by,kind,work_order_id,budget_id,amount,reason)
 VALUES(w.college_id,w.department_id,auth.uid(),CASE WHEN p_emergency THEN 'emergency' ELSE 'repair' END,w.id,w.budget_id,w.estimated_cost,p_reason) RETURNING id INTO result;
 UPDATE public.campusops_work_orders SET status='waiting_approval' WHERE id=w.id;
 RETURN result; END $$;
CREATE OR REPLACE FUNCTION public.campusops_decide_approval(p_approval uuid,p_approve boolean,p_comment text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_approvals; needed text; result text; BEGIN
 SELECT * INTO r FROM public.campusops_approvals WHERE id=p_approval;
 IF NOT FOUND THEN RAISE EXCEPTION 'Approval not found'; END IF;
 PERFORM campusops_private.lock_college(r.college_id);
 SELECT * INTO r FROM public.campusops_approvals WHERE id=p_approval FOR UPDATE;
 IF r.status<>'pending' OR p_approve IS NULL THEN RAISE EXCEPTION 'Approval is not pending or decision missing'; END IF;
 needed=CASE WHEN r.current_stage=1 THEN 'department_manager' WHEN r.kind='booking_override' THEN 'facilities_admin' ELSE 'facilities_admin' END;
 IF NOT (campusops_private.has_role(r.college_id,ARRAY[needed],r.department_id) OR (r.kind IN ('material','repair') AND r.current_stage=1 AND EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=r.college_id AND user_id=auth.uid() AND active AND role='department_manager'))) THEN RAISE EXCEPTION 'This stage requires %',needed; END IF;
 IF r.requested_by=auth.uid() OR EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE id=r.work_order_id AND requested_by=auth.uid())
 OR EXISTS(SELECT 1 FROM public.campusops_approval_decisions WHERE approval_id=r.id AND decided_by=auth.uid()) THEN RAISE EXCEPTION 'No self-approval; each stage requires a different person'; END IF;
 INSERT INTO public.campusops_approval_decisions(college_id,approval_id,stage,decided_by,required_role,decision,comment)
 VALUES(r.college_id,r.id,r.current_stage,auth.uid(),needed,CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,p_comment);
 result=CASE WHEN NOT p_approve THEN 'rejected' WHEN r.current_stage=2 OR r.kind<>'booking_override' THEN 'approved' ELSE 'pending' END;
 UPDATE public.campusops_approvals SET status=result,current_stage=CASE WHEN p_approve AND result='pending' THEN 2 ELSE current_stage END WHERE id=r.id;
 IF r.kind='material' AND NOT EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE id=r.work_order_id AND status NOT IN ('in_progress','completed','cancelled')) THEN RAISE EXCEPTION 'This job can no longer receive materials'; END IF;
 IF result='approved' AND r.kind='material' THEN
 INSERT INTO public.campusops_work_parts(college_id,work_order_id,stock_id,quantity)
 VALUES(r.college_id,r.work_order_id,(r.payload->>'stock_id')::uuid,(r.payload->>'quantity')::numeric)
 ON CONFLICT(college_id,work_order_id,stock_id) DO UPDATE SET quantity=public.campusops_work_parts.quantity+excluded.quantity;
 END IF;
 IF result='approved' AND r.work_order_id IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=r.work_order_id AND status='pending') THEN
 UPDATE public.campusops_work_orders SET status=CASE WHEN assigned_to IS NULL THEN 'open' ELSE 'assigned' END WHERE id=r.work_order_id AND status='waiting_approval';
 END IF;
 PERFORM campusops_private.notify(r.college_id,w.assigned_to,'approval','Manager approved your request','Open your job and select Start Work. Stock, schedule and budget checks still apply.',w.id,'ready:'||r.id)
 FROM public.campusops_work_orders w WHERE w.id=r.work_order_id;
 END IF;
 PERFORM campusops_private.notify(r.college_id,r.requested_by,'approval','Approval updated',result,r.id,'decision:'||r.id||':'||r.current_stage);
 RETURN result; END $$;
CREATE OR REPLACE FUNCTION campusops_private.valid_approval(aid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.campusops_approvals a WHERE a.id=aid AND a.status='approved'
 AND (SELECT count(*) FROM public.campusops_approval_decisions d JOIN public.campusops_members m
 ON m.college_id=d.college_id AND m.user_id=d.decided_by
 WHERE d.approval_id=a.id AND (a.kind='booking_override' OR d.stage=1) AND d.decision='approved' AND d.decided_by<>a.requested_by
 AND m.active AND m.role=d.required_role AND (m.role<>'department_manager' OR a.kind IN ('material','repair') OR m.department_id=a.department_id))=CASE WHEN a.kind<>'booking_override' THEN 1 ELSE 2 END);
$$;
CREATE OR REPLACE FUNCTION campusops_private.approval_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE needed text; BEGIN
 IF NEW.status='pending' THEN
 needed=CASE WHEN NEW.current_stage=1 THEN 'department_manager' WHEN NEW.kind='booking_override' THEN 'facilities_admin' ELSE 'facilities_admin' END;
 PERFORM campusops_private.notify(NEW.college_id,m.user_id,'approval','Approval requested',NEW.reason,NEW.id,'approval:'||NEW.id||':'||NEW.current_stage)
 FROM public.campusops_members m WHERE m.college_id=NEW.college_id AND m.active AND m.role=needed AND m.user_id<>NEW.requested_by
 AND (needed<>'department_manager' OR NEW.kind IN ('material','repair') OR m.department_id=NEW.department_id);
 END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.campusops_start_work(p_work uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.campusops_work_orders; b public.campusops_budgets; ap uuid; p record; room record; limit_cost numeric; BEGIN
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work;
 IF NOT FOUND OR w.assigned_to IS DISTINCT FROM auth.uid() OR NOT campusops_private.has_role(w.college_id,ARRAY['technician']) THEN RAISE EXCEPTION 'Assigned technician required'; END IF;
 PERFORM campusops_private.lock_college(w.college_id);
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work FOR UPDATE;
 IF w.assigned_to IS DISTINCT FROM auth.uid() OR w.status IN ('in_progress','completed','cancelled') THEN RAISE EXCEPTION 'Work cannot be started'; END IF;
 IF NOT campusops_private.eligible(w.college_id,w.id,w.assigned_to) THEN RAISE EXCEPTION 'Technician no longer eligible, available or on shift'; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE college_id=w.college_id AND assigned_to=auth.uid() AND status='in_progress' AND id<>w.id) THEN RAISE EXCEPTION 'Complete the current work before starting another'; END IF;
 SELECT repair_approval_limit INTO limit_cost FROM public.campusops_colleges WHERE id=w.college_id;
 IF EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=w.id AND kind='material' AND status='pending') THEN
 UPDATE public.campusops_work_orders SET status='waiting_approval' WHERE id=w.id;
 RETURN 'waiting_approval'; END IF;
 IF w.estimated_cost>limit_cost OR EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=w.id AND kind IN ('repair','emergency') AND status<>'cancelled') THEN
 SELECT id INTO ap FROM public.campusops_approvals WHERE work_order_id=w.id AND kind IN ('repair','emergency')
 AND amount=w.estimated_cost AND budget_id IS NOT DISTINCT FROM w.budget_id AND campusops_private.valid_approval(id)
 ORDER BY created_at DESC LIMIT 1;
 IF ap IS NULL THEN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=w.id AND kind IN ('repair','emergency') AND status='pending') THEN
 PERFORM public.campusops_request_repair_approval(w.id,'Technician requests authorization to start: '||w.title);
 END IF;
 UPDATE public.campusops_work_orders SET status='waiting_approval' WHERE id=w.id;
 RETURN 'waiting_approval'; END IF;
 END IF;
 IF NOT campusops_private.reserve_parts(w.id) THEN RETURN 'blocked_parts'; END IF;
 -- A missing class relocation is caught by the booking exclusion constraint here.
 FOR room IN SELECT room_id FROM public.campusops_incident_rooms WHERE incident_id=w.incident_id ORDER BY room_id LOOP
 PERFORM campusops_private.make_booking(w.college_id,room.room_id,'Maintenance: '||w.title,now(),now()+w.estimated_minutes*interval '1 minute',1,'{}',NULL,'maintenance',auth.uid(),w.id);
 END LOOP;
 IF w.estimated_cost>0 THEN
 SELECT * INTO STRICT b FROM public.campusops_budgets WHERE id=w.budget_id AND college_id=w.college_id FOR UPDATE;
 IF b.department_id<>w.department_id OR current_date NOT BETWEEN b.starts_on AND b.ends_on OR b.allocated-b.spent-b.reserved<w.estimated_cost THEN RAISE EXCEPTION 'Budget no longer sufficient or valid'; END IF;
 UPDATE public.campusops_budgets SET reserved=reserved+w.estimated_cost WHERE id=b.id;
 END IF;
 FOR p IN SELECT * FROM public.campusops_work_parts WHERE work_order_id=w.id ORDER BY stock_id LOOP
 UPDATE public.campusops_stock SET on_hand=on_hand-p.quantity,reserved=reserved-p.quantity WHERE id=p.stock_id;
 UPDATE public.campusops_work_parts SET reserved_quantity=0,consumed_quantity=quantity WHERE id=p.id;
 INSERT INTO public.campusops_stock_movements(college_id,stock_id,work_order_id,actor_id,kind,quantity) VALUES(w.college_id,p.stock_id,w.id,auth.uid(),'consume',p.quantity);
 END LOOP;
 UPDATE public.campusops_work_orders SET status='in_progress',started_at=now(),acknowledged_at=coalesce(acknowledged_at,now()),budget_hold=estimated_cost WHERE id=w.id;
 UPDATE public.campusops_incidents SET status='in_progress' WHERE id=w.incident_id;
 UPDATE public.campusops_reports SET status='in_progress' WHERE incident_id=w.incident_id;
 IF w.asset_id IS NOT NULL THEN UPDATE public.campusops_assets SET status='maintenance' WHERE id=w.asset_id; END IF;
 IF ap IS NOT NULL THEN UPDATE public.campusops_approvals SET status='executed',executed_at=now() WHERE id=ap; END IF;
 PERFORM campusops_private.notify(w.college_id,r.reporter_id,'work','Repair started',w.title,w.id,'started:'||w.id)
 FROM public.campusops_reports r WHERE r.incident_id=w.incident_id;
 RETURN 'in_progress'; END $$;
ALTER TABLE public.campusops_approvals DROP CONSTRAINT IF EXISTS campusops_approvals_kind_check;
ALTER TABLE public.campusops_approvals ADD CONSTRAINT campusops_approvals_kind_check CHECK(kind IN ('repair','purchase','booking_override','emergency','material'));
CREATE OR REPLACE FUNCTION public.campusops_request_material(p_work uuid,p_stock uuid,p_quantity numeric,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.campusops_work_orders; result uuid; itemname text;
BEGIN
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work;
 IF NOT FOUND OR w.assigned_to IS DISTINCT FROM auth.uid() OR NOT campusops_private.has_role(w.college_id,ARRAY['technician']) THEN RAISE EXCEPTION 'Assigned technician required'; END IF;
 PERFORM campusops_private.lock_college(w.college_id);
 SELECT * INTO w FROM public.campusops_work_orders WHERE id=p_work FOR UPDATE;
 IF w.assigned_to IS DISTINCT FROM auth.uid() OR w.status IN ('in_progress','completed','cancelled') THEN RAISE EXCEPTION 'Request materials before starting work'; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity='NaN'::numeric OR length(trim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'Positive quantity and reason required'; END IF;
 SELECT i.name INTO itemname FROM public.campusops_stock s JOIN public.campusops_inventory_items i ON i.id=s.item_id WHERE s.id=p_stock AND s.college_id=w.college_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Material does not belong to this college'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=w.college_id AND active AND role='department_manager' AND user_id<>auth.uid()) THEN RAISE EXCEPTION 'No active manager available'; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_approvals WHERE work_order_id=w.id AND kind='material' AND status='pending' AND payload->>'stock_id'=p_stock::text) THEN RAISE EXCEPTION 'This material already has a pending request'; END IF;
 INSERT INTO public.campusops_approvals(college_id,department_id,requested_by,kind,work_order_id,reason,payload)
 VALUES(w.college_id,w.department_id,auth.uid(),'material',w.id,p_reason,jsonb_build_object('stock_id',p_stock,'item_name',itemname,'quantity',p_quantity)) RETURNING id INTO result;
 UPDATE public.campusops_work_orders SET status='waiting_approval' WHERE id=w.id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.campusops_request_material(uuid,uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_request_material(uuid,uuid,numeric,text) TO authenticated,service_role;

-- Managers can review technician material/repair requests across the college.
DROP POLICY IF EXISTS technician_requests_manager ON public.campusops_approvals;
CREATE POLICY technician_requests_manager ON public.campusops_approvals FOR SELECT TO authenticated USING(kind IN ('material','repair') AND EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=campusops_approvals.college_id AND m.user_id=auth.uid() AND m.active AND m.role='department_manager'));

-- Restore a working request for jobs that were previously stuck without one.
INSERT INTO public.campusops_approvals(college_id,department_id,requested_by,kind,work_order_id,budget_id,amount,reason)
SELECT w.college_id,w.department_id,w.assigned_to,'repair',w.id,w.budget_id,w.estimated_cost,'Technician authorization for '||w.title
FROM public.campusops_work_orders w WHERE w.status='waiting_approval' AND w.assigned_to IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM public.campusops_approvals a WHERE a.work_order_id=w.id AND a.status IN ('pending','approved'));

-- Existing second-stage repair requests already approved by a manager need no procurement stage.
UPDATE public.campusops_approvals a SET status='approved'
WHERE a.kind<>'booking_override' AND a.status='pending' AND a.current_stage=2
AND EXISTS(SELECT 1 FROM public.campusops_approval_decisions d WHERE d.approval_id=a.id AND d.stage=1 AND d.decision='approved' AND d.required_role='department_manager');

-- These three accounts lose website access; keep their rows for linked history.
-- No manager account, manager membership or manager password is changed.
DO $remove$
DECLARE r record;
BEGIN
 FOR r IN SELECT u.id FROM auth.users u JOIN public.campusops_members m ON m.user_id=u.id
 WHERE m.college_id='10000000-0000-4000-8000-000000000001' AND m.active
 AND lower(u.email) IN ('procurement@campusops.example','it@campusops.example','hvac@campusops.example') LOOP
 IF EXISTS(SELECT 1 FROM public.campusops_work_orders WHERE assigned_to=r.id AND status NOT IN ('completed','cancelled')) THEN
 RAISE EXCEPTION 'Reassign unfinished jobs before removing account %',r.id;
 END IF;
 UPDATE public.campusops_members SET active=false WHERE user_id=r.id AND college_id='10000000-0000-4000-8000-000000000001';
 UPDATE public.campusops_staff SET available=false WHERE user_id=r.id AND college_id='10000000-0000-4000-8000-000000000001';
 UPDATE auth.users SET banned_until=now() + interval '100 years' WHERE id=r.id AND lower(email) IN ('procurement@campusops.example','it@campusops.example','hvac@campusops.example');
 END LOOP;
END $remove$;

-- Rename the identified English faculty login, preserving identity, password and linked records.
DO $english$
DECLARE u uuid;
BEGIN
 SELECT id INTO u FROM auth.users WHERE lower(email)='faculty@campusops.example' AND id='b0000000-0000-4000-8000-000000000004';
 IF u IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)='facultyenglish@campusops.example' AND id<>u) THEN RAISE EXCEPTION 'English email is already in use'; END IF;
 UPDATE auth.users SET email='facultyenglish@campusops.example',updated_at=now() WHERE id=u;
 UPDATE auth.identities SET identity_data=jsonb_set(identity_data,'{email}','"facultyenglish@campusops.example"'),updated_at=now() WHERE user_id=u AND provider='email';
 END IF;
 UPDATE public.campusops_classes SET title='English',code='ENG101' WHERE faculty_id='b0000000-0000-4000-8000-000000000004' AND code='ENG101';
END $english$;

-- Additional demo faculty. Existing matching accounts are never overwritten.
DO $faculty$
DECLARE n integer; uid uuid; existing uuid; c uuid='10000000-0000-4000-8000-000000000001'; d uuid='30000000-0000-4000-8000-000000000001';
 emails text[]=ARRAY['facultymaths','facultyphysics','facultychemistry'];
 names text[]=ARRAY['Dr Neha Sharma','Dr Vikram Iyer','Dr Kavita Menon'];
 subjects text[]=ARRAY['Mathematics','Physics','Chemistry']; codes text[]=ARRAY['MAT101','PHY101','CHE101'];
BEGIN
 FOR n IN 1..3 LOOP
 uid=('b0000000-0000-4000-8000-'||lpad((18+n)::text,12,'0'))::uuid;
 SELECT id INTO existing FROM auth.users WHERE lower(email)=emails[n]||'@campusops.example';
 IF existing IS NOT NULL AND existing<>uid THEN RAISE EXCEPTION 'Faculty email collision: %',emails[n]; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND lower(email)<>emails[n]||'@campusops.example') THEN RAISE EXCEPTION 'Faculty ID collision'; END IF;
 IF existing IS NULL THEN
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token,email_change_confirm_status,is_sso_user,is_anonymous)
 VALUES('00000000-0000-0000-0000-000000000000',uid,'authenticated','authenticated',emails[n]||'@campusops.example',extensions.crypt(current_setting('app.campusops_demo_password'),extensions.gen_salt('bf',10)),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',names[n]),false,now(),now(),'','','','','','','','',0,false,false);
 INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) VALUES(gen_random_uuid(),uid::text,uid,jsonb_build_object('sub',uid::text,'email',emails[n]||'@campusops.example','email_verified',true,'phone_verified',false),'email',now(),now(),now());
 END IF;
 INSERT INTO public.campusops_members(college_id,user_id,full_name,role,department_id) VALUES(c,uid,names[n],'faculty',d) ON CONFLICT(college_id,user_id) DO NOTHING;
 INSERT INTO public.campusops_classes(college_id,department_id,faculty_id,code,title,student_count,equipment) VALUES(c,d,uid,codes[n],subjects[n],25,'{}') ON CONFLICT(college_id,code) DO NOTHING;
 END LOOP;
END $faculty$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'Booking/materials/account upgrade installed' AS result;
-- Full register, including inactive accounts and actual Auth email addresses:
SELECT m.full_name,u.email,m.role,m.active,d.name AS department
FROM public.campusops_members m JOIN auth.users u ON u.id=m.user_id
LEFT JOIN public.campusops_departments d ON d.id=m.department_id
WHERE m.college_id='10000000-0000-4000-8000-000000000001' ORDER BY m.role,m.full_name;
