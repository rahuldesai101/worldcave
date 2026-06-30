
-- profiles: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Revoke anon discoverability on sensitive tables
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.event_registrations FROM anon;
REVOKE ALL ON public.user_roles FROM anon;

-- Revoke authenticated GraphQL discoverability on tables whose policies already gate access
REVOKE SELECT ON public.user_roles FROM authenticated;
REVOKE SELECT ON public.event_registrations FROM authenticated;

-- Re-grant the privileges the app actually needs via policies
GRANT SELECT, INSERT, DELETE ON public.event_registrations TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
