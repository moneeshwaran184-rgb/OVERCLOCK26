BEGIN;

CREATE OR REPLACE FUNCTION public.campusops_admin_delete_report(p_report uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE r public.campusops_reports;
BEGIN
  SELECT * INTO r FROM public.campusops_reports WHERE id=p_report FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT campusops_private.has_role(r.college_id,ARRAY['report_admin']) THEN
    RAISE EXCEPTION 'Report administrator access required';
  END IF;

  UPDATE public.campusops_reports SET duplicate_of=NULL
    WHERE duplicate_of=r.id AND college_id=r.college_id;
  DELETE FROM public.campusops_report_messages WHERE report_id=r.id AND college_id=r.college_id;
  DELETE FROM public.campusops_attachments WHERE report_id=r.id AND college_id=r.college_id;
  DELETE FROM public.campusops_reports WHERE id=r.id;
END $$;

REVOKE ALL ON FUNCTION public.campusops_admin_delete_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_admin_delete_report(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
