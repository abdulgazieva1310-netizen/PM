CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  text TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sentiment TEXT CHECK (sentiment IN ('Positive', 'Negative', 'Neutral')),
  language TEXT CHECK (language IN ('Kazakh', 'Russian', 'English', 'Other', 'Unknown')),
  intensity INTEGER CHECK (intensity BETWEEN 1 AND 10),
  analysis_error TEXT,
  ai_detected_topic TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS feedback_submitted_at_idx ON feedback (submitted_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS topics_name_lower_unique ON topics (LOWER(name));

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  expires BIGINT NOT NULL
);
