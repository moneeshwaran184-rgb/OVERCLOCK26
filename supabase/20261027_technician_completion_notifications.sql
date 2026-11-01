-- CampusOps: technician completion automatically resolves student reports.
-- Run once in Supabase SQL Editor after 20261027_reports_upgrade.sql.
-- Applies to every assigned technician. It only sends report_resolved to student reporters
-- after every work order for the incident is completed or cancelled.
BEGIN;

CREATE OR REPLACE FUNCTION campusops_private.resolve_student_reports_after_last_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  incident public.campusops_incidents;
  resolution text;
BEGIN
  IF OLD.status = 'completed' OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO incident
  FROM public.campusops_incidents
  WHERE id = NEW.incident_id AND college_id = NEW.college_id;

  IF NOT FOUND OR incident.status IN ('resolved','closed') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campusops_reports r
    JOIN public.campusops_members m
      ON m.college_id = r.college_id AND m.user_id = r.reporter_id
    WHERE r.college_id = NEW.college_id
      AND r.incident_id = NEW.incident_id
      AND m.role = 'student'
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.campusops_work_orders w
    WHERE w.college_id = NEW.college_id
      AND w.incident_id = NEW.incident_id
      AND w.status NOT IN ('completed','cancelled')
  ) THEN
    RETURN NEW;
  END IF;

  resolution := coalesce(nullif(trim(NEW.completion_note),''), 'Technician completed the repair.');

  UPDATE public.campusops_incidents
  SET status = 'resolved', summary = resolution
  WHERE id = NEW.incident_id AND college_id = NEW.college_id;

  UPDATE public.campusops_incident_rooms
  SET ends_at = greatest(now(), starts_at + interval '1 microsecond')
  WHERE incident_id = NEW.incident_id AND ends_at IS NULL;

  UPDATE public.campusops_reports
  SET status = 'resolved'
  WHERE college_id = NEW.college_id AND incident_id = NEW.incident_id;

  PERFORM campusops_private.notify(
    NEW.college_id, r.reporter_id, 'incident', 'Incident resolved',
    resolution, NEW.incident_id, 'resolved:' || NEW.incident_id
  )
  FROM public.campusops_reports r
  JOIN public.campusops_members m
    ON m.college_id = r.college_id AND m.user_id = r.reporter_id
  WHERE r.college_id = NEW.college_id
    AND r.incident_id = NEW.incident_id
    AND m.role = 'student';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campusops_resolve_student_report_on_completion
  ON public.campusops_work_orders;

CREATE TRIGGER campusops_resolve_student_report_on_completion
AFTER UPDATE OF status ON public.campusops_work_orders
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION campusops_private.resolve_student_reports_after_last_job();

-- Existing technician emails and passwords are unchanged.

-- Add future technicians after creating their login in Supabase Authentication.
-- Pass the new auth.users UUID, campuses by name, and skill names from campusops_skills.
-- Example: SELECT public.campusops_onboard_technician('00000000-0000-0000-0000-000000000000',
--   'New Technician', ARRAY['Main Campus','Sub Campus'], ARRAY['Electrical','General maintenance'], 3);
CREATE OR REPLACE FUNCTION public.campusops_onboard_technician(
  p_user_id uuid,
  p_full_name text,
  p_campus_names text[],
  p_skill_names text[],
  p_max_open_jobs integer DEFAULT 3
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  c uuid := '10000000-0000-4000-8000-000000000001';
  primary_campus uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Create the login first in Supabase Authentication and provide its user ID.';
  END IF;
  IF length(trim(coalesce(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'Technician name is required.';
  END IF;
  IF coalesce(cardinality(p_campus_names),0) < 1 OR coalesce(cardinality(p_skill_names),0) < 1 THEN
    RAISE EXCEPTION 'Choose at least one campus and one skill.';
  END IF;
  IF p_max_open_jobs IS NULL OR p_max_open_jobs NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Maximum open jobs must be between 1 and 20.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_campus_names) AS requested(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.campusops_campuses cp
      WHERE cp.college_id = c AND lower(cp.name) = lower(trim(requested.name))
    )
  ) THEN
    RAISE EXCEPTION 'One or more campus names were not found for this college.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_skill_names) AS requested(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.campusops_skills sk
      WHERE sk.college_id = c AND lower(sk.name) = lower(trim(requested.name))
    )
  ) THEN
    RAISE EXCEPTION 'One or more skill names were not found. Add the skill in campusops_skills first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.campusops_members m
    WHERE m.college_id = c AND m.user_id = p_user_id AND m.role <> 'technician'
  ) THEN
    RAISE EXCEPTION 'This login already has a non-technician membership. Use a separate technician login or change its role deliberately.';
  END IF;

  SELECT cp.id INTO primary_campus
  FROM unnest(p_campus_names) WITH ORDINALITY AS requested(name, position)
  JOIN public.campusops_campuses cp
    ON cp.college_id = c AND lower(cp.name) = lower(trim(requested.name))
  WHERE requested.position = 1;

  INSERT INTO public.campusops_members(college_id,user_id,full_name,role,department_id,active)
  VALUES(c,p_user_id,trim(p_full_name),'technician',NULL,true)
  ON CONFLICT(college_id,user_id) DO UPDATE
    SET full_name = excluded.full_name, role = 'technician', active = true;

  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name',trim(p_full_name)),
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.campusops_staff(college_id,user_id,campus_id,available,max_open_jobs)
  VALUES(c,p_user_id,primary_campus,true,p_max_open_jobs)
  ON CONFLICT(college_id,user_id) DO UPDATE
    SET campus_id = excluded.campus_id, available = true,
        max_open_jobs = excluded.max_open_jobs, updated_at = now();

  DELETE FROM public.campusops_staff_campuses
  WHERE college_id = c AND user_id = p_user_id;
  INSERT INTO public.campusops_staff_campuses(college_id,user_id,campus_id)
  SELECT c,p_user_id,cp.id
  FROM unnest(p_campus_names) AS requested(name)
  JOIN public.campusops_campuses cp
    ON cp.college_id = c AND lower(cp.name) = lower(trim(requested.name))
  ON CONFLICT DO NOTHING;

  DELETE FROM public.campusops_staff_skills
  WHERE college_id = c AND user_id = p_user_id;
  INSERT INTO public.campusops_staff_skills(college_id,user_id,skill_id,level)
  SELECT c,p_user_id,sk.id,3
  FROM unnest(p_skill_names) AS requested(name)
  JOIN public.campusops_skills sk
    ON sk.college_id = c AND lower(sk.name) = lower(trim(requested.name))
  ON CONFLICT(college_id,user_id,skill_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.campusops_shifts sh
    WHERE sh.college_id = c AND sh.user_id = p_user_id AND sh.reason = 'Initial technician coverage; configure real shift'
  ) THEN
    INSERT INTO public.campusops_shifts(college_id,user_id,starts_at,ends_at,reason)
    VALUES(c,p_user_id,now() - interval '1 hour',now() + interval '30 days','Initial technician coverage; configure real shift');
  END IF;

  RETURN p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.campusops_onboard_technician(uuid,text,text[],text[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_onboard_technician(uuid,text,text[],text[],integer) TO service_role;
COMMIT;
