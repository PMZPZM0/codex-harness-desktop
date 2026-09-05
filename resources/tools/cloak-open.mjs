// CloakBrowser 常驻助手：由主进程 spawn，从 stdin 逐行读取 URL，
// 在指纹浏览器（headed, humanize）窗口中打开或导航，状态以 JSON 行回传 stdout。
import { pathToFileURL } from "node:url";
import path from "node:path";
import readline from "node:readline";

const npmRoot = process.env.CLOAK_NPM_ROOT || "";
const entry = path.join(npmRoot, "cloakbrowser", "dist", "index.js");

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

let mod = null;
try {
  mod = await import(pathToFileURL(entry).href);
} catch (error) {
  emit({ event: "error", message: `cloakbrowser 模块加载失败：${error.message}` });
  process.exit(1);
}

let browser = null;
let page = null;

async function ensureBrowser() {
  if (browser) return;
  emit({ event: "launching" });
  browser = await mod.launch({ headless: false, humanize: true });
  browser.on("disconnected", () => {
    browser = null;
    page = null;
    emit({ event: "closed" });
  });
  emit({ event: "ready" });
}

async function openUrl(rawUrl) {
  await ensureBrowser();
  if (!page || page.isClosed()) page = await browser.newPage();
  try {
    await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    emit({ event: "nav-error", message: String(error && error.message ? error.message : error), url: rawUrl });
    return;
  }
  const title = await page.title().catch(() => "");
  emit({ event: "opened", url: rawUrl, title });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const url = line.trim();
  if (!url) return;
  openUrl(url).catch((error) => {
    emit({ event: "error", message: String(error && error.message ? error.message : error), url });
  });
});

emit({ event: "boot" });
