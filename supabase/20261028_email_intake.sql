BEGIN;
CREATE TABLE public.campusops_email_intake (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL REFERENCES public.campusops_colleges(id),
 message_id text NOT NULL, sender text NOT NULL, subject text NOT NULL, body text NOT NULL CHECK(length(body)<=10000),
 received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 assessment jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','created','rejected')),
 report_id uuid REFERENCES public.campusops_reports(id), reviewed_by uuid, reviewed_at timestamptz,
 UNIQUE(college_id,message_id)
);
ALTER TABLE public.campusops_email_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campusops_email_intake FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.campusops_email_intake TO authenticated;
GRANT ALL ON public.campusops_email_intake TO service_role;
CREATE POLICY inbox_staff ON public.campusops_email_intake FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['report_admin']));
CREATE FUNCTION public.campusops_review_email(p_email uuid,p_reject boolean,p_room uuid DEFAULT NULL,p_category text DEFAULT NULL,p_priority integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.campusops_email_intake; r public.campusops_rooms; cp uuid; student uuid; result jsonb; rid uuid;
BEGIN
 SELECT * INTO e FROM public.campusops_email_intake WHERE id=p_email FOR UPDATE;
 IF NOT FOUND OR NOT campusops_private.has_role(e.college_id,ARRAY['report_admin']) THEN RAISE EXCEPTION 'Report administrator required'; END IF;
 IF e.status<>'pending' THEN RETURN e.report_id; END IF;
 IF p_reject IS NULL THEN RAISE EXCEPTION 'Decision required'; END IF;
 IF p_reject THEN UPDATE public.campusops_email_intake SET status='rejected',reviewed_by=auth.uid(),reviewed_at=now() WHERE id=e.id; RETURN NULL; END IF;
 SELECT u.id INTO student FROM auth.users u JOIN public.campusops_members m ON m.user_id=u.id WHERE lower(u.email)=lower(e.sender) AND m.college_id=e.college_id AND m.active AND m.role='student';
 IF student IS NULL THEN RAISE EXCEPTION 'Sender must match an active registered student; verify sender before creating a report'; END IF;
 SELECT * INTO r FROM public.campusops_rooms WHERE id=p_room AND college_id=e.college_id;
 IF NOT FOUND OR r.department_id IS NULL THEN RAISE EXCEPTION 'Select a mapped room'; END IF;
 SELECT campus_id INTO cp FROM public.campusops_buildings WHERE id=r.building_id AND college_id=e.college_id;
 IF p_priority IS NULL OR p_priority NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Select valid priority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_report_categories WHERE college_id=e.college_id AND code=p_category) THEN RAISE EXCEPTION 'Select valid category'; END IF;
 result=campusops_private.submit_ai_report(e.college_id,cp,r.department_id,e.subject||E'\n'||e.body,r.id,NULL,p_category,p_priority);
 rid=(result->>'report_id')::uuid;
 UPDATE public.campusops_reports SET reporter_id=student,extraction=extraction||jsonb_build_object('source','email','email_intake_id',e.id,'ai',e.assessment,'reviewed_by',auth.uid()) WHERE id=rid;
 PERFORM campusops_private.notify(e.college_id,student,'report','Email report received','Your email was reviewed and recorded.',rid,'email:'||e.id);
 UPDATE public.campusops_email_intake SET status='created',report_id=rid,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=e.id;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.campusops_review_email(uuid,boolean,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_review_email(uuid,boolean,uuid,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
