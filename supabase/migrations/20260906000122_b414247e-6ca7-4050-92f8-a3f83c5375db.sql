CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'voice' CHECK (kind IN ('voice','video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','accepted','declined','ended','missed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view calls" ON public.calls
  FOR SELECT TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id);

CREATE POLICY "Caller can create calls" ON public.calls
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caller_id AND public.is_chat_member(chat_id, auth.uid()));

CREATE POLICY "Participants can update calls" ON public.calls
  FOR UPDATE TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id)
  WITH CHECK (auth.uid() = caller_id OR auth.uid() = callee_id);

CREATE OR REPLACE FUNCTION public.touch_calls_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

REVOKE EXECUTE ON FUNCTION public.touch_calls_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER calls_touch_updated_at
BEFORE UPDATE ON public.calls
FOR EACH ROW EXECUTE FUNCTION public.touch_calls_updated_at();

CREATE INDEX calls_callee_idx ON public.calls (callee_id, created_at DESC);
CREATE INDEX calls_chat_idx ON public.calls (chat_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
ALTER TABLE public.calls REPLICA IDENTITY FULL;