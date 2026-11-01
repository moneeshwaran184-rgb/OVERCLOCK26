BEGIN;
CREATE OR REPLACE FUNCTION public.campusops_delete_own_report(p_report uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_reports;
BEGIN
 SELECT * INTO r FROM public.campusops_reports WHERE id=p_report FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF r.reporter_id IS DISTINCT FROM auth.uid() OR NOT EXISTS (
 SELECT 1 FROM public.campusops_members m WHERE m.college_id=r.college_id AND m.user_id=auth.uid() AND m.active AND m.role='student'
 ) THEN RAISE EXCEPTION 'You can only delete your own student reports'; END IF;
 UPDATE public.campusops_reports SET duplicate_of=NULL WHERE duplicate_of=r.id AND college_id=r.college_id;
 DELETE FROM public.campusops_report_messages WHERE report_id=r.id AND college_id=r.college_id;
 DELETE FROM public.campusops_attachments WHERE report_id=r.id AND college_id=r.college_id;
 DELETE FROM public.campusops_reports WHERE id=r.id;
 -- Existing incidents, work orders and audit history remain with staff.
 -- Storage objects are retained; this function removes attachment records only.
END $$;
REVOKE ALL ON FUNCTION public.campusops_delete_own_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_delete_own_report(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
