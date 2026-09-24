/**
 * builtin-skills-ipc 的「builtin-images」部分（09-22 从同目录 builtin-skills-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { app, dialog, ipcMain } from "electron";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cloakCacheDir, npmGlobalRoot, nuphusBinary, toolsRoot } from "../../toolchain";
import { applyCustomModel, builtinPluginsFile, describeNetworkError, dirEntries, readBuiltinPlugins, readCustomModel, refreshSkillDiscipline, skillsRegistryFile, userSkillsDir } from "../../main";
import { codexHome, mainWindow, server } from "../../runtime-refs";
import type { BuiltinPluginConfig } from "../../main";
async function writeBuiltinPlugins(cfg: BuiltinPluginConfig) {
  await fs.writeFile(builtinPluginsFile, JSON.stringify(cfg, null, 2), "utf8");
}

async function probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const url = base + "/models";
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: "Bearer " + (input.apiKey || ""), "Content-Type": "application/json" } });
  } catch (error) {
    throw describeNetworkError(error, "检测");
  }
  if (!response.ok) throw new Error("模型列表请求失败 HTTP " + response.status + (response.status === 401 ? "（密钥无效）" : response.status === 404 ? "（地址可能缺少 /v1）" : ""));
  const data = await response.json();
  const models = (Array.isArray(data) ? data : data.data ?? data.models ?? []).map((x: any) => typeof x === "string" ? x : x?.id ?? x?.model).filter(Boolean);
  return { models: [...new Set<string>(models)] };
}

async function persistGeneratedImage(url: string): Promise<string> {
  try {
    const dir = path.join(app.getPath("userData"), "images");
    await fs.mkdir(dir, { recursive: true });
    const head = url.slice(0, 64);
    const ext = /jpe?g/i.test(head) ? ".jpg" : /webp/i.test(head) ? ".webp" : /gif/i.test(head) ? ".gif" : ".png";
    const file = path.join(dir, `codex-harness-${Date.now()}${ext}`);
    if (/^data:/i.test(url)) {
      await fs.writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    } else if (/^https?:/i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    } else {
      return "";
    }
    return existsSync(file) ? file : "";
  } catch (error) {
    // 落盘失败不该让生图整体失败 —— 调用方会退回「只给托管 url」，只是图不再持久
    console.warn(`[generate-image] 图片落盘失败：${(error as Error)?.message ?? error}`);
    return "";
  }
}

async function generateImageWith(input: { baseUrl: string; apiKey: string; model: string; prompt: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  // 兼容 /images/generations（OpenAI 兼容）与 /v1/images/generations
  const endpoint = /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, n: 1 }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw describeNetworkError(error, "生图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("生图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  const item = data?.data?.[0];
  // 注意优先级：url 存在用 url；否则 b64_json 转 data URL（旧写法运算符优先级有误，
  // 返回 url 时会拼出 "data:image/png;base64,undefined"，已修）
  const url = item?.url || (item?.b64_json ? "data:image/png;base64," + item.b64_json : "");
  if (typeof url !== "string" || !url.trim()) throw new Error("生图服务未返回图片地址或图片数据");
  // ⛔ 回给渲染层的是**本地路径**，不是 data URL（理由见 persistGeneratedImage 注释：
  //   内联 base64 会被拼进工具返回文本 ⇒ 3 MB 文本进对话历史且每轮重发）。
  //   只有网关给的是真托管地址时才把 url 一并带出（它很短，且能直接当可点击链接用）。
  const path = await persistGeneratedImage(url);
  return { path, url: /^https?:/i.test(url) ? url : "" };
}

async function toImageSource(ref: string): Promise<string> {
  const source = String(ref ?? "").trim();
  if (/^(https?:|data:)/i.test(source)) return source;
  const candidate = path.isAbsolute(source) ? source : path.resolve(source);
  if (!existsSync(candidate)) throw new Error("图片本地文件不存在：" + candidate);
  const mime = /\.jpe?g$/i.test(candidate) ? "image/jpeg" : /\.gif$/i.test(candidate) ? "image/gif" : /\.webp$/i.test(candidate) ? "image/webp" : "image/png";
  return `data:${mime};base64,` + (await fs.readFile(candidate)).toString("base64");
}

async function describeImageWith(input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  const content = [
    { type: "text", text: input.prompt || "请详细描述这张图片的内容，包括画面主体、场景、文字、布局等，用中文回答。" },
    { type: "image_url", image_url: { url: await toImageSource(input.imageUrl) } },
  ];
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: [{ role: "user", content }] }),
    });
  } catch (error) {
    throw describeNetworkError(error, "识图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("识图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  return { text: data?.choices?.[0]?.message?.content ?? "" };
}

ipcMain.handle("builtin:read", async () => readBuiltinPlugins());

ipcMain.handle("builtin:save", async (_e, cfg: BuiltinPluginConfig) => {
  await writeBuiltinPlugins(cfg);
  // 保存后重写 config.toml 并重启引擎：developer_instructions 的生图/视觉段与
  // dynamicTools 都依赖这份配置，不重启的话引擎和已有会话感知不到配置变化。
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else await server.restart();
  return readBuiltinPlugins();
});

ipcMain.handle("builtin:probe", async (_e, input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => probeBuiltinModels(input));

ipcMain.handle("builtin:generate-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; prompt: string }) => generateImageWith(input));

ipcMain.handle("builtin:describe-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => describeImageWith(input));

ipcMain.handle("plugin:validate", async (_event, input: { path?: string }) => {
  const root = input?.path ? String(input.path) : "";
  if (!root) return { ok: false, root: "", issues: ["未提供插件目录路径"], inventory: {} };
  if (!existsSync(root)) return { ok: false, root, issues: [`目录不存在：${root}`], inventory: {} };
  const manifestCandidates = [".codex-plugin/plugin.json", "plugin.json", ".codebuddy-plugin/plugin.json"];
  const manifestPath = manifestCandidates.map((rel) => path.join(root, rel)).find((full) => existsSync(full)) ?? "";
  const issues: string[] = [];
  let manifest: any = null;
  if (manifestPath) {
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (error: any) { issues.push(`清单解析失败：${manifestPath} — ${error.message}`); }
  } else {
    issues.push("缺少插件清单（.codex-plugin/plugin.json 或 plugin.json）");
  }
  if (manifest && !manifest.name) issues.push("清单缺少 name 字段");
  const count = (rel: string) => dirEntries(path.join(root, rel))?.length ?? 0;
  const inventory = { skills: count("skills"), commands: count("commands"), agents: count("agents"), hooks: existsSync(path.join(root, "hooks", "hooks.json")) ? 1 : 0 };
  if (!inventory.skills && !inventory.commands && !inventory.agents && !inventory.hooks) issues.push("插件没有任何能力目录（skills / commands / agents / hooks）");
  return { ok: issues.length === 0, root, manifestPath, issues, inventory, name: manifest?.name ?? "" };
});

ipcMain.handle("tools:status", () => {
  const readVersion = (pkgDir: string) => {
    try { return JSON.parse(readFileSync(pkgDir, "utf8")).version as string; }
    catch { return ""; }
  };
  const root = toolsRoot();
  const modules = npmGlobalRoot();
  const nuphusBin = nuphusBinary();
  // CloakBrowser 内核优先查应用内置缓存，兼容旧的用户目录缓存
  const cloakDirs = [cloakCacheDir(), path.join(os.homedir(), ".cloakbrowser")].filter(Boolean);
  let cloakBinary = false;
  for (const dir of cloakDirs) {
    try { if (readdirSync(dir).some((entry) => entry.includes("chromium"))) { cloakBinary = true; break; } } catch { /* 未下载 */ }
  }
  return [
    {
      id: "nuphus-mcp", name: "Nuphus 桌面自动化", scope: "computer",
      version: modules ? readVersion(path.join(modules, "@nuphus", "nuphus-mcp", "package.json")) : "",
      installed: Boolean(nuphusBin), binaryReady: Boolean(nuphusBin),
      detail: nuphusBin ? "35 个桌面/浏览器自动化工具就绪（屏幕、窗口、键鼠、剪贴板、OCR、Chrome CDP），经 nuphus-call 按需调用，不占模型上下文" : "未安装：到「开发工具」页对「Nuphus 桌面自动化」点一次「修复安装」",
      command: nuphusBin,
    },
    {
      id: "playwright-cli", name: "Playwright 浏览器自动化", scope: "browser",
      version: modules ? readVersion(path.join(modules, "@playwright", "cli", "package.json")) : "",
      installed: modules ? existsSync(path.join(modules, "@playwright", "cli", "package.json")) : false,
      binaryReady: existsSync(path.join(root, "pw-browsers")) && readdirSync(path.join(root, "pw-browsers")).some((entry) => entry.startsWith("chromium-")),
      detail: "命令行浏览器自动化：open / snapshot / click / type / screenshot；默认浏览器通道，内核可在「开发工具」页下载（国内镜像）",
      command: "playwright-cli",
    },
    {
      id: "cloakbrowser", name: "CloakBrowser 指纹浏览器", scope: "browser",
      version: modules ? readVersion(path.join(modules, "cloakbrowser", "package.json")) : "",
      installed: modules ? existsSync(path.join(modules, "cloakbrowser", "package.json")) : false,
      binaryReady: cloakBinary,
      // 三态（09-16 起 CloakBrowser 不随包，默认浏览器是内置视图 / playwright-cli）：
      // 未装包 → 提示可按需下载；装了包没内核 → 提示点内核卡片下载；都在 → 就绪。
      detail: !(modules && existsSync(path.join(modules, "cloakbrowser", "package.json")))
        ? "未安装（按需使用：需要过反爬站点时再到「开发工具」页下载，约 4 MB）"
        : cloakBinary
          ? "反检测 Chromium 内核已就绪（tools/cloak-cache）"
          : "npm 包已装，Chromium 内核未下载（「开发工具」页点「Cloak 指纹浏览器内核」下载）",
      command: "cloakbrowser",
    },
  ];
});
