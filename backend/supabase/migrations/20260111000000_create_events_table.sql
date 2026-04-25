-- Create au_events table for the event-driven sync layer
CREATE TABLE IF NOT EXISTS au_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Realtime for au_events
ALTER PUBLICATION supabase_realtime ADD TABLE au_events;

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_au_events_user_id ON au_events(user_id);
CREATE INDEX IF NOT EXISTS idx_au_events_event_type ON au_events(event_type);
CREATE INDEX IF NOT EXISTS idx_au_events_timestamp ON au_events(timestamp DESC);

-- RLS (Disabled per user request for AU tables, but adding policy for completeness)
ALTER TABLE au_events DISABLE ROW LEVEL SECURITY;
