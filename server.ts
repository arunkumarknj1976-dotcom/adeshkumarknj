import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import ytdl from "@distube/ytdl-core";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Initialize ytdl agent with cookies and tokens if provided
  let agent: any = null;
  const cookieStr = process.env.YOUTUBE_COOKIE;
  const poToken = process.env.YOUTUBE_PO_TOKEN;
  const visitorData = process.env.YOUTUBE_VISITOR_DATA;

  if (cookieStr || poToken || visitorData) {
    try {
      let cookies = [];
      if (cookieStr) {
        if (cookieStr.startsWith('[') || cookieStr.startsWith('{')) {
          cookies = JSON.parse(cookieStr);
        } else {
          cookies = [{ name: 'cookie', value: cookieStr, domain: '.youtube.com' }];
        }
      }
      
      // Create agent with cookies and optional tokens
      // Note: poToken and visitorData are passed in the options of getInfo/ytdl, 
      // but some versions of the agent can also take them.
      agent = ytdl.createAgent(cookies);
      console.log("Successfully initialized ytdl agent");
    } catch (e) {
      console.error("Failed to initialize ytdl agent:", e);
    }
  }

  // API Routes
  app.get("/api/video-info", async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      if (!ytdl.validateURL(videoUrl)) {
        return res.status(400).json({ error: "Invalid YouTube URL" });
      }

      const info = await ytdl.getInfo(videoUrl, {
        agent,
        playerClients: ['ANDROID', 'WEB', 'TV'], // Fixed: 'TVHTML5' is not a valid type
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        }
      });
      const formats = info.formats;
      
      res.json({
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
        duration: info.videoDetails.lengthSeconds,
        author: info.videoDetails.author.name,
        formats: formats.map(f => ({
          quality: f.qualityLabel || (f.audioBitrate ? `${f.audioBitrate}kbps` : 'Audio'),
          container: f.container,
          url: f.url,
          hasVideo: f.hasVideo,
          hasAudio: f.hasAudio,
          itag: f.itag,
          audioBitrate: f.audioBitrate
        }))
      });
    } catch (error: any) {
      console.error("Error fetching video info:", error);
      let message = "Failed to fetch video information";
      if (error.message?.includes("Sign in to confirm you’re not a bot")) {
        message = "YouTube bot detection triggered. Please provide a valid YOUTUBE_COOKIE in the app settings.";
      }
      res.status(500).json({ error: message });
    }
  });

  // Download endpoint (proxies the download to avoid CORS/referral issues)
  app.get("/api/download", async (req, res) => {
    const videoUrl = req.query.url as string;
    const itag = req.query.itag as string;
    const ext = req.query.ext as string || 'mp4';

    if (!videoUrl) return res.status(400).send("URL is required");

    try {
      const info = await ytdl.getInfo(videoUrl, {
        agent,
        playerClients: ['ANDROID', 'WEB', 'TV'],
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        }
      });

      let title = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim();
      if (!title) title = 'video';
      
      const filename = `${title}.${ext}`;

      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      if (ext === 'mp3') {
        res.header('Content-Type', 'audio/mpeg');
      } else {
        res.header('Content-Type', 'video/mp4');
      }

      // Use downloadFromInfo to avoid redundant getInfo call
      ytdl.downloadFromInfo(info, {
        quality: itag ? parseInt(itag) : (ext === 'mp3' ? 'highestaudio' : 'highestvideo'),
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        }
      }).pipe(res);
    } catch (error: any) {
      console.error("Download error:", error);
      let message = "Download failed";
      if (error.message?.includes("Sign in to confirm you’re not a bot")) {
        message = "YouTube bot detection triggered. Please provide a valid YOUTUBE_COOKIE in the app settings.";
      }
      res.status(500).send(message);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
