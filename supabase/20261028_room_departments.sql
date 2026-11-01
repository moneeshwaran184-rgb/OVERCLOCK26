BEGIN;
-- Reassign only the known fictional rooms in the demo college.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.campusops_departments WHERE college_id='10000000-0000-4000-8000-000000000001' AND name IN ('CSE','IT','ECE'))<>3 THEN RAISE EXCEPTION 'CSE, IT and ECE departments must exist first'; END IF;
END $$;
WITH mapping(room_name,department_name) AS (VALUES
 ('A-101','CSE'),('A-102','CSE'),('L-201','IT'),('L-202','ECE'),
 ('T-101','CSE'),('T-102','IT'),('T-201','IT'),
 ('E-101','ECE'),('E-102','ECE'),('E-201','ECE'))
UPDATE public.campusops_rooms r SET department_id=d.id
FROM mapping m,public.campusops_departments d
WHERE r.college_id='10000000-0000-4000-8000-000000000001' AND d.college_id=r.college_id
AND r.name=m.room_name AND d.name=m.department_name;
-- Existing reports and work retain their original department for historical ownership.
SELECT c.name AS campus,b.name AS building,r.name AS room,d.name AS department
FROM public.campusops_rooms r JOIN public.campusops_buildings b ON b.id=r.building_id
JOIN public.campusops_campuses c ON c.id=b.campus_id JOIN public.campusops_departments d ON d.id=r.department_id
WHERE r.college_id='10000000-0000-4000-8000-000000000001' ORDER BY c.name,d.name,r.name;
COMMIT;
