import pg from 'pg';
import fetch from 'node-fetch';
import pRetry from 'p-retry';
import dotenv from 'dotenv';

dotenv.config();

// DB client
const client = new pg.Client({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
  ssl: { rejectUnauthorized: false }
});

// Helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureTables() {
  // scraper_progress uses a single row with id = 1 so we can upsert easily
  await client.query(`
    CREATE TABLE IF NOT EXISTS scraper_progress (
      id INTEGER PRIMARY KEY,
      last_id INTEGER
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS anime_data (
      id INTEGER PRIMARY KEY,
      name TEXT,
      poster TEXT,
      sync_data JSONB,
      scraped_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS scraper_logs (
      id SERIAL PRIMARY KEY,
      anime_id INTEGER,
      status TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS run_logs (
      id SERIAL PRIMARY KEY,
      start_id INTEGER,
      end_id INTEGER,
      batch_size INTEGER,
      status TEXT,
      message TEXT,
      started_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function insertRunLog(startId, endId, batchSize, status = 'started', message = null) {
  const res = await client.query(
    `INSERT INTO run_logs (start_id, end_id, batch_size, status, message) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [startId, endId, batchSize, status, message]
  );
  return res.rows[0].id;
}

async function updateRunLogStatus(runId, status, message = null) {
  await client.query(`UPDATE run_logs SET status=$1, message=$2 WHERE id=$3`, [status, message, runId]);
}

async function logAnime(animeId, status, message = null) {
  await client.query(
    `INSERT INTO scraper_logs (anime_id, status, message) VALUES ($1, $2, $3)`,
    [animeId, status, message]
  );
}

async function getLastId() {
  const { rows } = await client.query('SELECT last_id FROM scraper_progress WHERE id = 1 LIMIT 1');
  return rows.length ? rows[0].last_id : 0;
}

async function setLastId(newLastId) {
  // upsert singleton row id=1
  await client.query(
    `INSERT INTO scraper_progress (id, last_id) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET last_id = EXCLUDED.last_id`,
    [newLastId]
  );
}

async function scrapeAnimeOnce(id) {
  const targetUrl = `https://hianime.pe/sakamoto-days-${id}`;
  const proxy = process.env.PROXY_URL?.trim(); // optional proxy endpoint
  const proxyUrl = proxy ? `${proxy}?url=${encodeURIComponent(targetUrl)}` : targetUrl;

  const res = await fetch(proxyUrl, { timeout: 20000 });
  if (!res.ok) throw new Error(`Fetch failed status=${res.status}`);
  const html = await res.text();

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const animeName = titleMatch
    ? titleMatch[1].replace(/^Watch\s+/, '').replace(/\s+English.*$/, '').trim()
    : null;

  const posterMatch = html.match(/<div class="film-poster">[\s\S]*?<img[^>]+src="([^"]+)"/i);
  const posterUrl = posterMatch ? posterMatch[1] : null;

  const syncDataMatch = html.match(/<script id="syncData" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/i);
  const syncData = syncDataMatch ? JSON.parse(syncDataMatch[1]) : null;

  return { id, name: animeName, poster: posterUrl, syncData };
}

async function scrapeWithRetry(id) {
  // p-retry will retry a few times on transient errors
  return pRetry(() => scrapeAnimeOnce(id), { retries: 2, minTimeout: 2000 });
}

async function main() {
  await client.connect();
  await ensureTables();

  const batchSize = parseInt(process.env.BATCH_SIZE || '10');
  const delayMs = parseInt(process.env.DELAY_MS || '3000'); // delay between each fetch
  const startIdFromEnv = parseInt(process.env.START_ID || '0');

  // determine start ID
  let lastId = await getLastId();
  let startId = lastId + 1;
  if (startIdFromEnv && startIdFromEnv > startId) startId = startIdFromEnv;

  const endId = startId + batchSize - 1;

  const runId = await insertRunLog(startId, endId, batchSize, 'started', null);

  console.log(`Run ${runId}: scraping ${startId} -> ${endId} (batch ${batchSize})`);

  let maxSuccessId = lastId;
  try {
    for (let id = startId; id <= endId; id++) {
      try {
        const anime = await scrapeWithRetry(id);
        if (!anime || !anime.name) {
          // not found or invalid
          await logAnime(id, 'not_found', 'No title or not found');
          console.log(`ID ${id} -> not found`);
        } else {
          // insert data
          await client.query(
            `INSERT INTO anime_data (id, name, poster, sync_data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
            [anime.id, anime.name, anime.poster, anime.syncData ? JSON.stringify(anime.syncData) : null]
          );
          await logAnime(id, 'ok', `Saved: ${anime.name}`);
          console.log(`ID ${id} -> saved: ${anime.name}`);
          if (id > maxSuccessId) maxSuccessId = id;
        }
      } catch (err) {
        // record error for this id
        await logAnime(id, 'error', err.message);
        console.error(`ID ${id} -> error: ${err.message}`);
      }

      await sleep(delayMs);
    }

    // update last_id to maxSuccessId or endId (you can choose behavior)
    // we set it to endId so next run continues after attempted range.
    // Alternative: set to maxSuccessId to advance only if saved successfully.
    const progressAdvanceMode = process.env.PROGRESS_MODE || 'advance_attempted'; 
    const newLastId = progressAdvanceMode === 'advance_on_success' ? maxSuccessId : endId;
    await setLastId(newLastId);

    await updateRunLogStatus(runId, 'success', `Completed; last_id set to ${newLastId}`);
    console.log(`Run ${runId} completed. last_id updated to ${newLastId}`);
  } catch (err) {
    await updateRunLogStatus(runId, 'failed', err.message);
    console.error('Fatal run error:', err);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Unhandled error in main:', err);
});
