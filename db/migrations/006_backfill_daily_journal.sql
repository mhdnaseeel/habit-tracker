INSERT INTO daily_journal(user_id,entry_date,content,version,created_at,updated_at)
SELECT user_id,month,content,version,updated_at,updated_at
FROM monthly_journal
ON CONFLICT(user_id,entry_date) DO NOTHING;
