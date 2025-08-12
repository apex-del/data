// server.js
import express from "express";
import fetch from "node-fetch";
import pg from "pg";

const app = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---- Create tables if missing ----
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS anime_data (
      id INT PRIMARY KEY,
      name TEXT,
      poster TEXT,
      sync_data JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scraper_state (
      last_id INT
    );
  `);

  const res = await pool.query("SELECT COUNT(*) FROM scraper_state");
  if (parseInt(res.rows[0].count) === 0) {
    await pool.query(`INSERT INTO scraper_state (last_id) VALUES (0)`);
  }
}

// ---- Get last ID from DB ----
async function getLastId() {
  const res = await pool.query("SELECT last_id FROM scraper_state LIMIT 1");
  return res.rows[0].last_id;
}

// ---- Save last ID to DB ----
async function saveLastId(id) {
  await pool.query("UPDATE scraper_state SET last_id = $1", [id]);
}

// ---- Save scraped data ----
async function saveAnime(data) {
  await pool.query(
    `INSERT INTO anime_data (id, name, poster, sync_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [data.id, data.name, data.poster, data.syncData]
  );
}

// ---- Scraping function ----
async function scrapeAnime(id, retry = 1) {
  const targetUrl = `https://hianime.pe/sakamoto-days-${id}`;
  const proxyUrl = `https://proxy-api-kyot.onrender.com/proxy?url=${encodeURIComponent(targetUrl)}`;

  try {
    const res = await fetch(proxyUrl);
    const html = await res.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1] : '❌ Not Found';
    const animeName = rawTitle.replace(/^Watch\s+/, '').replace(/\s+English.*$/, '').trim();

    const posterMatch = html.match(/<div class="film-poster">[\\s\\S]*?<img[^>]+src="([^"]+)"/i);
    const posterUrl = posterMatch ? posterMatch[1] : '❌ Not Found';

    const syncDataMatch = html.match(/<script id="syncData" type="application\\/json">\\s*(\\{[\\s\\S]*?\\})\\s*<\\/script>/i);
    let syncData = null;
    if (syncDataMatch) {
      try {
        const parsed = JSON.parse(syncDataMatch[1]);
        delete parsed.series_url;
        delete parsed.selector_position;
        syncData = parsed;
      } catch (e) {
        syncData = '❌ Invalid JSON';
      }
    } else {
      syncData = '❌ Not Found';
    }

    return { id, name: animeName, poster: posterUrl, syncData };
  } catch (err) {
    if (retry > 0) {
      console.warn(`Retrying ID ${id}...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return scrapeAnime(id, retry - 1);
    } else {
      return { id, name: '❌ Error', poster: null, syncData: null };
    }
  }
}

// ---- Endpoint to run scraper ----
app.get("/run-scraper", async (req, res) => {
  try {
    await initDB();
    let lastId = await getLastId();

    const batchSize = 10; // scrape 10 anime per run
    const startId = lastId + 1;
    const endId = lastId + batchSize;

    const scraped = [];

    for (let i = startId; i <= endId; i++) {
      const data = await scrapeAnime(i);
      await saveAnime(data);
      scraped.push(data);

      const delay = Math.floor(Math.random() * 2000) + 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await saveLastId(endId);

    res.json({ status: "done", scraped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
