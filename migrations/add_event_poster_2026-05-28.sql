-- Add poster_url column to events table so each event can have an uploaded poster image
ALTER TABLE events ADD COLUMN IF NOT EXISTS poster_url TEXT;
