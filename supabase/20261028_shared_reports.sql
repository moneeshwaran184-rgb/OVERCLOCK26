BEGIN;
CREATE TABLE IF NOT EXISTS public.campusops_report_supporters (
 report_id uuid NOT NULL REFERENCES public.campusops_reports(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(report_id,user_id));
ALTER TABLE public.campusops_report_supporters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campusops_reports ADD COLUMN IF NOT EXISTS supporter_count integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.campusops_shared_reports(p_college uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=p_college AND user_id=auth.uid() AND active AND role='student') THEN RAISE EXCEPTION 'Student membership required'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
 SELECT r.id,r.description,r.category,r.priority,r.status,r.created_at,r.supporter_count,
 c.name campus_name,b.name building_name,rm.name room_name,r.reporter_id=auth.uid() own_report,
 EXISTS(SELECT 1 FROM public.campusops_report_supporters s WHERE s.report_id=r.id AND s.user_id=auth.uid()) joined
 FROM public.campusops_reports r JOIN public.campusops_members m ON m.college_id=r.college_id AND m.user_id=r.reporter_id
 LEFT JOIN public.campusops_rooms rm ON rm.id=r.room_id LEFT JOIN public.campusops_buildings b ON b.id=rm.building_id LEFT JOIN public.campusops_campuses c ON c.id=r.campus_id
 WHERE r.college_id=p_college AND m.role='student' ORDER BY r.created_at DESC LIMIT 500) x),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.campusops_join_report(p_report uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_reports; added integer;
BEGIN
 SELECT * INTO r FROM public.campusops_reports WHERE id=p_report FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report no longer exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=r.college_id AND user_id=auth.uid() AND active AND role='student') OR NOT EXISTS(SELECT 1 FROM public.campusops_members WHERE college_id=r.college_id AND user_id=r.reporter_id AND role='student') THEN RAISE EXCEPTION 'Student membership required'; END IF;
 IF r.reporter_id=auth.uid() THEN RETURN; END IF;
 IF r.status IN ('resolved','closed') THEN RAISE EXCEPTION 'This report is already resolved. Submit a new report if the problem has returned.'; END IF;
 INSERT INTO public.campusops_report_supporters(report_id,user_id) VALUES(r.id,auth.uid()) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added>0 THEN UPDATE public.campusops_reports SET supporter_count=supporter_count+1 WHERE id=r.id; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.campusops_notify_supporters() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='resolved' AND OLD.status IS DISTINCT FROM NEW.status THEN
 INSERT INTO public.campusops_notifications(college_id,user_id,kind,title,body,entity_id,dedupe_key)
 SELECT NEW.college_id,s.user_id,'report_resolved','Shared report resolved','The campus problem you joined has been resolved.',NEW.id,'shared-report-resolved:'||NEW.id::text||':'||s.user_id::text
 FROM public.campusops_report_supporters s WHERE s.report_id=NEW.id ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campusops_notify_supporters ON public.campusops_reports;
CREATE TRIGGER campusops_notify_supporters AFTER UPDATE OF status ON public.campusops_reports FOR EACH ROW EXECUTE FUNCTION public.campusops_notify_supporters();
REVOKE ALL ON FUNCTION public.campusops_shared_reports(uuid),public.campusops_join_report(uuid),public.campusops_notify_supporters() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_shared_reports(uuid),public.campusops_join_report(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
