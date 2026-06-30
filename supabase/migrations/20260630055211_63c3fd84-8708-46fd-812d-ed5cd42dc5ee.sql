
-- 1) ai_chat_threads UPDATE: add user_id validity guard
DROP POLICY IF EXISTS "Owners can update their ai chat threads" ON public.ai_chat_threads;
CREATE POLICY "Owners can update their ai chat threads"
ON public.ai_chat_threads
FOR UPDATE
TO authenticated
USING (
  (user_id IS NOT NULL) AND (length(user_id) > 0)
  AND (((auth.jwt() ->> 'sub') = user_id) OR ((auth.uid())::text = user_id))
)
WITH CHECK (
  (user_id IS NOT NULL) AND (length(user_id) > 0)
  AND (((auth.jwt() ->> 'sub') = user_id) OR ((auth.uid())::text = user_id))
);

-- 2) event_registrations: restrict policies to authenticated role
DROP POLICY IF EXISTS "Users can create their own registrations" ON public.event_registrations;
CREATE POLICY "Users can create their own registrations"
ON public.event_registrations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own registrations" ON public.event_registrations;
CREATE POLICY "Users can delete their own registrations"
ON public.event_registrations
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own registrations" ON public.event_registrations;
CREATE POLICY "Users can view their own registrations"
ON public.event_registrations
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 3) user_roles: prevent self-elevation - admins cannot assign roles to themselves
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  AND auth.uid() <> user_id
);

DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  AND auth.uid() <> user_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  AND auth.uid() <> user_id
);

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  AND auth.uid() <> user_id
);
