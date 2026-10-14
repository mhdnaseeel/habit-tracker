CREATE TABLE journal_blueprints (
 id text PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '',
 prompts jsonb NOT NULL CHECK(jsonb_typeof(prompts)='array'),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_journal ADD COLUMN blueprint_id text REFERENCES journal_blueprints(id) ON DELETE SET NULL;
ALTER TABLE daily_journal ADD COLUMN blueprint_snapshot jsonb;
ALTER TABLE daily_journal ADD COLUMN responses jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(responses)='object');
ALTER TABLE daily_journal ADD COLUMN status text NOT NULL DEFAULT 'saved' CHECK(status IN ('draft','saved'));
ALTER TABLE daily_journal DROP CONSTRAINT daily_journal_content_check;
ALTER TABLE daily_journal ADD CONSTRAINT daily_journal_content_length CHECK(length(content)<=20000);
ALTER TABLE daily_journal ADD CONSTRAINT daily_journal_saved_content CHECK(status='draft' OR length(trim(content))>0 OR responses<>'{}'::jsonb);

CREATE INDEX daily_journal_owner_recent ON daily_journal(user_id,entry_date DESC);
ALTER TABLE settings ADD COLUMN ai_journal_consent boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN ai_journal_consent_at timestamptz;
