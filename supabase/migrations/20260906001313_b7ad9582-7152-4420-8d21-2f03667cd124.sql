ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_duration integer;

ALTER TABLE public.messages ALTER COLUMN content SET DEFAULT '';

CREATE TABLE public.stories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url text,
  caption text NOT NULL DEFAULT '',
  background text NOT NULL DEFAULT '#075E54',
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stories TO authenticated;
GRANT ALL ON public.stories TO service_role;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stories_select_active" ON public.stories
  FOR SELECT TO authenticated USING (expires_at > now() OR user_id = auth.uid());
CREATE POLICY "stories_insert_own" ON public.stories
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "stories_delete_own" ON public.stories
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.story_views (
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

GRANT SELECT, INSERT ON public.story_views TO authenticated;
GRANT ALL ON public.story_views TO service_role;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "story_views_insert_own" ON public.story_views
  FOR INSERT TO authenticated WITH CHECK (viewer_id = auth.uid());
CREATE POLICY "story_views_select" ON public.story_views
  FOR SELECT TO authenticated USING (
    viewer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.user_id = auth.uid())
  );

CREATE INDEX stories_user_expires_idx ON public.stories (user_id, expires_at DESC);