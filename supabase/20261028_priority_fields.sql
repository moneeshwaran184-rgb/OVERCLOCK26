BEGIN;
INSERT INTO public.campusops_priority_rules(id,priority,pattern,reason,examples)
VALUES('waterlogging',2,'(^|[^a-z])(water[ -]?logging|water[ -]?logged|standing water|blocked drain|overflowing toilet)([^a-z]|$)','Accumulated water or blocked drainage needs prompt attention.','["There is water logging","Drain is blocked with standing water"]'::jsonb)
ON CONFLICT(id) DO UPDATE SET priority=excluded.priority,pattern=excluded.pattern,reason=excluded.reason,examples=excluded.examples;
CREATE OR REPLACE FUNCTION public.campusops_submit_report_v2(p_college uuid,p_campus uuid,p_department uuid,p_description text,p_room uuid DEFAULT NULL,p_category text DEFAULT 'general',p_equipment text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; combined text; BEGIN
 IF length(coalesce(p_equipment,''))>200 THEN RAISE EXCEPTION 'Equipment description must be at most 200 characters'; END IF;
 IF length(coalesce(p_description,'')) NOT BETWEEN 10 AND 10000 THEN RAISE EXCEPTION 'Description must contain 10 to 10000 characters'; END IF;
 combined=coalesce(p_equipment,'')||E'\n'||p_description;
 result=public.campusops_submit_report(p_college,p_campus,p_department,left(combined,10000),p_room,NULL,p_category,NULL);
 UPDATE public.campusops_reports SET description=p_description,equipment_description=nullif(trim(p_equipment),'') WHERE id=(result->>'report_id')::uuid;
 RETURN result||jsonb_build_object('priority',public.campusops_classify_priority(combined));
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
