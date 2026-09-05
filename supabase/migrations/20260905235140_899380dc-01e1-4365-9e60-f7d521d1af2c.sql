CREATE OR REPLACE FUNCTION public.is_chat_creator(_chat_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chats WHERE id = _chat_id AND created_by = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.is_chat_creator(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_creator(uuid, uuid) TO authenticated;

DROP POLICY "chats_select_member" ON public.chats;
CREATE POLICY "chats_select_member" ON public.chats FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_chat_member(id, auth.uid()));

DROP POLICY "chat_members_insert" ON public.chat_members;
CREATE POLICY "chat_members_insert" ON public.chat_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_chat_creator(chat_id, auth.uid())
    OR public.is_chat_member(chat_id, auth.uid())
  );