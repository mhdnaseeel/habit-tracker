CREATE TABLE daily_journal (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entry_date date NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 20000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,entry_date)
);
