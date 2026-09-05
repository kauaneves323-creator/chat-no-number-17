ALTER TABLE public.chat_members
  ADD CONSTRAINT chat_members_profile_fk FOREIGN KEY (user_id)
  REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_profile_fk FOREIGN KEY (sender_id)
  REFERENCES public.profiles(id) ON DELETE CASCADE;