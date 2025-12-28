import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import http from "http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import { createExtractorFromData } from "node-unrar-js";
import dotenv from "dotenv";

dotenv.config();

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PY_BASE = process.env.PY_BASE || "http://localhost:8001";
const PY_WS = process.env.PY_WS || "ws://localhost:8001";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["*"];
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_WS_BYTES = 1 * 1024 * 1024;
const WS_MIN_INTERVAL_MS = 1000 / 20;
const PY_TIMEOUT_MS = 3000;
const DATA_ROOT = path.join(__dirname, "data");
const PROJECT_ROOT = path.join(DATA_ROOT, "projects");

ensureDir(DATA_ROOT);
ensureDir(PROJECT_ROOT);

const dbPath = path.join(DATA_ROOT, "projects.db");
const db = new Database(dbPath);
db.prepare(
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    createdAt INTEGER,
    updatedAt INTEGER
  )`
).run();

const sessions = new Map();
const sessionWsRate = new Map();

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes("*")) return cb(null, true);
      return cb(
        ALLOWED_ORIGINS.includes(origin) ? null : new Error("Not allowed by CORS"),
        ALLOWED_ORIGINS.includes(origin)
      );
    },
    credentials: true,
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

app.use(express.json({ limit: "2mb" }));
app.use("/data", express.static(DATA_ROOT));

const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/session", (_req, res) => {
  const token = uuidv4();
  sessions.set(token, { createdAt: Date.now(), lastSeen: Date.now() });
  res.json({ token });
});

app.post("/api/projects", (req, res) => {
  const id = uuidv4();
  const now = Date.now();
  const name = req.body?.name || "Untitled";
  ensureProjectDirs(id);
  db.prepare(
    "INSERT OR REPLACE INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)"
  ).run(id, name, now, now);
  const project = createDefaultProject(id, name);
  fs.writeFileSync(getProjectFile(id), JSON.stringify(project, null, 2));
  res.json({ id });
});

app.get("/api/projects", (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, createdAt, updatedAt FROM projects ORDER BY updatedAt DESC")
    .all();
  res.json(rows);
});

app.get("/api/projects/:id", (req, res) => {
  try {
    const project = loadProject(req.params.id);
    res.json(project);
  } catch {
    res.status(404).json({ error: "プロジェクトが見つかりません。" });
  }
});

app.put("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "プロジェクトの内容が不正です。" });
  }
  ensureProjectDirs(id);
  fs.writeFileSync(getProjectFile(id), JSON.stringify(body, null, 2));
  db.prepare(
    "INSERT OR REPLACE INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, COALESCE((SELECT createdAt FROM projects WHERE id = ?), ?), ?)"
  ).run(id, body.name || "", id, Date.now(), Date.now());
  res.json({ ok: true });
});

app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const projectDir = path.join(PROJECT_ROOT, id);
  const projectFile = getProjectFile(id);
  const dirExists = fs.existsSync(projectDir);
  const fileExists = fs.existsSync(projectFile);
  try {
    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (dirExists) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } else if (fileExists) {
      fs.rmSync(projectFile, { force: true });
    }
    if (!dirExists && !fileExists && result.changes === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Project delete error", err);
    return res.status(500).json({ error: "Failed to delete project." });
  }
});

app.post("/api/projects/:id/live2d/upload", uploadZip.single("file"), async (req, res) => {
  const id = req.params.id;
  ensureProjectDirs(id);
  if (!req.file) return res.status(400).json({ error: "アーカイブファイルがありません。" });
  const fileName = req.file.originalname.toLowerCase();
  const isZip = fileName.endsWith(".zip");
  const isRar = fileName.endsWith(".rar");
  if (!isZip && !isRar) {
    return res.status(400).json({ error: "アップロードは .zip または .rar にしてください。" });
  }
  const projectDir = path.join(PROJECT_ROOT, id);
  const live2dDir = path.join(projectDir, "live2d");
  resetDir(live2dDir);

  try {
    if (isZip) {
      const zip = new AdmZip(req.file.buffer);
      const unsafe = zip.getEntries().find((entry) => isUnsafeArchivePath(entry.entryName));
      if (unsafe) {
        return res.status(400).json({ error: "アーカイブ内に不正なパスがあります。" });
      }
      zip.extractAllTo(live2dDir, true);
    } else {
      await extractRar(req.file.buffer, live2dDir);
    }
    const modelFiles = findFiles(live2dDir, (f) => f.toLowerCase().endsWith(".model3.json"));
    if (!modelFiles.length) {
      return res.status(400).json({ error: "アーカイブ内に .model3.json が見つかりません。" });
    }
    const modelList = modelFiles.map((file) =>
      path.relative(live2dDir, file).split(path.sep).join("/")
    );
    const modelPath = modelList[0];
    const validation = validateModel(live2dDir, modelPath);
    if (!validation.ok) {
      return res
        .status(400)
        .json({ error: "モデル検証に失敗しました。", details: validation.errors });
    }
    const project = safeLoadProject(id) || createDefaultProject(id, "Untitled");
    project.live2d = {
      modelPath,
      modelList,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(getProjectFile(id), JSON.stringify(project, null, 2));
    db.prepare("UPDATE projects SET updatedAt = ? WHERE id = ?").run(Date.now(), id);
    res.json({ modelPath, modelList });
  } catch (err) {
    console.error("Live2D upload error", err);
    res.status(500).json({ error: "アーカイブの展開に失敗しました。" });
  }
});

app.get("/api/projects/:id/live2d/manifest", (req, res) => {
  const id = req.params.id;
  const project = safeLoadProject(id);
  if (!project?.live2d?.modelPath) {
    return res.status(404).json({ error: "Live2Dモデルが設定されていません。" });
  }
  const baseUrl = `/data/projects/${id}/live2d/`;
  res.json({
    modelUrl: `${baseUrl}${project.live2d.modelPath}`,
    modelList: project.live2d.modelList || [project.live2d.modelPath],
  });
});

app.post("/api/projects/:id/autoconfig", (req, res) => {
  const id = req.params.id;
  const project = safeLoadProject(id);
  if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません。" });
  project.mapping = req.body?.mapping || project.mapping;
  project.calibration = req.body?.calibration || project.calibration;
  fs.writeFileSync(getProjectFile(id), JSON.stringify(project, null, 2));
  db.prepare("UPDATE projects SET updatedAt = ? WHERE id = ?").run(Date.now(), id);
  res.json({ ok: true });
});

app.use("/py", async (req, res) => {
  const targetUrl = `${PY_BASE}${req.originalUrl.replace(/^\/py/, "")}`;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.body && Object.keys(req.body).length > 0) {
        body = Buffer.from(JSON.stringify(req.body));
        headers.set("content-type", "application/json");
      } else {
        body = await collectBuffer(req);
      }
    }
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });
    const arrayBuffer = await resp.arrayBuffer();
    res.status(resp.status);
    resp.headers.forEach((v, k) => {
      if (k.toLowerCase() === "content-length") return;
      res.setHeader(k, v);
    });
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Proxy error", err);
    res.status(502).json({ error: "プロキシに失敗しました。" });
  }
});

const staticDir = path.join(__dirname, "front", "dist");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/py") || req.path.startsWith("/ws")) {
      return next();
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws/client",
  maxPayload: MAX_WS_BYTES,
});

wss.on("connection", (ws, req) => {
  const search = new URL(req.url, "http://localhost");
  let token = search.searchParams.get("token");
  let authenticated = token ? validateToken(token) : false;
  let awaitingToken = !authenticated;
  let pythonWs = null;
  let busy = false;
  let pendingFrame = null;
  let inflightTimer = null;

  function establishPython() {
    if (
      pythonWs &&
      (pythonWs.readyState === WebSocket.OPEN || pythonWs.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    pythonWs = new WebSocket(`${PY_WS}/ws/track`);
    pythonWs.on("open", () => {
      if (pendingFrame && !busy) sendFrame(pendingFrame);
    });
    pythonWs.on("message", (data) => {
      if (inflightTimer) {
        clearTimeout(inflightTimer);
        inflightTimer = null;
      }
      const payload =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf-8")
            : data;
      ws.send(payload);
      busy = false;
      if (pendingFrame) {
        const next = pendingFrame;
        pendingFrame = null;
        sendFrame(next);
      }
    });
    pythonWs.on("close", () => {
      if (inflightTimer) {
        clearTimeout(inflightTimer);
        inflightTimer = null;
      }
      busy = false;
      pythonWs = null;
    });
    pythonWs.on("error", (err) => {
      console.error("Python WS error", err);
      if (inflightTimer) {
        clearTimeout(inflightTimer);
        inflightTimer = null;
      }
      busy = false;
    });
  }

  function sendFrame(frame) {
    if (!authenticated) return;
    const now = Date.now();
    const last = sessionWsRate.get(token) || 0;
    if (now - last < WS_MIN_INTERVAL_MS) return;
    if (busy) {
      pendingFrame = frame;
      return;
    }
    if (!pythonWs || pythonWs.readyState !== WebSocket.OPEN) {
      pendingFrame = frame;
      establishPython();
      return;
    }
    busy = true;
    sessionWsRate.set(token, now);
    pythonWs.send(frame, { binary: true });
    if (inflightTimer) clearTimeout(inflightTimer);
    inflightTimer = setTimeout(() => {
      busy = false;
      if (pythonWs) {
        pythonWs.terminate();
        pythonWs = null;
      }
      if (pendingFrame) {
        const next = pendingFrame;
        pendingFrame = null;
        sendFrame(next);
      }
    }, PY_TIMEOUT_MS);
  }

  ws.on("message", (data) => {
    if (awaitingToken) {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.token && validateToken(parsed.token)) {
          token = parsed.token;
          authenticated = true;
          awaitingToken = false;
          establishPython();
          return;
        }
      } catch {
        // ignore
      }
      ws.close(4001, "Missing or invalid token");
      return;
    }
    if (typeof data === "string") return;
    if (data.length > MAX_WS_BYTES) {
      ws.close(1009, "Frame too large");
      return;
    }
    sendFrame(data);
  });

  ws.on("close", () => {
    if (inflightTimer) {
      clearTimeout(inflightTimer);
      inflightTimer = null;
    }
    if (pythonWs) {
      pythonWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`M:OTION server listening on http://localhost:${PORT}`);
});

function validateToken(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  session.lastSeen = Date.now();
  return true;
}

function ensureProjectDirs(id) {
  ensureDir(path.join(PROJECT_ROOT, id));
  ensureDir(path.join(PROJECT_ROOT, id, "live2d"));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resetDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function getProjectFile(id) {
  return path.join(PROJECT_ROOT, id, "project.json");
}

function createDefaultProject(id, name) {
  return {
    id,
    name,
    createdAt: Date.now(),
    live2d: {},
    mapping: null,
    calibration: {},
    settings: {
      capture: { width: 640, height: 360, fps: 12, quality: 0.6 },
      render: { stageWidth: 1920, stageHeight: 1080 },
    },
  };
}

function loadProject(id) {
  const file = getProjectFile(id);
  if (!fs.existsSync(file)) throw new Error("missing");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function safeLoadProject(id) {
  try {
    return loadProject(id);
  } catch {
    return null;
  }
}

function findFiles(dir, predicate) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, predicate));
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

function validateModel(rootDir, modelPath) {
  const errors = [];
  const modelFullPath = path.join(rootDir, modelPath);
  if (!fs.existsSync(modelFullPath)) {
    return { ok: false, errors: ["model3.json が見つかりません。"] };
  }
  const modelJson = JSON.parse(fs.readFileSync(modelFullPath, "utf-8"));
  const refs = modelJson.FileReferences || {};
  const mocFile = refs.Moc;
  if (!mocFile) errors.push("model3.json に Moc の参照がありません。");
  if (mocFile && !fs.existsSync(path.join(path.dirname(modelFullPath), mocFile))) {
    errors.push(`moc3 ファイルが見つかりません: ${mocFile}`);
  }
  const textures = refs.Textures || [];
  textures.forEach((tex) => {
    if (!fs.existsSync(path.join(path.dirname(modelFullPath), tex))) {
      errors.push(`テクスチャが見つかりません: ${tex}`);
    }
  });
  const physics = refs.Physics;
  if (physics && !fs.existsSync(path.join(path.dirname(modelFullPath), physics))) {
    errors.push(`physics が見つかりません: ${physics}`);
  }
  const expressions = refs.Expressions || [];
  expressions.forEach((expr) => {
    if (!expr.File) return;
    if (!fs.existsSync(path.join(path.dirname(modelFullPath), expr.File))) {
      errors.push(`expression が見つかりません: ${expr.File}`);
    }
  });
  const motions = refs.Motions || {};
  Object.values(motions).forEach((group) => {
    (group || []).forEach((motion) => {
      if (!motion.File) return;
      if (!fs.existsSync(path.join(path.dirname(modelFullPath), motion.File))) {
        errors.push(`motion が見つかりません: ${motion.File}`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

async function collectBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isUnsafeArchivePath(name) {
  const normalized = name.replace(/\\/g, "/");
  return normalized.includes("..") || path.isAbsolute(normalized) || normalized.includes(":");
}

function safeArchivePath(rootDir, entryName) {
  if (isUnsafeArchivePath(entryName)) {
    throw new Error(`Archive contains unsafe path: ${entryName}`);
  }
  const normalized = entryName.replace(/\\/g, "/");
  const targetPath = path.join(rootDir, normalized);
  const resolvedRoot = path.resolve(rootDir) + path.sep;
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Archive path escapes target: ${entryName}`);
  }
  return targetPath;
}

async function extractRar(buffer, targetDir) {
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const extractor = await createExtractorFromData({ data });
  const list = extractor.getFileList();
  const headers = [...list.fileHeaders];
  headers.forEach((header) => {
    if (isUnsafeArchivePath(header.name)) {
      throw new Error(`RAR contains unsafe path: ${header.name}`);
    }
  });
  const extracted = extractor.extract();
  const files = [...extracted.files];
  for (const file of files) {
    const entryName = file.fileHeader.name;
    const outPath = safeArchivePath(targetDir, entryName);
    if (file.fileHeader.flags.directory) {
      ensureDir(outPath);
      continue;
    }
    ensureDir(path.dirname(outPath));
    if (file.extraction) {
      fs.writeFileSync(outPath, Buffer.from(file.extraction));
    }
  }
}
