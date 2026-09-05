// Codex Harness 版本发布中心 · 后端（零依赖版）
// 启动：node server.js  （无需 npm install，Node >= 20 即可）
//
// 为什么零依赖：npm 公共注册表 502 装不上 better-sqlite3/express/multer，
// 且部署到服务器免编译。存储改为 JSON 文件（data/releases.json），
// 上传改用内置 http + 手写 multipart 解析，其余 API 与前端约定完全一致。
//
// 安全提示：这是给内部/演示用的版本中心。如果要上公网，
// 请务必在 .env 改掉 ADMIN_PASSWORD，并建议在 Caddy 后面加 TLS。

const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { URL } = require("node:url");

// ============== 配置（手写 .env 解析，零依赖） ==============
const ROOT = __dirname;
function loadEnv() {
  const out = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      // 去掉包裹的引号
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // 行尾注释（仅在没被引号包裹时）
      if (!v.includes('"') && !v.includes("'")) {
        v = v.replace(/\s+#.*$/, "").trim();
      }
      out[m[1]] = v;
    }
  } catch {
    /* .env 不存在则用默认值 */
  }
  return out;
}
const ENV = loadEnv();
const PORT = parseInt(ENV.PORT || "8080", 10);
const ADMIN_USER = ENV.ADMIN_USER || "admin";
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || "admin123";
const SITE_TITLE = ENV.SITE_TITLE || "Codex Harness · 版本发布中心";
const CURRENT_LATEST_TAG = ENV.CURRENT_LATEST_TAG || "";
const DEFAULT_CHANNEL = ENV.DEFAULT_CHANNEL || "stable";
const DATA_DIR = path.resolve(ROOT, ENV.DATA_DIR || "./data");
const PUBLIC_DIR = path.resolve(ROOT, ENV.PUBLIC_DIR || "./public");
const FILES_DIR = path.join(DATA_DIR, "files");
const DB_FILE = path.join(DATA_DIR, "releases.json");
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_MB || "200", 10) * 1024 * 1024;

// ===== 用户反馈区配置 =====
const FEEDBACK_IMAGES_DIR = path.join(DATA_DIR, "feedback-images");
const MAX_FEEDBACK_IMAGES = 6;                    // 单条反馈最多截图张数
const MAX_FEEDBACK_IMG_BYTES = 10 * 1024 * 1024;  // 单张截图 ≤ 10 MB
const MAX_FEEDBACK_BYTES = 64 * 1024 * 1024;      // 单次提交整体上限
const FEEDBACK_STATUSES = ["pending", "in_progress", "resolved", "closed"];
const FEEDBACK_TYPES = ["bug", "suggestion", "question", "other"];
const FEEDBACK_PRIORITIES = ["low", "normal", "high"];
const IMAGE_EXT_WHITELIST = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// ===== COS 对象存储（可选：安装包放 COS 直链下载，绕开服务器公网带宽瓶颈） =====
// .env 配置（全部留空 = 功能关闭，完全走原有服务器下载逻辑）：
//   COS_BUCKET     桶名（不带 -appid 后缀）
//   COS_APPID      账号 APPID（桶全名 = <bucket>-<appid>）
//   COS_REGION     地域，如 ap-shanghai（与服务器同地域上传走内网，不占公网带宽）
//   COS_SECRET_ID / COS_SECRET_KEY   访问密钥（建议子账号、仅 COS 权限）
//   COS_PUBLIC_BASE 可选，默认 https://<bucket>-<appid>.cos.<region>.myqcloud.com
//   COS_UPLOAD_HOST 可选，默认 <bucket>-<appid>.cos-internal.<region>.myqcloud.com（内网）
const COS_ENABLED = !!(ENV.COS_BUCKET && ENV.COS_REGION && ENV.COS_SECRET_ID && ENV.COS_SECRET_KEY);
const COS_BUCKET = ENV.COS_BUCKET || "";
const COS_APPID = ENV.COS_APPID || "";
const COS_REGION = ENV.COS_REGION || "";
const COS_SECRET_ID = ENV.COS_SECRET_ID || "";
const COS_SECRET_KEY = ENV.COS_SECRET_KEY || "";
const COS_FULL_BUCKET = COS_BUCKET + (COS_APPID ? "-" + COS_APPID : "");
const COS_PUBLIC_BASE = (ENV.COS_PUBLIC_BASE || `https://${COS_FULL_BUCKET}.cos.${COS_REGION}.myqcloud.com`).replace(/\/$/, "");
const COS_UPLOAD_HOST = ENV.COS_UPLOAD_HOST || `${COS_FULL_BUCKET}.cos-internal.${COS_REGION}.myqcloud.com`;

// ===== 下载直连通道（可选）：DOWNLOAD_BASE_URL=https://dl.ppz123.asia =====
// 留空 = 下载走本站相对路径（CF 链路）；填了 = downloadUrl 返回该域名的绝对地址（大陆直连，不绕 CF）
const DOWNLOAD_BASE_URL = (ENV.DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(FEEDBACK_IMAGES_DIR, { recursive: true });

// ============== JSON 存储（原子写） ==============
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { nextId: 1, releases: [] };
  }
}
function saveDb(db) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE); // 原子替换
}
let db = loadDb();
// DB 结构兼容：老版本 JSON 只有 releases，补上反馈区字段
db.nextFeedbackId = db.nextFeedbackId || 1;
db.feedbacks = db.feedbacks || [];

// ============== 鉴权（内存 token Map） ==============
const tokens = new Map(); // token -> { user, expiresAt }
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function issueToken(user) {
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { user, expiresAt: Date.now() + TOKEN_TTL_MS });
  // 顺手清理过期 token
  for (const [k, v] of tokens) if (v.expiresAt < Date.now()) tokens.delete(k);
  return token;
}

// ============== 版本比较（语义化版本简化版） ==============
function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/i.exec(String(v).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "" };
}
function compareSemver(a, b) {
  const A = parseSemver(a), B = parseSemver(b);
  if (!A || !B) return 0;
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  if (A.patch !== B.patch) return A.patch - B.patch;
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  return A.pre.localeCompare(B.pre);
}

// ============== 手写 multipart 解析 ==============
// body 是 Buffer（已做大小上限校验），boundary 来自 Content-Type
function parseMultipart(body, boundary) {
  const result = { fields: {}, files: [] };
  const marker = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (pos < body.length) {
    const head = body.indexOf(marker, pos);
    if (head === -1) break;
    let p = head + marker.length;
    // 结束标记 --boundary--\r\n
    if (p + 1 < body.length && body[p] === 0x2d && body[p + 1] === 0x2d) break;
    // 跳过 CRLF
    if (body[p] === 0x0d && body[p + 1] === 0x0a) p += 2;
    else if (body[p] === 0x0a) p += 1;
    // 找头部结束（空行）
    const hdrEnd = body.indexOf(Buffer.from("\r\n\r\n"), p);
    if (hdrEnd === -1) break;
    const headers = body.slice(p, hdrEnd).toString("utf8");
    const dataStart = hdrEnd + 4;
    const next = body.indexOf(marker, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    // 内容末尾的 CRLF 属于分隔符，去掉
    if (dataEnd >= 2 && body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) dataEnd -= 2;
    const content = body.slice(dataStart, dataEnd);

    const nameM = /name="([^"]*)"/.exec(headers);
    const fileM = /filename="([^"]*)"/i.exec(headers);
    if (fileM && nameM) {
      result.files.push({
        field: nameM[1],
        filename: fileM[1] || "file",
        data: content,
      });
    } else if (nameM) {
      result.fields[nameM[1]] = content.toString("utf8");
    }
    pos = next;
  }
  return result;
}

// ============== HTTP 工具 ==============
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error("payload too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function checkAdmin(req) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const meta = m && tokens.get(m[1]);
  if (!meta || meta.expiresAt < Date.now()) {
    if (m) tokens.delete(m[1]);
    return { ok: false, status: 401 };
  }
  if (meta.user !== ADMIN_USER) return { ok: false, status: 403 };
  return { ok: true, user: meta.user };
}

function findRelease(id) {
  return db.releases.find((r) => r.id === id);
}

// ============== COS XML API（手写签名，零依赖） ==============
// 签名算法：https://cloud.tencent.com/document/product/436/7778
function cosSign(method, urlPath, headersToSign) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 900}`;
  const signKey = crypto.createHmac("sha1", COS_SECRET_KEY).update(keyTime).digest("hex");
  const hkeys = Object.keys(headersToSign).map((k) => k.toLowerCase()).sort();
  const hstr = hkeys.map((k) => `${k}=${headersToSign[k]}`).join("&");
  const httpString = `${method.toLowerCase()}\n${urlPath}\n\n${hstr}\n`;
  const sha1Http = crypto.createHash("sha1").update(httpString).digest("hex");
  const stringToSign = `sha1\n${sha1Http}\n${keyTime}\n`;
  const signature = crypto.createHmac("sha1", COS_SECRET_KEY).update(stringToSign).digest("hex");
  return (
    `q-sign-algorithm=sha1&q-ak=${encodeURIComponent(COS_SECRET_ID)}` +
    `&q-sign-time=${encodeURIComponent(keyTime)}&q-key-time=${encodeURIComponent(keyTime)}` +
    `&q-header-list=${hkeys.join(";")}&q-url-param-list=&q-signature=${signature}`
  );
}

/** 把本地文件流式 PUT 到 COS（同地域走内网 host） */
function cosPutFile(localPath, key, size) {
  return new Promise((resolve, reject) => {
    const urlPath = "/" + key.split("/").map(encodeURIComponent).join("/");
    const auth = cosSign("PUT", urlPath, { host: COS_UPLOAD_HOST });
    const req = https.request(
      {
        method: "PUT",
        host: COS_UPLOAD_HOST,
        port: 443,
        path: urlPath,
        headers: { Host: COS_UPLOAD_HOST, "Content-Length": size, Authorization: auth },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`cos_put HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        });
      }
    );
    req.on("error", reject);
    fs.createReadStream(localPath).pipe(req);
  });
}

/** 删除 COS 上的对象（fire-and-forget，失败只打日志） */
function cosDeleteObject(key) {
  return new Promise((resolve, reject) => {
    const urlPath = "/" + key.split("/").map(encodeURIComponent).join("/");
    const auth = cosSign("DELETE", urlPath, { host: COS_UPLOAD_HOST });
    const req = https.request(
      {
        method: "DELETE",
        host: COS_UPLOAD_HOST,
        port: 443,
        path: urlPath,
        headers: { Host: COS_UPLOAD_HOST, Authorization: auth },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`cos_delete HTTP ${res.statusCode}`));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** 把某个 release 的安装包推到 COS，成功后记 cos_key（downloadUrl 即切换为 COS 直链） */
async function cosPushRelease(row) {
  if (!COS_ENABLED || !row) throw new Error("cos_disabled_or_no_row");
  const local = path.join(FILES_DIR, row.stored_name);
  const st = await fs.promises.stat(local);
  const key = `releases/${row.stored_name}`;
  await cosPutFile(local, key, st.size);
  row.cos_key = key;
  saveDb(db);
  return key;
}

/** 统一的 downloadUrl 生成：COS 直链 > 下载直连域名 > 服务器相对路径 */
function releaseDownloadUrl(r) {
  // 外链包（如 macOS 包托管在 GitHub Releases）：直接返回外链，不经本站转发
  if (r.external_url) return r.external_url;
  if (COS_ENABLED && r.cos_key) return `${COS_PUBLIC_BASE}/${r.cos_key}`;
  if (DOWNLOAD_BASE_URL) return `${DOWNLOAD_BASE_URL}/api/releases/${r.id}/download`;
  return `/api/releases/${r.id}/download`;
}

/** 删除 release 时同步清理 COS 对象（异步，不阻塞响应） */
function cosRemoveReleaseQuiet(rel) {
  if (!COS_ENABLED || !rel || !rel.cos_key) return;
  cosDeleteObject(rel.cos_key)
    .then(() => console.log(`[cos] deleted ${rel.cos_key}`))
    .catch((e) => console.error(`[cos] delete failed ${rel.cos_key}:`, e.message));
}

// ============== 反馈区 helper ==============
function findFeedback(id) {
  return db.feedbacks.find((f) => f.id === id);
}

// 序列化反馈：公开版不含内部备注/联系方式/client_id；admin=true 时全量
function serializeFeedback(f, opts = {}) {
  const out = {
    id: f.id,
    type: f.type,
    title: f.title,
    content: f.content,
    client_version: f.client_version || "",
    os: f.os || "",
    status: f.status,
    priority: f.priority,
    images: (f.images || []).map((im) => ({ name: im.name, stored: im.stored, size: im.size, mime: im.mime })),
    events: (f.events || []).map((e) => ({ ...e })),
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
  if (opts.admin) {
    out.contact = f.contact || "";
    out.client_id = f.client_id || "";
    out.admin_note = f.admin_note || "";
  }
  return out;
}

// 图片访问授权：正确 client_id（提交者本人）或有效管理员 token 均可
function feedbackImageAccess(f, searchParams) {
  const cid = (searchParams.get("cid") || "").trim();
  if (f.client_id && cid && cid === f.client_id) return true;
  const t = (searchParams.get("t") || "").trim();
  const meta = t && tokens.get(t);
  if (meta && meta.expiresAt >= Date.now() && meta.user === ADMIN_USER) return true;
  return false;
}

// 管理类路径：版本管理 + 反馈管理（download / releases-public / feedback 提交为公开接口）
function isAdminPath(method, p) {
  return (
    (method === "GET" && p === "/api/releases") ||
    (method === "POST" && p === "/api/releases") ||
    (method === "POST" && p === "/api/releases/batch-delete") ||
    (method === "POST" && /^\/api\/releases\/\d+\/push-cos$/.test(p)) ||
    (method === "DELETE" && /^\/api\/releases\/\d+$/.test(p)) ||
    (method === "PATCH" && /^\/api\/releases\/\d+$/.test(p)) ||
    (method === "GET" && p === "/api/admin/feedback") ||
    (method === "GET" && /^\/api\/admin\/feedback\/\d+$/.test(p)) ||
    (method === "PATCH" && /^\/api\/admin\/feedback\/\d+$/.test(p)) ||
    (method === "POST" && /^\/api\/admin\/feedback\/\d+\/reply$/.test(p)) ||
    (method === "POST" && p === "/api/admin/feedback/batch-delete") ||
    (method === "DELETE" && /^\/api\/admin\/feedback\/\d+$/.test(p))
  );
}

// ============== MIME 表 + 静态文件 ==============
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function serveStatic(req, res, urlPath) {
  // 只允许 public/ 内文件，防路径穿越
  let rel = decodeURIComponent(urlPath);
  if (rel === "/") rel = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) {
    return json(res, 403, { error: "forbidden" });
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: "not_found" });
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(full).pipe(res);
  });
}

// ============== 路由分发 ==============
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = u.pathname;
  const method = req.method;

  // 访问日志
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${method} ${p}`);

  try {
    // ----- 健康检查 -----
    if (method === "GET" && p === "/api/health") {
      return json(res, 200, {
        ok: true,
        site: SITE_TITLE,
        currentTag: CURRENT_LATEST_TAG,
        defaultChannel: DEFAULT_CHANNEL,
        time: Date.now(),
        releases: db.releases.length,
        cos: COS_ENABLED ? "enabled" : "disabled",
      });
    }

    // ----- 公共：检查更新（桌面端调用） -----
    if (method === "GET" && p === "/api/latest") {
      const channel = u.searchParams.get("channel") || DEFAULT_CHANNEL;
      const current = u.searchParams.get("current") || "";
      // 平台过滤：不带 platform 默认 windows（兼容已发布的桌面端，它不会传该参数）
      const platform = (u.searchParams.get("platform") || "windows").trim();
      const rows = db.releases
        .filter((r) => r.channel === channel && (r.platform || "windows") === platform)
        .sort((a, b) => b.uploaded_at - a.uploaded_at || b.id - a.id);
      const row = rows[0];
      if (!row) {
        return json(res, 200, { hasUpdate: false, reason: "no_release", channel });
      }
      const newer = !current || compareSemver(row.version, current) > 0;
      return json(res, 200, {
        hasUpdate: newer,
        reason: !current ? "no_current" : newer ? "newer" : "up_to_date",
        channel,
        version: row.version,
        filename: row.filename,
        size: row.size,
        sha256: row.sha256,
        changelog: row.changelog,
        mandatory: !!row.mandatory,
        uploadedAt: row.uploaded_at,
        downloadUrl: releaseDownloadUrl(row),
      });
    }

    // ----- 公共：release 列表 -----
    if (method === "GET" && p === "/api/releases-public") {
      const list = [...db.releases]
        .sort((a, b) => b.uploaded_at - a.uploaded_at || b.id - a.id)
        .map((r) => ({
          id: r.id,
          version: r.version,
          channel: r.channel,
          platform: r.platform || "windows",
          filename: r.filename,
          size: r.size,
          sha256: r.sha256,
          changelog: r.changelog,
          mandatory: !!r.mandatory,
          uploaded_at: r.uploaded_at,
          downloadUrl: releaseDownloadUrl(r),
        }));
      return json(res, 200, { releases: list });
    }

    // ----- 公共：下载 -----
    if (method === "GET" && /^\/api\/releases\/(\d+)\/download$/.test(p)) {
      const id = parseInt(p.split("/")[3], 10);
      const row = findRelease(id);
      if (!row) return json(res, 404, { error: "not_found" });
      // 外链包（macOS）302 到 GitHub；旧链接/直接访问也能正确跳走
      if (row.external_url) {
        res.writeHead(302, { Location: row.external_url, "Cache-Control": "no-store" });
        return res.end();
      }
      if (!row.stored_name) return json(res, 410, { error: "file_missing" });
      const filePath = path.join(FILES_DIR, row.stored_name);
      fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) return json(res, 410, { error: "file_missing" });
        const safeName = row.filename.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": st.size,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}; filename="${safeName.replace(/"/g, "")}"`,
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(filePath).pipe(res);
      });
      return;
    }

    // ----- 管理员：登录 -----
    if (method === "POST" && p === "/api/auth/login") {
      const body = await readBody(req, 64 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const { user, password } = data || {};
      if (user !== ADMIN_USER || password !== ADMIN_PASSWORD) {
        return json(res, 401, { error: "invalid_credentials" });
      }
      return json(res, 200, { token: issueToken(user), user, ttlMs: TOKEN_TTL_MS });
    }

    // ----- 管理员：列表 / 上传 / 删除 / 改元数据 -----
    // 只对管理类 API 做鉴权（download、releases-public、feedback 提交与查询为公开接口）
    if (isAdminPath(method, p)) {
      const auth = checkAdmin(req);
      if (!auth.ok) {
        return json(res, auth.status, { error: auth.status === 403 ? "forbidden" : "unauthorized" });
      }
      req.adminUser = auth.user;
    }

    if (method === "GET" && p === "/api/releases") {
      const list = [...db.releases]
        .sort((a, b) => b.uploaded_at - a.uploaded_at || b.id - a.id)
        .map((r) => ({ ...r, mandatory: !!r.mandatory, downloadUrl: releaseDownloadUrl(r) }));
      return json(res, 200, { releases: list });
    }

    if (method === "POST" && p === "/api/releases") {
      const ctype = req.headers["content-type"] || "";
      const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
      if (!bm) return json(res, 400, { error: "multipart_required" });
      const boundary = bm[1] || bm[2];
      const body = await readBody(req, MAX_UPLOAD_BYTES).catch((e) => {
        if (e.code === 413) return null;
        throw e;
      });
      if (body === null) return json(res, 413, { error: "file_too_large", limitMb: MAX_UPLOAD_BYTES / 1024 / 1024 });
      const parsed = parseMultipart(body, boundary);
      const file = parsed.files[0];
      if (!file) return json(res, 400, { error: "file_required" });
      const version = (parsed.fields.version || "").trim();
      const channel = (parsed.fields.channel || DEFAULT_CHANNEL).trim();
      const changelog = (parsed.fields.changelog || "").toString();
      const mandatory = parsed.fields.mandatory === "1" || parsed.fields.mandatory === "true";
      if (!version || !parseSemver(version)) {
        return json(res, 400, { error: "invalid_version", got: version });
      }
      const platform = (parsed.fields.platform || "windows").trim() || "windows";
      if (db.releases.some((r) => r.version === version && r.channel === channel && (r.platform || "windows") === platform)) {
        return json(res, 409, { error: "version_exists" });
      }
      const ts = Date.now();
      const rand = crypto.randomBytes(6).toString("hex");
      const safeOrig = file.filename.replace(/[^\w.\-]/g, "_");
      const storedName = `${ts}_${rand}_${safeOrig}`;
      const sha256 = crypto.createHash("sha256").update(file.data).digest("hex");
      fs.writeFileSync(path.join(FILES_DIR, storedName), file.data);
      const id = db.nextId++;
      db.releases.push({
        id,
        version,
        channel,
        platform,
        filename: file.filename,
        stored_name: storedName,
        size: file.data.length,
        sha256,
        changelog,
        mandatory: mandatory ? 1 : 0,
        uploaded_by: req.adminUser || "admin",
        uploaded_at: ts,
      });
      saveDb(db);
      // 上传成功后自动后台推 COS（同地域走内网，不占公网带宽；失败不影响发布，可稍后手动重推）
      if (COS_ENABLED) {
        const row = db.releases.find((x) => x.id === id);
        cosPushRelease(row)
          .then(() => console.log(`[cos] pushed release #${id} -> ${row.cos_key}`))
          .catch((e) => console.error(`[cos] auto-push failed #${id}:`, e.message));
      }
      return json(res, 200, { id, version, channel, size: file.data.length, sha256 });
    }

    if (method === "DELETE" && /^\/api\/releases\/(\d+)$/.test(p)) {
      const id = parseInt(p.split("/")[3], 10);
      const idx = db.releases.findIndex((r) => r.id === id);
      if (idx === -1) return json(res, 404, { error: "not_found" });
      const [removed] = db.releases.splice(idx, 1);
      saveDb(db);
      if (removed.stored_name) {
        const f = path.join(FILES_DIR, removed.stored_name);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      cosRemoveReleaseQuiet(removed);
      return json(res, 200, { ok: true });
    }

    // ----- 管理员：批量删除 release（连带物理删除安装包文件） -----
    if (method === "POST" && p === "/api/releases/batch-delete") {
      const body = await readBody(req, 256 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const ids = Array.isArray(data.ids)
        ? data.ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
        : [];
      if (!ids.length) return json(res, 400, { error: "ids_required" });
      let removed = 0;
      for (const id of ids) {
        const idx = db.releases.findIndex((r) => r.id === id);
        if (idx === -1) continue;
        const [rel] = db.releases.splice(idx, 1);
        const f = path.join(FILES_DIR, rel.stored_name);
        if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* 忽略单文件删除失败 */ } }
        cosRemoveReleaseQuiet(rel);
        removed++;
      }
      saveDb(db);
      console.log(`[releases] batch-delete removed=${removed}`);
      return json(res, 200, { ok: true, removed });
    }

    // ----- 管理员：手动（重）推送某个 release 的安装包到 COS -----
    if (method === "POST" && /^\/api\/releases\/(\d+)\/push-cos$/.test(p)) {
      if (!COS_ENABLED) return json(res, 503, { error: "cos_disabled" });
      const id = parseInt(p.split("/")[3], 10);
      const row = findRelease(id);
      if (!row) return json(res, 404, { error: "not_found" });
      try {
        await cosPushRelease(row);
        return json(res, 200, { ok: true, id, cosUrl: releaseDownloadUrl(row) });
      } catch (e) {
        return json(res, 502, { error: "cos_push_failed", message: e.message });
      }
    }

    if (method === "PATCH" && /^\/api\/releases\/(\d+)$/.test(p)) {
      const id = parseInt(p.split("/")[3], 10);
      const row = findRelease(id);
      if (!row) return json(res, 404, { error: "not_found" });
      const body = await readBody(req, 256 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const { changelog, mandatory } = data || {};
      if (changelog !== undefined) row.changelog = String(changelog);
      if (mandatory !== undefined) row.mandatory = mandatory ? 1 : 0;
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    // ================== 用户反馈区 ==================
    // ----- 公开：提交反馈（multipart：字段 + 多张 images 截图） -----
    if (method === "POST" && p === "/api/feedback") {
      const ctype = req.headers["content-type"] || "";
      const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
      if (!bm) return json(res, 400, { error: "multipart_required" });
      const boundary = bm[1] || bm[2];
      const body = await readBody(req, MAX_FEEDBACK_BYTES).catch((e) => {
        if (e.code === 413) return null;
        throw e;
      });
      if (body === null) {
        return json(res, 413, { error: "payload_too_large", limitMb: MAX_FEEDBACK_BYTES / 1024 / 1024 });
      }
      const parsed = parseMultipart(body, boundary);
      const type = (parsed.fields.type || "bug").trim();
      const title = (parsed.fields.title || "").toString().trim();
      const content = (parsed.fields.content || "").toString().trim();
      const contact = (parsed.fields.contact || "").toString().trim().slice(0, 200);
      const clientId = (parsed.fields.client_id || "").toString().trim().slice(0, 64);
      const clientVersion = (parsed.fields.client_version || "").toString().trim().slice(0, 40);
      const os = (parsed.fields.os || "").toString().trim().slice(0, 80);
      if (!FEEDBACK_TYPES.includes(type)) return json(res, 400, { error: "invalid_type", got: type });
      if (!title) return json(res, 400, { error: "title_required" });
      if (!content) return json(res, 400, { error: "content_required" });
      if (content.length > 4000) return json(res, 400, { error: "content_too_long", limit: 4000 });
      const files = (parsed.files || []).filter((f) => f.field === "images");
      if (files.length > MAX_FEEDBACK_IMAGES) {
        return json(res, 400, { error: "too_many_images", limit: MAX_FEEDBACK_IMAGES });
      }
      const images = [];
      for (const f of files) {
        const ext = path.extname(f.filename).toLowerCase();
        if (!IMAGE_EXT_WHITELIST.has(ext)) {
          return json(res, 400, { error: "bad_image_type", got: f.filename });
        }
        if (f.data.length > MAX_FEEDBACK_IMG_BYTES) {
          return json(res, 400, { error: "image_too_large", limitMb: MAX_FEEDBACK_IMG_BYTES / 1024 / 1024 });
        }
        const ts = Date.now();
        const rand = crypto.randomBytes(6).toString("hex");
        const stored = `fb_${ts}_${rand}${ext}`;
        fs.writeFileSync(path.join(FEEDBACK_IMAGES_DIR, stored), f.data);
        images.push({ name: f.filename, stored, size: f.data.length, mime: ext.slice(1) });
      }
      const id = db.nextFeedbackId++;
      const at = Date.now();
      db.feedbacks.push({
        id, type, title, content,
        contact, client_id: clientId || null,
        client_version: clientVersion, os,
        status: "pending", priority: "normal",
        admin_note: "",
        images,
        events: [],
        created_at: at, updated_at: at,
      });
      saveDb(db);
      console.log(`[feedback] #${id} ${type} "${title}" images=${images.length}`);
      return json(res, 200, { ok: true, id, feedback: serializeFeedback(db.feedbacks[db.feedbacks.length - 1]) });
    }

    // ----- 公开：按 client_id 查「我的反馈」 -----
    if (method === "GET" && p === "/api/feedback") {
      const cid = (u.searchParams.get("client_id") || "").trim();
      if (!cid) return json(res, 200, { feedbacks: [] });
      const list = db.feedbacks
        .filter((f) => f.client_id === cid)
        .sort((a, b) => b.created_at - a.created_at)
        .map(serializeFeedback);
      return json(res, 200, { feedbacks: list });
    }

    // ----- 公开：用户给自己的反馈追加留言（需匹配 client_id） -----
    if (method === "POST" && /^\/api\/feedback\/(\d+)\/comment$/.test(p)) {
      const id = parseInt(p.split("/")[3], 10);
      const fb = findFeedback(id);
      if (!fb) return json(res, 404, { error: "not_found" });
      const body = await readBody(req, 256 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const cid = ((data && data.client_id) || "").trim();
      const content = ((data && data.content) || "").toString().trim();
      if (!cid || !fb.client_id || cid !== fb.client_id) {
        return json(res, 403, { error: "forbidden" });
      }
      if (!content || content.length > 2000) {
        return json(res, 400, { error: "content_invalid", limit: 2000 });
      }
      fb.events.push({ kind: "comment", by: "user", content, at: Date.now() });
      fb.updated_at = Date.now();
      saveDb(db);
      return json(res, 200, { ok: true, feedback: serializeFeedback(fb) });
    }

    // ----- 图片访问（截图）: ?cid=<client_id> 或 ?t=<admin token> -----
    if (method === "GET" && /^\/api\/feedback\/images\/[^/]+$/.test(p)) {
      const stored = p.split("/")[4];
      const fb = db.feedbacks.find((f) => (f.images || []).some((im) => im.stored === stored));
      if (!fb) return json(res, 404, { error: "not_found" });
      if (!feedbackImageAccess(fb, u.searchParams)) return json(res, 403, { error: "forbidden" });
      const filePath = path.join(FEEDBACK_IMAGES_DIR, stored);
      fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) return json(res, 410, { error: "file_missing" });
        const ext = path.extname(stored).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": st.size,
          "Cache-Control": "private, max-age=3600",
        });
        fs.createReadStream(filePath).pipe(res);
      });
      return;
    }

    // ----- 管理员：反馈列表（含统计 + 筛选 + 搜索） -----
    if (method === "GET" && p === "/api/admin/feedback") {
      const status = (u.searchParams.get("status") || "").trim();
      const type = (u.searchParams.get("type") || "").trim();
      const q = (u.searchParams.get("q") || "").trim().toLowerCase();
      let list = [...db.feedbacks].sort((a, b) => b.created_at - a.created_at);
      if (status && FEEDBACK_STATUSES.includes(status)) list = list.filter((f) => f.status === status);
      if (type && FEEDBACK_TYPES.includes(type)) list = list.filter((f) => f.type === type);
      if (q) {
        list = list.filter((f) =>
          [String(f.id), f.title, f.content, f.contact, f.client_version, f.os]
            .join(" ").toLowerCase().includes(q)
        );
      }
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const count = (s) => db.feedbacks.filter((f) => f.status === s).length;
      return json(res, 200, {
        stats: {
          all: db.feedbacks.length,
          pending: count("pending"),
          in_progress: count("in_progress"),
          resolved: count("resolved"),
          closed: count("closed"),
          today: db.feedbacks.filter((f) => f.created_at >= dayStart.getTime()).length,
        },
        feedbacks: list.map((f) => serializeFeedback(f, { admin: true })),
      });
    }

    // ----- 管理员：详情 -----
    if (method === "GET" && /^\/api\/admin\/feedback\/(\d+)$/.test(p)) {
      const id = parseInt(p.split("/")[4], 10);
      const fb = findFeedback(id);
      if (!fb) return json(res, 404, { error: "not_found" });
      return json(res, 200, { feedback: serializeFeedback(fb, { admin: true }) });
    }

    // ----- 管理员：状态 / 优先级 / 内部备注 -----
    if (method === "PATCH" && /^\/api\/admin\/feedback\/(\d+)$/.test(p)) {
      const id = parseInt(p.split("/")[4], 10);
      const fb = findFeedback(id);
      if (!fb) return json(res, 404, { error: "not_found" });
      const body = await readBody(req, 512 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const { status, priority, admin_note } = data || {};
      const at = Date.now();
      if (status !== undefined) {
        if (!FEEDBACK_STATUSES.includes(status)) return json(res, 400, { error: "invalid_status" });
        if (status !== fb.status) {
          fb.events.push({ kind: "status", by: "admin", from: fb.status, to: status, at });
          fb.status = status;
        }
      }
      if (priority !== undefined) {
        if (!FEEDBACK_PRIORITIES.includes(priority)) return json(res, 400, { error: "invalid_priority" });
        fb.priority = priority;
      }
      if (admin_note !== undefined) fb.admin_note = String(admin_note).slice(0, 2000);
      fb.updated_at = at;
      saveDb(db);
      return json(res, 200, { ok: true, feedback: serializeFeedback(fb, { admin: true }) });
    }

    // ----- 管理员：回复（进入 timeline，用户端可见） -----
    if (method === "POST" && /^\/api\/admin\/feedback\/(\d+)\/reply$/.test(p)) {
      const id = parseInt(p.split("/")[4], 10);
      const fb = findFeedback(id);
      if (!fb) return json(res, 404, { error: "not_found" });
      const body = await readBody(req, 512 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const content = ((data && data.content) || "").toString().trim();
      if (!content || content.length > 2000) {
        return json(res, 400, { error: "content_invalid", limit: 2000 });
      }
      const at = Date.now();
      fb.events.push({ kind: "reply", by: req.adminUser || "admin", content, at });
      fb.updated_at = at;
      saveDb(db);
      return json(res, 200, { ok: true, feedback: serializeFeedback(fb, { admin: true }) });
    }

    // ----- 管理员：删除反馈（连带删除截图文件） -----
    if (method === "DELETE" && /^\/api\/admin\/feedback\/(\d+)$/.test(p)) {
      const id = parseInt(p.split("/")[4], 10);
      const idx = db.feedbacks.findIndex((f) => f.id === id);
      if (idx === -1) return json(res, 404, { error: "not_found" });
      const [removed] = db.feedbacks.splice(idx, 1);
      saveDb(db);
      for (const im of removed.images || []) {
        const f = path.join(FEEDBACK_IMAGES_DIR, im.stored);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      console.log(`[feedback] #${id} deleted (${(removed.images || []).length} images removed)`);
      return json(res, 200, { ok: true });
    }

    // ----- 管理员：批量删除反馈（连带删除截图文件） -----
    if (method === "POST" && p === "/api/admin/feedback/batch-delete") {
      const body = await readBody(req, 512 * 1024);
      let data = {};
      try { data = JSON.parse(body.toString("utf8")); } catch { /* 空 body */ }
      const ids = Array.isArray(data.ids)
        ? data.ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
        : [];
      const all = data.all === true;
      if (!all && !ids.length) return json(res, 400, { error: "ids_required" });
      const targets = all ? db.feedbacks : db.feedbacks.filter((f) => ids.includes(f.id));
      if (!targets.length) return json(res, 200, { ok: true, removed: 0, images: 0 });
      let removedImages = 0;
      for (const fb of targets) {
        for (const im of fb.images || []) {
          const f = path.join(FEEDBACK_IMAGES_DIR, im.stored);
          if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* 忽略单文件删除失败 */ } removedImages++; }
        }
      }
      if (all) db.feedbacks = [];
      else db.feedbacks = db.feedbacks.filter((f) => !ids.includes(f.id));
      saveDb(db);
      console.log(`[feedback] batch-delete removed=${targets.length} images=${removedImages}`);
      return json(res, 200, { ok: true, removed: targets.length, images: removedImages });
    }

    // ----- 静态资源 + 首页 -----
    if (method === "GET") {
      return serveStatic(req, res, p);
    }

    return json(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) return json(res, 500, { error: "internal_error", message: err.message });
    res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[server] ${SITE_TITLE}`);
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] admin: ${ADMIN_USER} / (密码见 .env)`);
  console.log(`[server] data: ${DB_FILE}`);
  console.log(`[server] files: ${FILES_DIR}  (上限 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  console.log(`[server] cos: ${COS_ENABLED ? `enabled (${COS_FULL_BUCKET} @ ${COS_REGION}, 内网上传 ${COS_UPLOAD_HOST})` : "disabled (.env 里配 COS_* 即启用)"}`);
});
