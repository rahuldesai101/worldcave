
DROP POLICY IF EXISTS "Authenticated users can delete event images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update event images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view event images" ON storage.objects;
DROP POLICY IF EXISTS "Event images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Event images public read" ON storage.objects;
DROP POLICY IF EXISTS "Event images update (authenticated)" ON storage.objects;
DROP POLICY IF EXISTS "Event images upload (authenticated)" ON storage.objects;

DROP POLICY IF EXISTS "Users can read own event images" ON storage.objects;
CREATE POLICY "Users can read own event images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (has_role(auth.uid(), 'admin'::app_role)
       OR (storage.foldername(name))[1] = (auth.uid())::text)
);

DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can select all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.event_registrations FROM anon;
REVOKE ALL ON public.user_roles FROM anon;
