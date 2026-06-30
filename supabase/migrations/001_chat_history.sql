-- ResearchGPT chat history migration
-- Run this in the Supabase SQL Editor.

-- Chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, position)
);

-- Indexes
CREATE INDEX IF NOT EXISTS chats_user_id_updated_at_idx
  ON public.chats (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS messages_chat_id_position_idx
  ON public.messages (chat_id, position ASC);

CREATE INDEX IF NOT EXISTS messages_user_id_idx
  ON public.messages (user_id);

-- Keep chats.updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chats_set_updated_at ON public.chats;

CREATE TRIGGER chats_set_updated_at
BEFORE UPDATE ON public.chats
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Bump chat updated_at when messages change
CREATE OR REPLACE FUNCTION public.touch_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.chats
  SET updated_at = now()
  WHERE id = COALESCE(NEW.chat_id, OLD.chat_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS messages_touch_chat_updated_at ON public.messages;

CREATE TRIGGER messages_touch_chat_updated_at
AFTER INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_chat_updated_at();

-- Row Level Security
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Chats policies
DROP POLICY IF EXISTS "Users select own chats" ON public.chats;
CREATE POLICY "Users select own chats"
  ON public.chats
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own chats" ON public.chats;
CREATE POLICY "Users insert own chats"
  ON public.chats
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own chats" ON public.chats;
CREATE POLICY "Users update own chats"
  ON public.chats
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own chats" ON public.chats;
CREATE POLICY "Users delete own chats"
  ON public.chats
  FOR DELETE
  USING (auth.uid() = user_id);

-- Messages policies
DROP POLICY IF EXISTS "Users select own messages" ON public.messages;
CREATE POLICY "Users select own messages"
  ON public.messages
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own messages" ON public.messages;
CREATE POLICY "Users insert own messages"
  ON public.messages
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own messages" ON public.messages;
CREATE POLICY "Users update own messages"
  ON public.messages
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own messages" ON public.messages;
CREATE POLICY "Users delete own messages"
  ON public.messages
  FOR DELETE
  USING (auth.uid() = user_id);
