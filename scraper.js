import fetch from "node-fetch";
import { pool } from "./db.js";

export async function runScraper() {
  // Get the last scraped ID
  const { rows } = await pool.query("SELECT last_id FROM scraper_state LIMIT 1");
  let startId = rows.length ? rows[0].last_id + 1 : 1;
  let endId = startId + 999; // scrape 1000 at a time

  console.log(`Scraping from ${startId} to ${endId}...`);

  for (let i = startId; i <= endId; i++) {
    const data = await scrapeAnime(i);
    await pool.query(
      "INSERT INTO anime_data (id, name, poster, sync_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
      [data.id, data.name, data.poster, JSON.stringify(data.syncData)]
    );

    // Update last scraped ID
    await pool.query("UPDATE scraper_state SET last_id = $1", [i]);

    await delay(2000 + Math.floor(Math.random() * 2000)); // delay 2-4 sec
  }

  return { startId, endId };
}

async function scrapeAnime(id, retry = 1) {
  const targetUrl = `https://hianime.pe/sakamoto-days-${id}`;
  const proxyUrl = `https://proxy-api-kyot.onrender.com/proxy?url=${encodeURIComponent(targetUrl)}`;

  try {
    const res = await fetch(proxyUrl);
    const html = await res.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const animeName = titleMatch
      ? titleMatch[1].replace(/^Watch\s+/, "").replace(/\s+English.*$/, "").trim()
      : "❌ Not Found";

    const posterMatch = html.match(/<div class="film-poster">[\s\S]*?<img[^>]+src="([^"]+)"/i);
    const posterUrl = posterMatch ? posterMatch[1] : "❌ Not Found";

    const syncDataMatch = html.match(/<script id="syncData" type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/i);
    let syncData = syncDataMatch ? JSON.parse(syncDataMatch[1]) : "❌ Not Found";

    return { id, name: animeName, poster: posterUrl, syncData };
  } catch (err) {
    if (retry > 0) {
      console.warn(`Retrying ID ${id}...`);
      await delay(3000);
      return scrapeAnime(id, retry - 1);
    }
    return { id, name: "❌ Error", poster: null, syncData: null };
  }
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
