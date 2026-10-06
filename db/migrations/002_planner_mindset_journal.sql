CREATE TABLE goal_steps (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 goal_id integer NOT NULL,
 user_id uuid NOT NULL,
 title varchar(100) NOT NULL CHECK(length(trim(title))>0),
 completed_at timestamptz,
 sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(goal_id,user_id) REFERENCES goals(id,user_id) ON DELETE CASCADE,
 UNIQUE(id,user_id)
);
CREATE INDEX goal_steps_owner_goal ON goal_steps(user_id,goal_id,sort_order,id);

CREATE TABLE daily_mindset (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 date date NOT NULL,
 energy integer NOT NULL CHECK(energy BETWEEN 1 AND 5),
 focus integer NOT NULL CHECK(focus BETWEEN 1 AND 5),
 motivation integer NOT NULL CHECK(motivation BETWEEN 1 AND 5),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,date)
);

CREATE TABLE monthly_journal (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 month date NOT NULL CHECK(extract(day FROM month)=1),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 20000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,month)
);

CREATE TABLE task_copies (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_task_id integer NOT NULL,
 copied_task_id integer NOT NULL,
 source_date date NOT NULL,
 target_date date NOT NULL,
 PRIMARY KEY(user_id,source_task_id,target_date),
 FOREIGN KEY(source_task_id,user_id) REFERENCES tasks(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(copied_task_id,user_id) REFERENCES tasks(id,user_id) ON DELETE CASCADE,
 CHECK(target_date=source_date+1)
);

CREATE TABLE weekly_freeze_usage (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 habit_id integer NOT NULL,
 user_id uuid NOT NULL,
 week_start date NOT NULL CHECK(extract(isodow FROM week_start)=1),
 occurrence_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(habit_id,week_start),
 UNIQUE(habit_id,occurrence_date),
 FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id) ON DELETE CASCADE,
 CHECK(occurrence_date BETWEEN week_start AND week_start+6)
);
CREATE INDEX weekly_freeze_owner ON weekly_freeze_usage(user_id,week_start);

INSERT INTO weekly_freeze_usage(habit_id,user_id,week_start,occurrence_date,created_at)
SELECT DISTINCT ON (habit_id,date_trunc('week',occurrence_date)::date)
 habit_id,user_id,date_trunc('week',occurrence_date)::date,occurrence_date,created_at
FROM freeze_usage
ORDER BY habit_id,date_trunc('week',occurrence_date)::date,created_at,id;
