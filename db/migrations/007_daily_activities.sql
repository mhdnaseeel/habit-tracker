CREATE TABLE daily_activities (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title varchar(100) NOT NULL CHECK(length(trim(title))>0),
 description text,
 activity_type text NOT NULL CHECK(activity_type IN ('task','habit','goal_action','appointment','personal')),
 scheduled_date date NOT NULL,
 start_time time,
 end_time time,
 timezone varchar(100) NOT NULL,
 priority integer NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
 reminder_time time,
 notes text,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','skipped','cancelled')),
 linked_task_id integer,
 linked_habit_id integer,
 linked_goal_id integer,
 completed_at timestamptz,
 cancelled_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id),
 FOREIGN KEY(linked_task_id,user_id) REFERENCES tasks(id,user_id),
 FOREIGN KEY(linked_habit_id,user_id) REFERENCES habits(id,user_id),
 FOREIGN KEY(linked_goal_id,user_id) REFERENCES goals(id,user_id),
 CHECK((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time>start_time)),
 CHECK((activity_type='task' AND linked_task_id IS NOT NULL AND linked_habit_id IS NULL AND linked_goal_id IS NULL) OR
       (activity_type='habit' AND linked_habit_id IS NOT NULL AND linked_task_id IS NULL AND linked_goal_id IS NULL) OR
       (activity_type IN ('goal_action','appointment','personal') AND linked_task_id IS NULL AND linked_habit_id IS NULL)),
 CHECK(activity_type NOT IN ('task','habit') OR (status IN ('planned','cancelled') AND completed_at IS NULL)),
 CHECK((status='completed')=(completed_at IS NOT NULL)),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL))
);
CREATE INDEX daily_activities_owner_day ON daily_activities(user_id,scheduled_date,start_time,id) WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX daily_activities_task_once ON daily_activities(linked_task_id) WHERE linked_task_id IS NOT NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX daily_activities_habit_day_once ON daily_activities(linked_habit_id,scheduled_date) WHERE linked_habit_id IS NOT NULL AND cancelled_at IS NULL;
