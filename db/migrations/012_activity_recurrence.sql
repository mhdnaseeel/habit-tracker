ALTER TABLE daily_activities
  ADD COLUMN series_id integer,
  ADD COLUMN recurrence text NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily')),
  ADD COLUMN is_series_template boolean NOT NULL DEFAULT false,
  ADD COLUMN series_ends_on date;

ALTER TABLE daily_activities
  ADD CONSTRAINT daily_activities_series_owner_fk
    FOREIGN KEY (series_id, user_id)
    REFERENCES daily_activities(id, user_id);

UPDATE daily_activities SET series_id=id;
ALTER TABLE daily_activities ALTER COLUMN series_id SET NOT NULL;

CREATE UNIQUE INDEX daily_activities_series_date
  ON daily_activities(series_id, scheduled_date);
CREATE INDEX daily_activities_series_owner
  ON daily_activities(user_id, series_id, scheduled_date);

DROP INDEX daily_activities_habit_day_once;
CREATE UNIQUE INDEX daily_activities_habit_series_day_once
  ON daily_activities(linked_habit_id, scheduled_date, series_id)
  WHERE linked_habit_id IS NOT NULL AND cancelled_at IS NULL;
