# Today agenda: data and behavior

Today combines three existing sources for a selected local date: due habits from the history API, due tasks from the task API, and optional time blocks from the activity API. This keeps habit check-ins and task completion in their original tables. A linked habit or task appears once in the agenda; its time block replaces its unscheduled card.

Migration `007_daily_activities.sql` adds `daily_activities`. A row represents a standalone appointment, personal routine, or goal action, or a scheduling block attached to exactly one owned task or habit. The table has owner-scoped foreign keys, a version for concurrent edits, status and time constraints, and partial unique indexes that prevent duplicate active blocks for a task or a habit on a date. Cancellation keeps the row for audit and account export while removing it from the agenda. Existing tasks and habit logs remain the source of truth for their completion.

Creating a new task from Today inserts the task, task instance, and activity in one transaction. Existing task blocks can be moved to another date; this also updates the underlying task and its instance in the same transaction. Habit blocks can move within their scheduled date. Moving one to another date requires creating a block for a habit that is actually due then. No recurring activity series or overnight time blocks are created. Task and habit recurrence remains governed by their existing schedules.

The browser calls the existing task and habit completion endpoints for linked cards. These endpoints retain their validation, idempotency, audit, correction windows, and streak logic. The activity completion, undo, and skip endpoints apply only to standalone rows. A goal-linked action records its own completion and does not change goal step or goal progress. A time cue is stored and shown in the agenda; it does not send a notification.

The daily count is one per visible underlying task, due habit, or standalone action. Skipped standalone activities and frozen habits are excluded; future dates have no completion denominator. Timed cards are ordered by local start time and overlapping intervals are labelled. Unscheduled cards follow the timeline. The selected date and clock use the account's IANA timezone. Today requests three existing owner-scoped endpoints in parallel.

## API

- `GET /api/v1/activities?date=YYYY-MM-DD`: owned, non-cancelled time blocks and standalone actions for one local date, sorted by start time.
- `GET /api/v1/activities/:id`: one owned activity.
- `POST /api/v1/activities`: create an activity; `task` without `linkedTaskId` creates the underlying task atomically.
- `PATCH /api/v1/activities/:id`: edit fields with required `version`. Linked task and habit identity cannot change.
- `POST /api/v1/activities/:id/reschedule`: move an activity with `version`, `scheduledDate`, `startTime`, and `endTime`.
- `POST /api/v1/activities/:id/complete|undo|skip`: idempotent standalone status changes. Linked cards use the existing task or habit actions.
- `DELETE /api/v1/activities/:id`: cancel with required `version`; completed work must be undone first.

All endpoints require the normal account bearer token. Reads and writes are owner-scoped; invalid times, unavailable links, future completion, and stale versions return API errors. Account export includes cancelled and active activity history.

Run `npm run test:activities` against the local Docker stack. The test creates and deletes disposable local accounts. It covers CRUD, ordering, unscheduled and overlapping times, timezone-local dates, linked task and habit completion, duplicate requests, goal-progress isolation, concurrency, ownership, and export. Recurrence is intentionally absent under the product PRD's lightweight task model.
