// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { JSDOM } from "jsdom";

const app = express();
app.use(cors());

app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  const mode = req.query.mode || "full"; // default = full page

  if (!targetUrl) {
    return res.status(400).send("Missing 'url' parameter");
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Referer": "https://gogoanime.com.by/",
      },
    });

    let html = await response.text();

    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    });

    if (mode === "player") {
      // Extract just the video player
      const dom = new JSDOM(html);
      const videoEl = dom.window.document.querySelector("video, iframe");

      if (!videoEl) return res.send("No video found.");

      res.send(`
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>body{margin:0;background:black;display:flex;justify-content:center;align-items:center;height:100vh;}</style>
          </head>
          <body>
            ${videoEl.outerHTML}
          </body>
        </html>
      `);
    } else {
      // Send full page
      res.send(html);
    }
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(3000, () => {
  console.log("Proxy running on port 3000");
});
