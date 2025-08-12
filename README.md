# HiAnime Cron Scraper (with logging)

Scraper that resumes from last ID stored in Postgres and logs attempts.

## Install & test locally
1. Copy `.env.example` -> `.env` and fill database/env values.
2. `npm install`
3. `node index.js`

## Deploy as Render Cron Job
1. Push to GitHub.
2. Create a new **Cron Job** on Render (service type: "Cron Job").
3. Connect repo and branch.
4. Command: `npm install && npm start`
5. Add environment variables in Render (from `.env`).
6. Set schedule (e.g., every 1 hour).

## Behavior
- Uses `scraper_progress` (singleton) to keep last_id.
- Logs per-anime attempts in `scraper_logs`.
- Logs each run in `run_logs`.
- Use `PROGRESS_MODE=advance_on_success` if you want to only advance progress for successful saves.
