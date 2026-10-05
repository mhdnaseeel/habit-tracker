CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL,
 password_hash text NOT NULL, name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 timezone varchar(100) NOT NULL, role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email));
CREATE TABLE settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 week_start integer NOT NULL DEFAULT 0 CHECK(week_start BETWEEN 0 AND 6), locale varchar(20) NOT NULL DEFAULT 'en-IN',
 theme text NOT NULL DEFAULT 'dark' CHECK(theme IN ('dark','light','high-contrast')),
 dnd_start time, dnd_end time, notify_push boolean NOT NULL DEFAULT false, notify_email boolean NOT NULL DEFAULT false, notify_sms boolean NOT NULL DEFAULT false,
 analytics_consent boolean NOT NULL DEFAULT false, consent_updated_at timestamptz,
 onboarding_completed_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((dnd_start IS NULL)=(dnd_end IS NULL))
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 refresh_hash text NOT NULL UNIQUE, family_id uuid NOT NULL, device_id varchar(255), ip_address inet, user_agent text,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by uuid REFERENCES sessions(id),
 CHECK(expires_at>created_at)
);
CREATE INDEX sessions_owner ON sessions(user_id);
CREATE INDEX sessions_family ON sessions(family_id);
CREATE TABLE password_resets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_owner ON password_resets(user_id);
CREATE TABLE habits (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0), description text, category varchar(50), icon varchar(50), color varchar(7) CHECK(color ~ '^#[0-9a-fA-F]{6}$'),
 active boolean NOT NULL DEFAULT true, start_date date NOT NULL, end_date date, archived_on date, sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(id,user_id), CHECK(end_date IS NULL OR end_date>=start_date), CHECK((active AND archived_on IS NULL) OR (NOT active AND archived_on IS NOT NULL))
);
CREATE UNIQUE INDEX habits_active_name ON habits(user_id,lower(name)) WHERE active=true;
CREATE INDEX habits_owner_active ON habits(user_id,active,sort_order);
CREATE TABLE habit_schedules (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, habit_id integer NOT NULL, user_id uuid NOT NULL,
 effective_from date NOT NULL, frequency text NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
 weekdays integer[] NOT NULL DEFAULT '{}', month_days integer[] NOT NULL DEFAULT '{}', target integer NOT NULL DEFAULT 1 CHECK(target BETWEEN 1 AND 1000000), unit varchar(50), reminder_time time,
 UNIQUE(habit_id,effective_from), UNIQUE(id,habit_id,user_id), FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id) ON DELETE CASCADE,
 CHECK((frequency='daily' AND cardinality(weekdays)=0 AND cardinality(month_days)=0) OR
 (frequency='weekly' AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6] AND cardinality(month_days)=0) OR
 (frequency='monthly' AND cardinality(month_days) BETWEEN 1 AND 31 AND month_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31] AND cardinality(weekdays)=0))
);
CREATE INDEX habit_schedules_owner ON habit_schedules(user_id);
CREATE TABLE habit_instances (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, habit_id integer NOT NULL, user_id uuid NOT NULL, schedule_id integer NOT NULL,
 date date NOT NULL, timezone varchar(100) NOT NULL, status text NOT NULL CHECK(status IN ('pending','partial','completed','frozen','missed')),
 value integer NOT NULL DEFAULT 0 CHECK(value>=0), target integer NOT NULL CHECK(target>0), notes text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(habit_id,date), FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(schedule_id,habit_id,user_id) REFERENCES habit_schedules(id,habit_id,user_id),
 CHECK((status='completed' AND value>=target) OR (status='partial' AND value>0 AND value<target) OR (status IN ('pending','frozen','missed') AND value=0))
);
CREATE INDEX habit_instances_owner_date ON habit_instances(user_id,date);
CREATE TABLE freeze_usage (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, habit_id integer NOT NULL, user_id uuid NOT NULL,
 month date NOT NULL CHECK(extract(day FROM month)=1), occurrence_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(habit_id,month), UNIQUE(habit_id,occurrence_date),
 FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id) ON DELETE CASCADE,
 CHECK(date_trunc('month',occurrence_date)::date=month)
);
CREATE INDEX freeze_owner ON freeze_usage(user_id);
CREATE TABLE streaks (
 habit_id integer PRIMARY KEY REFERENCES habits(id) ON DELETE CASCADE, current_streak integer NOT NULL DEFAULT 0 CHECK(current_streak>=0),
 best_streak integer NOT NULL DEFAULT 0 CHECK(best_streak>=0), historical_best integer NOT NULL DEFAULT 0 CHECK(historical_best>=0),
 calculated_through date, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE goals (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title varchar(100) NOT NULL CHECK(length(trim(title))>0), description text, category varchar(50), target integer CHECK(target>0), unit varchar(50),
 start_date date NOT NULL, deadline date, completed_at timestamptz, archived_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id), CHECK(deadline IS NULL OR deadline>=start_date)
);
CREATE INDEX goals_owner ON goals(user_id);
CREATE TABLE goal_habits (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, goal_id integer NOT NULL, habit_id integer NOT NULL, user_id uuid NOT NULL,
 linked_on date NOT NULL, unlinked_on date,
 FOREIGN KEY(goal_id,user_id) REFERENCES goals(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id) ON DELETE CASCADE, CHECK(unlinked_on IS NULL OR unlinked_on>=linked_on)
);
CREATE UNIQUE INDEX goal_habits_active ON goal_habits(goal_id,habit_id) WHERE unlinked_on IS NULL;
CREATE INDEX goal_habits_owner ON goal_habits(user_id);
CREATE INDEX goal_habits_habit ON goal_habits(habit_id);
CREATE TABLE goal_milestones (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, goal_id integer NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
 percentage integer NOT NULL CHECK(percentage BETWEEN 1 AND 100), title varchar(100) NOT NULL, reached_at timestamptz, UNIQUE(goal_id,percentage)
);
CREATE TABLE tasks (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title varchar(100) NOT NULL CHECK(length(trim(title))>0), description text, due_date date,
 priority integer NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5), recurrence text NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly')),
 carry_over boolean NOT NULL DEFAULT false, reminder_time time, archived_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id), CHECK(recurrence='none' OR due_date IS NOT NULL)
);
CREATE INDEX tasks_owner_due ON tasks(user_id,due_date);
CREATE TABLE task_instances (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id integer NOT NULL, user_id uuid NOT NULL,
 original_date date NOT NULL, display_date date NOT NULL, completed_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,user_id) REFERENCES tasks(id,user_id) ON DELETE CASCADE, UNIQUE(task_id,original_date), CHECK(display_date>=original_date)
);
CREATE INDEX task_instances_owner_date ON task_instances(user_id,display_date);
CREATE TABLE reflections (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 habit_id integer, task_id integer, date date NOT NULL, content text NOT NULL CHECK(length(content) BETWEEN 1 AND 20000), mood varchar(50),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(habit_id,user_id) REFERENCES habits(id,user_id), FOREIGN KEY(task_id,user_id) REFERENCES tasks(id,user_id)
);
CREATE INDEX reflections_owner_date ON reflections(user_id,date);
CREATE INDEX reflections_habit ON reflections(habit_id);
CREATE INDEX reflections_task ON reflections(task_id);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK(channel IN ('email','push','sms')), dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
 scheduled_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','skipped','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), leased_until timestamptz, lease_token uuid, last_error_code varchar(100), provider_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_due ON notifications(next_attempt_at) WHERE status IN ('pending','processing');
CREATE INDEX notifications_owner ON notifications(user_id);
CREATE TABLE notification_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK(channel IN ('push','sms')), address text NOT NULL, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,channel,address)
);
CREATE TABLE audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 entity varchar(50) NOT NULL, entity_id varchar(100), action varchar(50) NOT NULL, request_id uuid,
 changes jsonb, timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_owner_time ON audit_logs(user_id,timestamp);
CREATE TABLE mutation_receipts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, mutation_id uuid NOT NULL,
 request_hash text NOT NULL, response_status integer NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,mutation_id)
);
CREATE TABLE sync_changes (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entity varchar(50) NOT NULL, entity_id varchar(100) NOT NULL, version integer NOT NULL, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_owner_sequence ON sync_changes(user_id,sequence);
CREATE TABLE feature_flags (
 flag varchar(50) PRIMARY KEY, description text, enabled boolean NOT NULL DEFAULT false, rollout_pct integer NOT NULL DEFAULT 0 CHECK(rollout_pct BETWEEN 0 AND 100)
);
