
-- 1) ai_chat_threads: replace open policies with owner-scoped policies based on Clerk JWT 'sub'
DROP POLICY IF EXISTS "Open delete for ai chat threads" ON public.ai_chat_threads;
DROP POLICY IF EXISTS "Open insert for ai chat threads" ON public.ai_chat_threads;
DROP POLICY IF EXISTS "Open read for ai chat threads" ON public.ai_chat_threads;
DROP POLICY IF EXISTS "Open update for ai chat threads" ON public.ai_chat_threads;

REVOKE ALL ON public.ai_chat_threads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_threads TO authenticated;
GRANT ALL ON public.ai_chat_threads TO service_role;

CREATE POLICY "Owners can read their ai chat threads"
  ON public.ai_chat_threads FOR SELECT TO authenticated
  USING (
    user_id IS NOT NULL
    AND length(user_id) > 0
    AND (
      (auth.jwt() ->> 'sub') = user_id
      OR auth.uid()::text = user_id
    )
  );

CREATE POLICY "Owners can insert their ai chat threads"
  ON public.ai_chat_threads FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NOT NULL
    AND length(user_id) > 0
    AND (
      (auth.jwt() ->> 'sub') = user_id
      OR auth.uid()::text = user_id
    )
  );

CREATE POLICY "Owners can update their ai chat threads"
  ON public.ai_chat_threads FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'sub') = user_id
    OR auth.uid()::text = user_id
  )
  WITH CHECK (
    (auth.jwt() ->> 'sub') = user_id
    OR auth.uid()::text = user_id
  );

CREATE POLICY "Owners can delete their ai chat threads"
  ON public.ai_chat_threads FOR DELETE TO authenticated
  USING (
    (auth.jwt() ->> 'sub') = user_id
    OR auth.uid()::text = user_id
  );

-- 2) Event images: allow public read access on the 'event-images' bucket
DROP POLICY IF EXISTS "Public can view event images" ON storage.objects;
CREATE POLICY "Public can view event images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'event-images');

-- 3) SECURITY DEFINER functions: revoke direct EXECUTE from anon/authenticated/public.
-- has_role is invoked from within RLS policies; SECURITY DEFINER + ownership grants run those internally.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
