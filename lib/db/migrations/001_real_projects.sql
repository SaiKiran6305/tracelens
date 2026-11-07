BEGIN;
CREATE TABLE IF NOT EXISTS tl_projects (
 id text PRIMARY KEY, public_id text UNIQUE NOT NULL, owner text NOT NULL,
 name text NOT NULL, url text NOT NULL, origins jsonb NOT NULL, workflow_name text NOT NULL,
 steps jsonb NOT NULL, retention_days integer NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 90),
 journey_id text NOT NULL REFERENCES tl_journeys(id), archived_at timestamptz, verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tl_runs ADD COLUMN IF NOT EXISTS project_id text REFERENCES tl_projects(id);
ALTER TABLE tl_runs ADD COLUMN IF NOT EXISTS expected_steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE tl_runs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tl_runs ADD COLUMN IF NOT EXISTS dropped integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS tl_sessions (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES tl_projects(id),
 run_id text REFERENCES tl_runs(id), token_hash text UNIQUE NOT NULL, origin text NOT NULL,
 purpose text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tl_credentials (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES tl_projects(id), token_hash text UNIQUE NOT NULL,
 name text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tl_session_clients (
 id text NOT NULL, session_id text NOT NULL REFERENCES tl_sessions(id), last_seen timestamptz NOT NULL DEFAULT now(),
 closed boolean NOT NULL DEFAULT false, PRIMARY KEY(id,session_id)
);
CREATE TABLE IF NOT EXISTS tl_rate_limits (
 bucket text NOT NULL, window_id bigint NOT NULL, count integer NOT NULL DEFAULT 1, PRIMARY KEY(bucket,window_id)
);
CREATE INDEX IF NOT EXISTS tl_projects_owner_created ON tl_projects(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS tl_runs_project_created ON tl_runs(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tl_runs_owner_created ON tl_runs(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS tl_events_run_sequence ON tl_events(run_id,sequence);
CREATE INDEX IF NOT EXISTS tl_sessions_project ON tl_sessions(project_id,expires_at);
CREATE INDEX IF NOT EXISTS tl_credentials_project ON tl_credentials(project_id);
COMMIT;
