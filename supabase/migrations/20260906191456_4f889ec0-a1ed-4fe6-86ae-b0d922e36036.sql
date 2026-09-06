ALTER TABLE public.stories
  ADD CONSTRAINT stories_profile_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stories;