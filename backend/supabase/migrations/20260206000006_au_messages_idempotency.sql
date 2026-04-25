ALTER TABLE public.au_messages
ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS au_messages_session_client_message_id_uq
ON public.au_messages (session_id, client_message_id);

NOTIFY pgrst, 'reload schema';
