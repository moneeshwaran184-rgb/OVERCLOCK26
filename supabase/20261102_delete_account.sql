BEGIN;

-- campusops_purge_account_data removes every campus row that is personally
-- owned by (or hard-referenced by) the target user, so the auth.users row can
-- then be deleted by the Edge Function. It deliberately keeps incidents,
-- work orders (reassigned to the acting admin) and audit history, consistent
-- with the report-deletion RPCs.
-- SECURITY DEFINER + service_role only: never callable from the browser.
CREATE OR REPLACE FUNCTION public.campusops_purge_account_data(p_user uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_college uuid;
  v_attach_paths text[] := '{}';
BEGIN
  SELECT college_id INTO v_college
  FROM public.campusops_members
  WHERE user_id = p_user
  LIMIT 1;

  -- Collect storage object keys for every attachment on the target's reports
  -- (the Edge Function deletes the binaries; this function only removes rows).
  SELECT COALESCE(array_agg(a.object_name), '{}') INTO v_attach_paths
  FROM public.campusops_attachments a
  JOIN public.campusops_reports r ON r.id = a.report_id
  WHERE r.reporter_id = p_user;

  -- ── Reports owned by the target ───────────────────────────────────────
  UPDATE public.campusops_reports SET duplicate_of = NULL
    WHERE duplicate_of IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_report_supporters
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_report_messages
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_attachments
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_confirmed_duplicates
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user)
       OR canonical_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_duplicate_events
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user)
       OR canonical_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_ai_pair_reviews
    WHERE source_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user)
       OR target_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  UPDATE public.campusops_ai_assessments SET report_id = NULL
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  UPDATE public.campusops_email_intake SET report_id = NULL
    WHERE report_id IN (SELECT id FROM public.campusops_reports WHERE reporter_id = p_user);
  DELETE FROM public.campusops_reports WHERE reporter_id = p_user;

  -- ── Personal data ────────────────────────────────────────────────────
  DELETE FROM public.campusops_grievance_history
    WHERE grievance_id IN (SELECT id FROM public.campusops_grievances WHERE student_id = p_user);
  DELETE FROM public.campusops_grievances WHERE student_id = p_user;
  DELETE FROM public.campusops_chat_usage WHERE user_id = p_user;
  DELETE FROM public.campusops_notifications WHERE user_id = p_user;
  DELETE FROM public.campusops_report_supporters WHERE user_id = p_user;

  -- ── Enrollments & classes taught ─────────────────────────────────────
  DELETE FROM public.campusops_enrollments WHERE student_id = p_user;
  DELETE FROM public.campusops_enrollments
    WHERE class_id IN (SELECT id FROM public.campusops_classes WHERE faculty_id = p_user);
  UPDATE public.campusops_bookings SET class_id = NULL
    WHERE class_id IN (SELECT id FROM public.campusops_classes WHERE faculty_id = p_user);
  DELETE FROM public.campusops_classes WHERE faculty_id = p_user;

  -- ── Reassign college-scoped NOT NULL references to the acting admin ──
  -- Only where an active system_admin replacement exists in that college;
  -- otherwise the dependent row is removed so history never blocks deletion.
  UPDATE public.campusops_bookings b
    SET requested_by = p_actor
    WHERE b.requested_by = p_user
      AND EXISTS (SELECT 1 FROM public.campusops_members m
                  WHERE m.college_id = b.college_id AND m.user_id = p_actor AND m.active);
  DELETE FROM public.campusops_bookings WHERE requested_by = p_user;

  UPDATE public.campusops_approvals a
    SET requested_by = p_actor
    WHERE a.requested_by = p_user
      AND EXISTS (SELECT 1 FROM public.campusops_members m
                  WHERE m.college_id = a.college_id AND m.user_id = p_actor AND m.active);
  DELETE FROM public.campusops_approval_decisions
    WHERE approval_id IN (
      SELECT id FROM public.campusops_approvals
      WHERE requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = college_id AND m.user_id = p_actor AND m.active)
    );
  DELETE FROM public.campusops_approvals WHERE requested_by = p_user;

  UPDATE public.campusops_approval_decisions d
    SET decided_by = p_actor
    WHERE d.decided_by = p_user
      AND EXISTS (SELECT 1 FROM public.campusops_members m
                  WHERE m.college_id = d.college_id AND m.user_id = p_actor AND m.active);
  DELETE FROM public.campusops_approval_decisions WHERE decided_by = p_user;

  -- Clean dependents of work orders that cannot be reassigned (no admin in college)
  -- so the DELETE below never trips a foreign-key constraint.
  DELETE FROM public.campusops_work_parts
    WHERE work_order_id IN (
      SELECT w.id FROM public.campusops_work_orders w
      WHERE w.requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active)
    );
  DELETE FROM public.campusops_work_skills
    WHERE work_order_id IN (
      SELECT w.id FROM public.campusops_work_orders w
      WHERE w.requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active)
    );
  DELETE FROM public.campusops_maintenance_history
    WHERE work_order_id IN (
      SELECT w.id FROM public.campusops_work_orders w
      WHERE w.requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active)
    );
  UPDATE public.campusops_approvals SET work_order_id = NULL
    WHERE work_order_id IN (
      SELECT w.id FROM public.campusops_work_orders w
      WHERE w.requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active)
    );
  UPDATE public.campusops_bookings SET work_order_id = NULL
    WHERE work_order_id IN (
      SELECT w.id FROM public.campusops_work_orders w
      WHERE w.requested_by = p_user
        AND NOT EXISTS (SELECT 1 FROM public.campusops_members m
                        WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active)
    );

  UPDATE public.campusops_work_orders w
    SET requested_by = p_actor
    WHERE w.requested_by = p_user
      AND EXISTS (SELECT 1 FROM public.campusops_members m
                  WHERE m.college_id = w.college_id AND m.user_id = p_actor AND m.active);
  DELETE FROM public.campusops_work_orders WHERE requested_by = p_user;
  UPDATE public.campusops_work_orders SET assigned_to = NULL WHERE assigned_to = p_user;

  -- ── Technician history ───────────────────────────────────────────────
  DELETE FROM public.campusops_maintenance_history WHERE technician_id = p_user;

  -- ── Nullable audit references ────────────────────────────────────────
  UPDATE public.campusops_stock_movements SET actor_id = NULL WHERE actor_id = p_user;
  UPDATE public.campusops_audit_log SET actor_id = NULL WHERE actor_id = p_user;
  UPDATE public.campusops_email_intake SET reviewed_by = NULL WHERE reviewed_by = p_user;

  -- ── Staff rows ───────────────────────────────────────────────────────
  DELETE FROM public.campusops_staff_skills WHERE user_id = p_user;
  DELETE FROM public.campusops_shifts WHERE user_id = p_user;
  DELETE FROM public.campusops_time_off WHERE user_id = p_user;
  DELETE FROM public.campusops_staff_campuses WHERE user_id = p_user;
  DELETE FROM public.campusops_staff WHERE user_id = p_user;

  -- ── Membership row ───────────────────────────────────────────────────
  DELETE FROM public.campusops_members WHERE user_id = p_user;

  RETURN jsonb_build_object(
    'user_id', p_user,
    'college_id', v_college,
    'attachment_paths', to_jsonb(v_attach_paths)
  );
END $$;

REVOKE ALL ON FUNCTION public.campusops_purge_account_data(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campusops_purge_account_data(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
