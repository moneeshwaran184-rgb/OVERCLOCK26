-- CampusOps: shared faculty room availability and clear booking validation.
-- Run once in Supabase SQL Editor. Safe to rerun. No accounts or bookings are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.campusops_room_impacts(p_college uuid)
RETURNS TABLE(room_id uuid,starts_at timestamptz,ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=p_college AND m.user_id=auth.uid()
 AND m.active AND m.role IN ('faculty','facilities_admin','department_manager')) THEN RAISE EXCEPTION 'Faculty or facilities access required'; END IF;
 RETURN QUERY SELECT ir.room_id,ir.starts_at,ir.ends_at FROM public.campusops_incident_rooms ir
 JOIN public.campusops_incidents i ON i.college_id=ir.college_id AND i.id=ir.incident_id
 WHERE ir.college_id=p_college AND i.status IN ('open','in_progress');
END $$;

CREATE OR REPLACE FUNCTION public.campusops_room_availability(
 p_college uuid,p_start timestamptz,p_end timestamptz,p_attendees integer DEFAULT 1,
 p_equipment text[] DEFAULT '{}',p_class uuid DEFAULT NULL)
RETURNS TABLE(room_id uuid,room_name text,building_name text,campus_name text,capacity integer,
 equipment text[],room_status text,available boolean,reasons text[],reservations jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cl public.campusops_classes;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campusops_members m WHERE m.college_id=p_college AND m.user_id=auth.uid()
 AND m.active AND m.role IN ('faculty','facilities_admin','department_manager')) THEN RAISE EXCEPTION 'Faculty or facilities access required'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start OR p_end>p_start+interval '7 days'
 THEN RAISE EXCEPTION 'Choose a valid time window of up to seven days'; END IF;
 IF p_class IS NOT NULL THEN
 SELECT * INTO cl FROM public.campusops_classes WHERE id=p_class AND college_id=p_college;
 IF NOT FOUND OR NOT (cl.faculty_id=auth.uid() OR campusops_private.ops(p_college,cl.department_id)) THEN RAISE EXCEPTION 'Class not accessible'; END IF;
 p_attendees=cl.student_count; p_equipment=cl.equipment;
 END IF;
 IF p_attendees IS NULL OR p_attendees<1 THEN RAISE EXCEPTION 'Enter a positive attendee count'; END IF;
 p_equipment=coalesce(p_equipment,'{}');
 RETURN QUERY
 WITH room_data AS (
 SELECT r.id,r.name,b.name AS building,cp.name AS campus,r.capacity AS cap,r.equipment AS equip,r.status,
 EXISTS(SELECT 1 FROM public.campusops_incident_rooms ir JOIN public.campusops_incidents i ON i.id=ir.incident_id AND i.college_id=ir.college_id
 WHERE ir.college_id=p_college AND ir.room_id=r.id AND i.status IN ('open','in_progress')
 AND tstzrange(ir.starts_at,ir.ends_at,'[)') && tstzrange(p_start,p_end,'[)')) AS impacted,
 coalesce((SELECT jsonb_agg(jsonb_build_object('starts_at',k.starts_at,'ends_at',k.ends_at,'kind',k.kind) ORDER BY k.starts_at)
 FROM public.campusops_bookings k WHERE k.college_id=p_college AND k.room_id=r.id AND k.status='confirmed'
 AND tstzrange(k.starts_at,k.ends_at,'[)') && tstzrange(p_start,p_end,'[)')),'[]'::jsonb) AS slots
 FROM public.campusops_rooms r JOIN public.campusops_buildings b ON b.id=r.building_id AND b.college_id=r.college_id
 JOIN public.campusops_campuses cp ON cp.id=b.campus_id AND cp.college_id=b.college_id
 WHERE r.college_id=p_college
 ), explained AS (
 SELECT d.*,array_remove(ARRAY[
 CASE WHEN d.status<>'available' THEN 'Marked unavailable by Facilities' END,
 CASE WHEN d.impacted THEN 'Blocked by an active maintenance incident' END,
 CASE WHEN jsonb_array_length(d.slots)>0 THEN 'Already reserved during this time' END,
 CASE WHEN d.cap<p_attendees THEN format('Capacity %s; your class needs %s seats',d.cap,p_attendees) END,
 CASE WHEN NOT d.equip@>p_equipment THEN 'Missing required equipment: '||array_to_string(ARRAY(SELECT x FROM unnest(p_equipment) x WHERE NOT x=ANY(d.equip)),', ') END
 ],NULL)::text[] AS why FROM room_data d
 )
 SELECT x.id,x.name,x.building,x.campus,x.cap,x.equip,x.status,cardinality(x.why)=0,x.why,x.slots
 FROM explained x ORDER BY x.campus,x.building,x.name;
END $$;

CREATE OR REPLACE FUNCTION campusops_private.make_booking(c uuid,room uuid,title text,starts timestamptz,ends timestamptz,
 attendees integer,equip text[],classid uuid,kind text,requester uuid,workid uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.campusops_rooms; cl public.campusops_classes; result uuid; dept uuid;
BEGIN
 PERFORM campusops_private.lock_college(c);
 SELECT * INTO r FROM public.campusops_rooms WHERE college_id=c AND id=room FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
 IF starts IS NULL OR ends IS NULL OR NOT isfinite(starts) OR NOT isfinite(ends) OR starts<now()-interval '1 minute'
 OR ends<=starts OR ends>starts+interval '7 days' THEN RAISE EXCEPTION 'Choose future booking times, ending after the start and within seven days'; END IF;
 dept=r.department_id;
 IF classid IS NOT NULL THEN
 SELECT * INTO cl FROM public.campusops_classes WHERE college_id=c AND id=classid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
 attendees=cl.student_count; equip=cl.equipment; dept=cl.department_id;
 END IF;
 equip=coalesce(equip,'{}');
 IF attendees IS NULL OR attendees<1 THEN RAISE EXCEPTION 'Enter a positive attendee count'; END IF;
 IF kind<>'maintenance' THEN
 IF r.status<>'available' THEN RAISE EXCEPTION 'Room % is marked unavailable by Facilities',r.name; END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_incident_rooms ir JOIN public.campusops_incidents i ON i.id=ir.incident_id AND i.college_id=ir.college_id
 WHERE ir.college_id=c AND ir.room_id=r.id AND i.status IN ('open','in_progress') AND tstzrange(ir.starts_at,ir.ends_at,'[)') && tstzrange(starts,ends,'[)'))
 THEN RAISE EXCEPTION 'Room % is blocked by an active maintenance incident. Choose another room or ask Facilities to resolve the incident',r.name; END IF;
 IF attendees>r.capacity THEN RAISE EXCEPTION 'Room % has % seats, but this class requires %',r.name,r.capacity,attendees; END IF;
 IF NOT r.equipment@>equip THEN RAISE EXCEPTION 'Room % is missing required class equipment: %',r.name,array_to_string(ARRAY(SELECT x FROM unnest(equip) x WHERE NOT x=ANY(r.equipment)),', '); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.campusops_bookings k WHERE k.college_id=c AND k.room_id=r.id AND k.status='confirmed'
 AND tstzrange(k.starts_at,k.ends_at,'[)') && tstzrange(starts,ends,'[)'))
 THEN RAISE EXCEPTION 'Room % is already reserved during this time. Choose a different time or room',r.name; END IF;
 INSERT INTO public.campusops_bookings(college_id,room_id,department_id,requested_by,class_id,title,kind,starts_at,ends_at,attendee_count,equipment,work_order_id)
 VALUES(c,room,dept,requester,classid,title,kind,starts,ends,attendees,equip,workid) RETURNING id INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.campusops_room_impacts(uuid),
public.campusops_room_availability(uuid,timestamptz,timestamptz,integer,text[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_room_impacts(uuid),
public.campusops_room_availability(uuid,timestamptz,timestamptz,integer,text[],uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'Faculty room availability installed' AS result;
