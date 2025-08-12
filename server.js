import express from "express";
import { runScraper } from "./scraper.js";

const app = express();

app.get("/run-scraper", async (req, res) => {
  try {
    const result = await runScraper();
    res.json({ status: "ok", range: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scraper API running on port ${PORT}`));
