/**
 * 壁纸域 · 主进程通道（10-03）。
 *
 * 提供四个动作：
 *   · `wallpaper:list`   列出可用壁纸（自带素材 + 此前选过的本地图）
 *   · `wallpaper:pick`   「浏览…」= 系统对话框选图
 *   · `wallpaper:verify` 校验并登记一个**手动填写**的本地路径（"指定路径"）
 *   · `wallpaper:forget` 从「最近使用」里移除一条引用（⛔ 不动用户磁盘原图）
 *
 * ⛔⛔ 安全边界（为什么不放开任意路径）：
 *   `harness-image://` 协议收敛到 `isInsideTrustedRoots`（userData + 各会话工作目录
 *   + **用户亲手用系统对话框选过的路径及其所在目录**）。所以：
 *     · 系统对话框选的图 → `dialog:images` 已 `trustPicked` ⇒ 可直接引用，**不必复制**；
 *     · **手打**的路径 → 没进可信根 ⇒ 这里必须校验 + `trustPicked` 登记，
 *       否则渲染层拿到的是一张 403 破图（且协议层不报错，最难查的一类）。
 *   ⛔ 不把 `harness-image` 的可信根整体放宽 —— 那是安全回归（红线，见 boot.ts 注释）。
 *
 * ⛔ 为什么"删除文件"不做：壁纸引用的是**用户原图**，删它等于删用户的文件。
 *   只提供"从列表移除"（删本应用记住的引用）。
 *
 * ⛔ app.getPath 一律在函数体内取（不在模块顶层）：`app.setPath("userData", …)` 是
 *   main.ts 的模块体语句，被 import 的模块顶层求值会早于它 ⇒ 拿到默认目录（记忆里的坑）。
 */
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { app, dialog, ipcMain } from "electron";
import { createHash } from "node:crypto";
import { isInsideTrustedRoots, mainWindow, trustPicked } from "../runtime-refs";

/** 自带素材目录：public/visual 被 vite 拷进 dist/visual。
 *  ⛔ 绝不能放 resources/ 下 —— 那里只有列进 extraResources 的才进包 ⇒ 安装版 404。 */
const bundledDir = () => path.join(app.getAppPath(), "dist", "visual");

/** 自带素材白名单（⛔ 不"列目录再全量放行"，那等于把 dist 下任何文件都变成可当壁纸）。 */
const BUNDLED_FILES: Record<string, string> = {
  "wall-aurora.jpg": "极光",
  "wall-grid.jpg": "网格",
  "wall-orbit.jpg": "光轨",
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const EXT_FILTER = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

export interface RecentEntry { id: string; filePath: string; label: string }

/** 本地选过的图记在 userData 下（跟着安装走，不污染项目仓库）。 */
const recentFile = () => path.join(app.getPath("userData"), "wallpapers.json");

function readRecent(): RecentEntry[] {
  try {
    const raw = JSON.parse(readFileSync(recentFile(), "utf8"));
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.filePath === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(list: RecentEntry[]) {
  const dir = app.getPath("userData"); // ⛔ 惰性：必须在函数体内取（【91】模块顶层求值会早于 app.setPath）
  mkdirSync(dir, { recursive: true });
  writeFileSync(recentFile(), JSON.stringify(list.slice(0, 20), null, 2), "utf8");
}

/** 路径 → 稳定 id（按解析后的绝对路径 hash，避免同名不同图撞号）。 */
const idOf = (filePath: string) => "local-" + createHash("sha1").update(path.resolve(filePath)).digest("hex").slice(0, 12);

/** 登记一条「最近使用」并返回该条目（去重后置顶）。 */
function remember(filePath: string): RecentEntry {
  const resolved = path.resolve(filePath);
  const entry: RecentEntry = { id: idOf(resolved), filePath: resolved, label: path.basename(resolved) };
  writeRecent([entry, ...readRecent().filter((x) => x.filePath !== resolved)]);
  return entry;
}

ipcMain.handle("wallpaper:list", async () => {
  const dir = bundledDir();
  const out: { id: string; bundled?: string; filePath?: string; label: string }[] = [];
  for (const [file, label] of Object.entries(BUNDLED_FILES)) {
    if (existsSync(path.join(dir, file))) out.push({ id: "bundled:" + file, bundled: file, label });
  }
  for (const entry of readRecent()) {
    // ⛔ 文件被用户挪走/删了 ⇒ 从列表剔除（否则选中它只会得到一张破图）
    if (existsSync(entry.filePath)) out.push({ id: entry.id, filePath: entry.filePath, label: entry.label });
  }
  return out;
});

ipcMain.handle("wallpaper:pick", async () => {
  const win = mainWindow;
  if (!win) return { ok: false, reason: "主窗口未就绪" };
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: EXT_FILTER }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, wallpaper: remember(result.filePaths[0]) };
});

ipcMain.handle("wallpaper:verify", async (_event, filePath: string) => {
  const raw = String(filePath ?? "").trim();
  if (!raw) return { ok: false, reason: "路径为空" };
  if (!path.isAbsolute(raw)) return { ok: false, reason: "请填写绝对路径（如 D:\\Pictures\\a.jpg）" };
  if (!IMAGE_EXT.test(raw)) return { ok: false, reason: "不支持的类型（可用 png / jpg / webp / gif / bmp / avif）" };
  if (!existsSync(raw)) return { ok: false, reason: "文件不存在" };
  const resolved = path.resolve(raw);
  // ⛔ 手动填路径的唯一合法化动作 = 登记进可信根（不放宽协议的可信根集合本身）
  if (!isInsideTrustedRoots(resolved)) trustPicked([resolved]);
  if (!isInsideTrustedRoots(resolved)) return { ok: false, reason: "该路径不在允许访问的范围内" };
  return { ok: true, wallpaper: remember(resolved) };
});

ipcMain.handle("wallpaper:forget", async (_event, id: string) => {
  const list = readRecent();
  const next = list.filter((x) => x.id !== String(id));
  writeRecent(next);
  return { ok: true, removed: list.length - next.length };
});
