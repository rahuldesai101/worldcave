CREATE TABLE public.ai_chat_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New research',
  mode TEXT NOT NULL DEFAULT 'summary',
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_chat_threads_user_idx ON public.ai_chat_threads(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_threads TO anon, authenticated;
GRANT ALL ON public.ai_chat_threads TO service_role;
ALTER TABLE public.ai_chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open read for ai chat threads" ON public.ai_chat_threads FOR SELECT USING (true);
CREATE POLICY "Open insert for ai chat threads" ON public.ai_chat_threads FOR INSERT WITH CHECK (user_id IS NOT NULL AND length(user_id) > 0);
CREATE POLICY "Open update for ai chat threads" ON public.ai_chat_threads FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Open delete for ai chat threads" ON public.ai_chat_threads FOR DELETE USING (true);
CREATE TRIGGER ai_chat_threads_updated_at BEFORE UPDATE ON public.ai_chat_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();