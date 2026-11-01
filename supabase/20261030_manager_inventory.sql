BEGIN;
CREATE OR REPLACE FUNCTION public.campusops_adjust_stock(p_stock uuid,p_delta numeric,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.campusops_stock;
BEGIN
 SELECT * INTO s FROM public.campusops_stock WHERE id=p_stock;
 IF NOT FOUND OR NOT campusops_private.has_role(s.college_id,ARRAY['facilities_admin','department_manager']) THEN RAISE EXCEPTION 'Inventory manager required'; END IF;
 IF p_delta IS NULL OR p_delta=0 OR p_delta::text IN ('NaN','Infinity','-Infinity') OR length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Valid quantity and reason required'; END IF;
 PERFORM campusops_private.lock_college(s.college_id);
 SELECT * INTO s FROM public.campusops_stock WHERE id=p_stock FOR UPDATE;
 IF s.on_hand+p_delta<0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
 UPDATE public.campusops_stock SET on_hand=on_hand+p_delta WHERE id=s.id;
 INSERT INTO public.campusops_stock_movements(college_id,stock_id,actor_id,kind,quantity,note) VALUES(s.college_id,s.id,auth.uid(),'adjustment',p_delta,p_reason);
END $$;
REVOKE ALL ON FUNCTION public.campusops_adjust_stock(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.campusops_adjust_stock(uuid,numeric,text) TO authenticated;
CREATE POLICY manager_stock_read ON public.campusops_stock FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['department_manager']));
CREATE POLICY manager_items_read ON public.campusops_inventory_items FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['department_manager']));
CREATE POLICY manager_locations_read ON public.campusops_stock_locations FOR SELECT TO authenticated USING(campusops_private.has_role(college_id,ARRAY['department_manager']));
NOTIFY pgrst,'reload schema';
COMMIT;
