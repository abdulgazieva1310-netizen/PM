# AI-Enhanced Student Feedback Analysis System

A student feedback and administrator review app built with HTML, Bootstrap, vanilla JavaScript, Node.js, Express, PostgreSQL, and Google Gemini. It includes sentiment analysis, language detection, emotion intensity, weekly exports, and recurring issue summaries.

## Install and run locally

1. Install Node.js 22 or later, npm, and PostgreSQL.
2. Create a local database, for example:
   ```sh
   createdb ai_student_feedback
   ```
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL connection string. Set `SESSION_SECRET` and administrator credentials before exposing the app.
4. Install dependencies and start the app:
   ```sh
   npm install
   npm start
   ```
5. On startup, the app creates or updates all tables from `schema.sql`, seeds the default topics, and creates the first administrator if none exists.
6. Open http://localhost:3000 to submit feedback and http://localhost:3000/login.html to sign in.

Set `DATABASE_URL` in Render's environment to the database's internal URL when the web service and database share a region. For local connections to Render use its external URL with `sslmode=require`. Set `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `GEMINI_API_KEY` in the service environment. Render runs `npm start`; no local database files or disk mount are needed. See [Render's Postgres connection guide](https://render.com/docs/postgresql-creating-connecting) for current connection details.

To create the tables manually before starting the app, run:

```sh
psql "$DATABASE_URL" -f schema.sql
```

The app uses parameterized PostgreSQL queries and `SERIAL` primary keys. Database setup and additive column migrations are idempotent. The first admin account is seeded only if no admin exists; changing `ADMIN_USERNAME` or `ADMIN_PASSWORD` later does not change an existing account.

To copy an existing local SQLite database before deploying, set `DATABASE_URL` to the target PostgreSQL database and run `npm run migrate:sqlite`. The importer reads `data/database.db` by default; set `SQLITE_PATH` to use another file. It copies feedback, topics, administrator credentials, and settings without replacing conflicting PostgreSQL rows. It does not copy active login sessions. Keep the original SQLite file as a backup until you confirm the PostgreSQL data.

For development with automatic server restarts, run `npm run dev`. `dotenv` loads `.env` for local use. To run the automated checks, use `npm test` with a dedicated test PostgreSQL database configured in `TEST_DATABASE_URL`.

## Files

- `server.js`: routes, PostgreSQL-backed sessions, validation, and access checks.
- `database.js` and `schema.sql`: PostgreSQL connection, tables, and initial seed.
- `analysis.js`: Gemini feedback classification and key issue analysis.
- `topics.js`: topic, feedback, and weekly report queries.
- `private/dashboard.html`, `public/js/dashboard.js`, `public/css/styles.css`: admin interface.

## Data and authentication

Feedback and sessions are stored in PostgreSQL and survive application restarts. Back up the PostgreSQL database using your provider's backup tools. Admin passwords use bcrypt hashes. Sessions expire after eight hours, and cookies are HttpOnly and SameSite=Strict. Login attempts and feedback submissions are rate limited. The dashboard and admin APIs require authentication.

## Configuration

- `DATABASE_URL`: required PostgreSQL connection string. Render supplies this when the database is linked to the web service.
- `PORT`: defaults to `3000`; Render supplies its own port.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: used only to create the first administrator.
- `SESSION_SECRET`: optional for local development; required in production.
- `NODE_ENV=production`: enables Secure session cookies, so serve the app over HTTPS.

## Google Gemini setup and update instructions

1. Stop the running server and make sure `DATABASE_URL` points to the PostgreSQL database.
2. Run `npm install` to install project dependencies and update the lockfile.
3. Copy `.env.example` to `.env` if you do not already have one. Preserve any existing configuration.
4. Add these server-only values to `.env`:
   ```env
   GEMINI_API_KEY=your-real-api-key
   
   ```
   Create/manage your key in your Google Gemini API account. API access with available quota is required; free-tier limits depend on your project and model. Never share the key, place it in `public/`, or commit `.env`. The server never returns the key to the browser.
5. Run `npm start`. `dotenv` loads `.env` for local development. Restart the process after changing the key.
6. Submit feedback at http://localhost:3000, then log in at http://localhost:3000/login.html using your existing administrator account. Click **Refresh feedback** to see new results.
7. Run `npm test` with a dedicated PostgreSQL test database configured in `TEST_DATABASE_URL`. Use a separate database from development or production.

### Migration and behavior

Startup creates or updates the PostgreSQL schema transactionally and idempotently. The schema includes nullable analysis fields; records without analysis remain **Not analyzed**. No historical Gemini analysis is run automatically.

For each new submission the server saves the original feedback, calls Google Gemini using the requested Google JavaScript SDK, validates the structured JSON response and writes all three results to that row before returning success. Feedback text is sent to Google Gemini; the student form discloses this. The model is fixed to `gemini-3.5-flash-lite` in `analysis.js`. The requested `@google/generative-ai` SDK is deprecated but retained to match the requested package.

Sentiment is Positive, Negative or Neutral. Intensity is an integer from 1 to 10, independent of sentiment. Languages are Kazakh, Russian or English, with Other/Unknown for unsupported or undetectable languages. Mixed-language input uses the dominant language. These are AI estimates, not verified facts; a particular example's exact score is not guaranteed.

A missing key, timeout, quota error, refusal, or malformed response does not discard feedback or invent scores. The student receives confirmation that feedback was saved and analysis is unavailable. The dashboard shows **Not analyzed**, excludes that row from sentiment totals, and reports the number of unanalyzed submissions. There is no automatic retry or historical backfill. Requests use a 30-second timeout and no automatic retry, so submission can take longer than before.

Official references: [Gemini model shutdowns](https://ai.google.dev/gemini-api/docs/changelog), [requested SDK and its deprecation](https://github.com/google-gemini/deprecated-generative-ai-js).

## Verification in the build environment

Analysis tests cover structured requests, supported languages, JSON validation, refusals, incomplete responses, persistence and API failures. Use a dedicated PostgreSQL database for database-backed tests. Tests mock Google Gemini and do not spend API credits.

## Troubleshooting unavailable AI analysis

Run `npm run check:ai` from the project folder. It sends one short sample sentence to Google Gemini and reports a safe diagnosis without printing the API key. Normal submission failures also print a safe `[AI analysis]` warning in the server terminal. Restart with `npm start` after changing `.env`.

- Missing key: add `GEMINI_API_KEY` in `.env`.
- 401: replace the rejected key with a valid API key.
- Quota/429: check API billing, project limits, or retry after the rate limit clears.
- Connection error: the Node.js server must reach `https://generativelanguage.googleapis.com`; check DNS, firewall, proxy, or internet restrictions.
- Model/request errors: verify your project can access `gemini-3.5-flash-lite`; the model is hardcoded in `analysis.js`.

Previously saved unanalyzed submissions are retained but are not retried automatically. Submit a new sample after fixing the connection.

### Exact installation and restart commands

In your project terminal, stop the current server with Ctrl+C, then run:

```sh
npm uninstall openai
npm install @google/generative-ai
```

Edit the existing `.env` file (do not overwrite unrelated settings):

```env
GEMINI_API_KEY=your-google-gemini-key

```

The model is hardcoded to `gemini-3.5-flash-lite`; no model environment variable is needed. Do not reuse an OpenAI API key as a Gemini key.

Then run:

```sh
npm run check:ai
npm start
```

The diagnostic makes one API request and does not display your key. Existing database records, analysis fields and dashboard remain compatible; no data reset is needed.

## Current Gemini configuration and failure details

The model is hardcoded in `analysis.js` to `gemini-3.5-flash-lite`; `GEMINI_MODEL` is ignored. Only `GEMINI_API_KEY` is needed in `.env`. The request sets Gemini 3.5 Flash-Lite thinking to minimal and allows 2,048 output tokens to keep this short classification from exhausting its JSON output budget. The request timeout is 30 seconds.

New analysis failures store a safe, fixed diagnostic message in `analysis_error`, displayed beneath **Not analyzed** in the protected admin dashboard. Raw provider errors, API keys and request URLs are never stored or displayed. Existing records remain intact; startup adds the extra column automatically. Historical failed rows do not gain diagnostics retroactively.

Run `npm run check:ai` on the computer running the server. A connection failure means that Node.js could not reach Gemini; changes to sentiment parsing cannot fix a blocked network. Check that this computer can access `generativelanguage.googleapis.com`. For invalid-key or quota failures, fix the corresponding API key or Google project quota. Restart with `npm start` after changing `.env`, then submit a fresh sample.

## Stories 9–12: dynamic topics and analytics

### Run the update

1. Stop the server with Ctrl+C. Back up the `data/` directory while the server is stopped.
2. Run `npm install` if dependencies are not already installed.
3. Keep your existing `GEMINI_API_KEY` in `.env`; the model remains hardcoded to `gemini-3.5-flash-lite`.
4. Run `npm start`. Startup creates the PostgreSQL `topics` table, seeds the original five topics once, imports any topic names already in PostgreSQL feedback, and adds nullable `feedback.ai_detected_topic` if needed.
5. Open http://localhost:3000/login.html and sign in. Use **Manage topics** to add or delete topics. Names must be unique (case insensitive), nonblank, and at most 80 characters. At least one topic must remain available.
6. Open or refocus http://localhost:3000. The form fetches current topics from the server; newly added topics are immediately available to the API and appear on the next form load or window focus. A stale deleted selection is rejected by the server.
7. Submit feedback. Gemini receives the current topic list and must return exactly one allowed `ai_detected_topic`, alongside sentiment, language and intensity. Student choices are preserved. The dashboard flags disagreement rather than silently replacing the student's topic. Older records have no AI-detected topic until analyzed; there is no automatic historical backfill.
8. Select **Filter by student topic** to filter the table. Sentiment summary cards and **Most discussed topics** cover all submissions and stay independent of the selected table filter. The ranked meter chart counts student-selected topics, including historical deleted topics. Volume indicates discussion frequency, not necessarily dissatisfaction.

Deleting a topic removes it from future student choices and Gemini's topic list. Existing feedback and AI detections remain intact. Deleted topics remain available in historical filters and statistics. Restarting the app does not recreate deleted default topics.

### Endpoints

| Method | Endpoint | Access / behavior |
| --- | --- | --- |
| GET | `/api/topics` | Public: current `{id, name}` topics |
| POST | `/api/topics` | Admin: JSON `{ "name": "Housing" }` |
| DELETE | `/api/topics/:id` | Admin: remove an available topic |
| GET | `/api/feedback?topic=Library` | Admin: exact student-topic filter; omit query for all |
| GET | `/api/statistics/topics` | Admin: ranked `{topic, count}` totals across all feedback |

Topic labels and feedback are rendered as text, queries use bound parameters, and mutations require an administrator session. Topic migration is transactional and repeatable.

### Checks

Run offline tests without API charges:

```sh
node --test test/analysis.test.js test/topics.test.js
```

Run all integration tests with `npm test`. HTTP checks require permission to listen on local ports; the restricted build environment blocks that. Offline checks cover dynamic Gemini enums, invalid AI topics, topic validation, duplicate names, deletion, preservation of feedback, exact filtering, statistics and restart persistence. Live AI verification still requires network access and a working Gemini key.
