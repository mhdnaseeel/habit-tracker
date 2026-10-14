# Daily Journal and AI Mentor

## API contract

All routes use the existing bearer-token authentication and are documented through `/api/v1/openapi.json` route summaries. Dates are `YYYY-MM-DD` in the account's local calendar; future journal writes are rejected. A user has one journal entry per date.

| Route                                     | Purpose                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/journal/blueprints`          | List five active system blueprints with ordered prompt IDs and text.                                                                                                                                                           |
| `GET /api/v1/journal/:date`               | Read an entry, or `status: "empty"` and `version: null`.                                                                                                                                                                       |
| `PUT /api/v1/journal/:date`               | Create or update `{content, blueprintId, responses, status, version}`. `status` is `draft` or `saved`; a saved entry needs nonblank content or a nonblank response. `version: null` creates; a stale version returns 409.      |
| `DELETE /api/v1/journal/:date`            | Delete with `{version}`; stale or missing entries return 409.                                                                                                                                                                  |
| `GET /api/v1/journal/history?from=…&to=…` | List owned entries in a range of up to 93 days, newest first.                                                                                                                                                                  |
| `GET /api/v1/journal/:date/context`       | Read owned recorded routine check-ins and active goal step counts. The web editor also uses the existing habit-history endpoint for scheduled but unchecked routines.                                                          |
| `GET /api/v1/mentor/consent`              | Read the account's AI journal-sharing choice.                                                                                                                                                                                  |
| `PUT /api/v1/mentor/consent`              | Save `{consent: boolean}`. Defaults to false.                                                                                                                                                                                  |
| `POST /api/v1/mentor/guidance`            | Request `{focus: "today"\|"habits"\|"goals"\|"journal", includeJournal: boolean}`. Returns grounded guidance or `insufficient_data`. Journal inclusion without consent returns 403; provider failures return 429, 502, or 503. |

Response keys follow the app's camel-case API convention. `responses` is an object keyed by `blueprint-id:prompt-id`; each answer is optional. The API copies blueprint prompts into `blueprintSnapshot` on selection and returns them with the entry. Previous text survives blueprint changes. Clients should retain the current editor state until a write succeeds and use the returned version for later writes.

## Data sharing and limitations

The AI Mentor screen explains the optional OpenAI transfer before a request. With journal consent enabled, the server may send recent journal entries including drafts, up to seven entries from the previous 14 days. With consent disabled, it sends no journal text. It may also send bounded account habit, task, and goal data. The app does not store generated guidance or use it to modify records. The request uses `store: false`; consult OpenAI's own data policy for provider-side handling. Journal entries are sensitive, so do not include them in server logs, support tickets, or screenshots.

If the API key is absent, credits are exhausted, the provider is rate limited, the request times out, or the response is invalid, the mentor shows an error and the journal remains usable. If there is no relevant account data, the mentor explains what to record first. Recorded check-in counts alone are not presented as a full scheduled completion rate. Suggestions can still be mistaken: the UI presents the application's source evidence separately and marks tentative interpretations.

## Verification checklist

| Requirement                         | Implementation                                                   | Evidence                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Existing data preserved             | Migrations 008 and 009; legacy rows default to saved             | Migrations applied to existing local data and a separate clean Docker database; old journal integration contract remains accepted |
| Create/read/update/delete/history   | `journal.ts`, version checks, date validation                    | `npm run test:journal`                                                                                                            |
| Blueprints, prompts, drafts, export | SQL blueprint table, snapshot, responses, status; account export | `npm run test:journal` and local browser run                                                                                      |
| Journal privacy                     | Owner-filtered queries and default-off AI consent                | Cross-account and 403 cases in `npm run test:journal`                                                                             |
| Optional AI and provider failures   | `mentor.ts`, schema validation, timeout/retry/rate-limit mapping | `npm run test:mentor-provider`; local OpenAI request returned 429 on 2026-10-14                                                   |
| Responsive editor/navigation        | Existing design system plus journal/mentor layout                | Local browser inspected at 375, 768, and 1440 px; no document overflow                                                            |
| Non-AI independence                 | No provider call in journal write path                           | Journal test and browser save succeeded while live AI returned 429                                                                |

The live OpenAI success path could not be confirmed in the local run because the provider returned 429. Automated provider tests use a stub and do not prove current external-account availability. No visual baseline exists, so pixel-level visual regression is unverified.
