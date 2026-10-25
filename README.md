# AI-Enhanced Student Feedback Analysis System

A working student feedback collection and admin review application built with HTML, locally served Bootstrap, vanilla JavaScript, Node.js, Express, and SQLite. Includes Google Gemini sentiment analysis, language detection and emotion intensity scoring, with an administrator summary dashboard.

## Install and run

1. Install Node.js 22.23 or later (Node.js 24 LTS also works), including npm.
2. Open a terminal in this project folder.
3. Install dependencies:
   ```sh
   npm install
   ```
4. Optionally copy `.env.example` to `.env` and change configuration. No configuration is needed for local use.
5. Start the server:
   ```sh
   npm start
   ```
6. Open http://localhost:3000 to submit feedback.
7. Open http://localhost:3000/login.html and log in with username `admin` and password `admin123`.
8. The dashboard at http://localhost:3000/admin shows all feedback, newest first. Use **Refresh feedback** to retrieve new submissions and **Sign out** to end the session.

For development with automatic server restarts, run `npm run dev`. Stop the server with Ctrl+C. To run the integration checks, use `npm test`.

SQLite uses Node.js’s built-in `node:sqlite` module; no native SQLite package compilation is needed. Node.js 22 may print an experimental SQLite warning.

## Files

- `server.js`: routes, sessions, validation, access checks and error handling.
- `database.js`: database schema, durable SQLite configuration and initial admin seed.
- `public/index.html`, `public/login.html`: student and administrator entry pages.
- `public/css/styles.css`, `public/js/*.js`: responsive styling and browser interactions.
- `private/dashboard.html`: dashboard served only to authenticated administrators.
- `test/app.test.js`: validation, login, authorization, persistence and logout checks.
- `data/database.db`: automatically generated feedback/admin database.
- `data/sessions.db`: automatically generated persistent session database.

## Data and authentication

Feedback requires one of the currently available database topics and 1–5,000 non-whitespace characters. SQLite stores topic, feedback text, and an ISO 8601 UTC timestamp; the dashboard displays dates in the browser's local timezone. Success is returned only after the database insert completes. SQL uses bound parameters, and the dashboard inserts feedback as plain text.

Admin passwords use bcrypt hashes. Login regenerates the session ID, sessions expire after eight hours, and cookies are HttpOnly and SameSite=Strict. Login attempts and feedback submissions are rate limited. Both the dashboard page and feedback-list API require authentication. Bootstrap is served locally; automated analysis requires the Gemini API.

Data and sessions survive application restarts. Keep the `data/` directory on persistent storage. Back up the database regularly; no application can guarantee against disk loss or deletion. For a simple consistent backup, stop the server and copy the entire `data/` directory, then restart. Do not delete the SQLite WAL files while the server is running. Tests use separate temporary databases and leave application data untouched.

## Configuration and production

- `PORT`: default `3000`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: used **only when no administrator exists**, on the first startup. Set a strong password before the first start of a public deployment. Changing these values later does not update an existing account.
- `SESSION_SECRET`: optional locally; otherwise a random secret is generated and persisted in the database. Set a long random secret explicitly for production.
- `NODE_ENV=production`: requires `SESSION_SECRET` and enables Secure cookies, so HTTPS is required. When deploying behind a trusted TLS reverse proxy, configure Express `trust proxy` for your exact infrastructure before starting; do not blindly trust arbitrary forwarded headers.

The default account is intended for local setup. There is no password-change UI, account recovery, or feedback deletion feature in the requested scope. All submitted feedback remains stored.

## Google Gemini setup and update instructions

1. Stop the running server and back up the `data/` directory.
2. Run `npm install` to install the new `@google/generative-ai` dependency and update the lockfile. Use this command before `npm ci` when upgrading from the earlier release.
3. Copy `.env.example` to `.env` if you do not already have one. Preserve any existing configuration.
4. Add these server-only values to `.env`:
   ```env
   GEMINI_API_KEY=your-real-api-key
   
   ```
   Create/manage your key in your Google Gemini API account. API access with available quota is required; free-tier limits depend on your project and model. Never share the key, place it in `public/`, or commit `.env`. The server never returns the key to the browser.
5. Run `npm start`. Node's built-in environment loader reads `.env`; `dotenv` is not needed. Restart the process after changing the key.
6. Submit feedback at http://localhost:3000, then log in at http://localhost:3000/login.html using your existing administrator account. Click **Refresh feedback** to see new results.
7. Run `node --test test/analysis.test.js` for offline AI/migration checks, or `npm test` for all checks including HTTP authentication tests. Tests mock Google Gemini and do not spend API credits.

### Migration and behavior

Startup automatically runs an idempotent, transactional SQLite migration that adds nullable `sentiment` (TEXT), `language` (TEXT), and `intensity` (INTEGER) columns using `ALTER TABLE`. Existing submissions, dates and administrator credentials are retained. There is no need to recreate or delete the database. Old records remain **Not analyzed**; this update does not automatically spend API credits analyzing historical submissions.

For each new submission the server saves the original feedback, calls Google Gemini using the requested Google JavaScript SDK, validates the structured JSON response and writes all three results to that row before returning success. Feedback text is sent to Google Gemini; the student form discloses this. The model is fixed to `gemini-3.5-flash-lite` in `analysis.js`. The requested `@google/generative-ai` SDK is deprecated but retained to match the requested package.

Sentiment is Positive, Negative or Neutral. Intensity is an integer from 1 to 10, independent of sentiment. Languages are Kazakh, Russian or English, with Other/Unknown for unsupported or undetectable languages. Mixed-language input uses the dominant language. These are AI estimates, not verified facts; a particular example's exact score is not guaranteed.

A missing key, timeout, quota error, refusal, or malformed response does not discard feedback or invent scores. The student receives confirmation that feedback was saved and analysis is unavailable. The dashboard shows **Not analyzed**, excludes that row from sentiment totals, and reports the number of unanalyzed submissions. There is no automatic retry or historical backfill. Requests use a 30-second timeout and no automatic retry, so submission can take longer than before.

Official references: [Gemini model shutdowns](https://ai.google.dev/gemini-api/docs/changelog), [requested SDK and its deprecation](https://github.com/google-gemini/deprecated-generative-ai-js).

## Verification in the build environment

The offline analysis tests cover structured requests, supported languages, JSON validation, refusals, incomplete responses, migration preservation, successful persistence and API failures. HTTP checks require permission to listen on local network ports. A live Google Gemini call requires your private API key and network access. The build environment cannot resolve the npm registry, so install the new SDK on your computer with `npm install`.

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
2. Run `npm install` if dependencies are not already installed. No new packages are needed for these topic features.
3. Keep your existing `GEMINI_API_KEY` in `.env`; the model remains hardcoded to `gemini-3.5-flash-lite`.
4. Run `npm start`. Startup automatically migrates SQLite, creates the `topics` table, seeds the original five topics once, imports any historical topic names, and adds nullable `feedback.ai_detected_topic`.
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
