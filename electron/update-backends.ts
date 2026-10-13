/**
 * update-backends —— 各组件「怎么检测最新版、怎么拉新」的**执行层**。
 *
 * 与 update-registry 的分工（别混）：
 *   · registry 答「有什么、从哪儿来」（静态清单 + 镜像顺序）；
 *   · 本文件答「具体怎么做」（调谁、怎么包快照、怎么报告结果）。
 *
 * ⛔⛔ **不重写任何安装逻辑**——全部复用各域既有的安装/检查函数：
 *     引擎 → engine-ipc 的 checkEngineUpdateInfo / performEngineUpdateFlow
 *     工具 → runtime-ipc 的 checkRuntimeUpdateRow / performRuntimeUpdate
 *     技能 → skills-ipc 的 checkSkillUpdateRows / updateSkillFolder
 *     市场插件 → codex-market 的 checkMarketPluginUpdates / installCodexMarketPlugin
 *     官方插件 → codex-official-market 的 checkOfficialPluginUpdates / installOfficialMarketPlugin
 *     专家包 → skillhub-packages 的 installSkillHubSkillset
 *     人格包 → skillhub-souls 的 applySkillHubSoul
 *   重写一遍 = 两套安装路径，迟早出现「面板装完引擎不认领」这类只对一半的 bug。
 *
 * ⛔ **结果口径统一**：每一行都有 before/after/action。action 只有四种 ——
 *     updated（真变了）/ unchanged（幂等：内容一致没动手）/ failed（失败+已回滚）/ skipped（不支持或未安装）。
 *   界面与通知按这个字段说话，不再各自解析一片错误信息。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { extractTarGz } from "./update-tar";
import { checkEngineUpdateInfo, performEngineUpdateFlow } from "./features/engine-ipc";
import { checkRuntimeUpdateRow, performRuntimeUpdate, updateableToolIds } from "./features/runtime-ipc";
import { checkSkillUpdateRows, updateSkillFolder } from "./features/skills-ipc";
import { checkMarketPluginUpdates, codexMarketDir, findMarketPlugin, installCodexMarketPlugin } from "./codex-market";
import { checkOfficialPluginUpdates, codexOfficialMarketDir, findOfficialMarketPlugin, installOfficialMarketPlugin } from "./codex-official-market";
import { installSkillHubSkillset } from "./skillhub-packages";
import { applySkillHubSoul, currentSkillHubSoul } from "./skillhub-souls";
import { PONYTAIL_VERSION, listInstalledPonytailVersions } from "./ponytail-plugin";
import { compareVersions } from "./updates";
import { mirrorOrder, withPrefix, type ComponentSpec, type DownloadSourceSetting } from "./update-registry";
import { dirFingerprint, withRollback } from "./update-safety";
import { bundledPython } from "./toolchain";
import { PIP_COMMON_ARGS } from "./features/pip-sources";
import { userSkillsDir } from "./main";

export type UpdateAction = "updated" | "unchanged" | "failed" | "skipped";

export type ComponentRow = {
  /** 行 id：静态=spec.id；动态=`<spec.id>/<slug>` */
  id: string;
  /** 所属 spec.id（后台调度按它查开关） */
  specId: string;
  label: string;
  group: string;
  pkg: string;
  mirror: boolean;
  reason: string;
  installed: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  /** 后台自动更新开关的**生效值**（主进程 readAutoUpdateRowSwitch 算的，界面不自己定默认值） */
  enabled: boolean;
  /** 能否在不下载的前提下判定"有没有新版"（有些源只给内容、不给版本号） */
  detectable: boolean;
  /** 不支持更新的原因（mirror=false 或者成套随包） */
  unsupported: string;
  error: string;
};

export type UpdateOutcome = {
  id: string;
  label: string;
  action: UpdateAction;
  before: string;
  after: string;
  message: string;
};

export type UpdateContext = {
  userData: string;
  codexHome: string;
  source: DownloadSourceSetting;
  /** 这一行的后台自动更新开关是否开着 —— 唯一判据在主进程，这里只是取值 */
  enabledOf: (rowId: string) => boolean;
  /** 进度回调（推给界面的 runtime:progress） */
  progress: (id: string, message: string, percent?: number) => void;
};

/* ── 通用小工具 ─────────────────────────────────────────────────────── */

async function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; out: string }> {
  const runAsync = promisify(execFile) as
    (file: string, args: string[], opts: Record<string, unknown>) => Promise<{ stdout?: string; stderr?: string }>;
  try {
    const { stdout, stderr } = await runAsync(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, out: `${stdout ?? ""}${stderr ?? ""}`.trim() };
  } catch (error: any) {
    return { code: typeof error?.code === "number" ? error.code : -1, out: `${error?.stdout ?? ""}${error?.stderr ?? error?.message ?? ""}`.trim() };
  }
}

/** 逐个候选源试 GET，返回第一个成功的 JSON。 */
async function fetchJsonThroughMirrors(urls: string[]): Promise<any> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      clearTimeout(timer);
      if (!response.ok) { errors.push(`${url} → HTTP ${response.status}`); continue; }
      return await response.json();
    } catch (error) {
      errors.push(`${url} → ${(error as Error)?.message ?? error}`);
    }
  }
  throw new Error(`全部源都取不到（${errors.join("；")}）`);
}

/* ── pip 组的版本查询（走国内索引，逐个源换） ─────────────────────────── */

/** 已装 pip 包版本（python -c 读 importlib.metadata，装了不一定有 pip 元数据的场景也认）。 */
async function pipInstalledVersion(pkg: string): Promise<string> {
  const python = bundledPython();
  if (!python) return "";
  const { code, out } = await run(python, ["-c", `import importlib.metadata as m;print(m.version(${JSON.stringify(pkg)}))`], 30_000);
  if (code !== 0) return "";
  const first = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  return /^\d+[.\w]*$/.test(first) ? first : "";
}

/**
 * 从 simple 索引页取最新版 —— ⛔ **按 mirrorOrder 逐个源换**，全部失败才报错。
 * 为什么不用 PyPI 的 JSON API：国内镜像站**没有** `/pypi/<pkg>/json` 的等价物，
 * 而 simple 索引页是 PEP 503 标准格式、所有镜像都给 ⇒ 它就是唯一能用国内源的读法。
 */
async function pipLatestVersion(pkg: string, source: DownloadSourceSetting): Promise<string> {
  const candidates = mirrorOrder("pip", source);
  const errors: string[] = [];
  for (const index of candidates) {
    try {
      const url = `${index.replace(/\/$/, "")}/${encodeURIComponent(pkg)}/`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) { errors.push(`${index} → HTTP ${response.status}`); continue; }
      const html = await response.text();
      const versions = [...html.matchAll(/href="[^"]*[?/#=]([^"#/]+?)(?:\.tar\.gz|\.whl)"/gi)]
        .map((match) => match[1].split("-")[1])
        .filter((value) => /^\d+[.\w]*$/.test(value ?? ""));
      if (!versions.length) { errors.push(`${index} → 索引页里没解析出版本号`); continue; }
      return versions.sort(compareSemverLike).pop() ?? "";
    } catch (error) {
      errors.push(`${index} → ${(error as Error)?.message ?? error}`);
    }
  }
  throw new Error(`查不到 ${pkg} 的最新版（${errors.join("；")}）`);
}

function compareSemverLike(a: string, b: string): number {
  const pa = String(a).split(/[.+_-]/);
  const pb = String(b).split(/[.+_-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function pipUpgrade(pkg: string, source: DownloadSourceSetting, onLine: (line: string) => void): Promise<void> {
  const python = bundledPython();
  if (!python) throw new Error("缺少内置 Python，无法更新 pip 组件");
  const errors: string[] = [];
  for (const index of mirrorOrder("pip", source)) {
    const { code, out } = await run(python, ["-m", "pip", "install", "-U", ...PIP_COMMON_ARGS, "-i", index, pkg]);
    if (out) onLine(out.split(/\r?\n/).slice(-1)[0] ?? "");
    if (code === 0) return;
    errors.push(`${index} → exit ${code}`);
  }
  throw new Error(`pip 安装失败（已逐个源重试：${errors.join("；")}）`);
}

/* ── ponytail（GitHub release，走 gh-mirror 通道） ──────────────────── */

const PONYTAIL_REPO = "DietrichGebert/ponytail";

async function ponytailLatestTag(source: DownloadSourceSetting): Promise<string> {
  const prefixes = mirrorOrder("github", source);
  const url = "https://api.github.com/repos/" + PONYTAIL_REPO + "/releases/latest";
  const payload = await fetchJsonThroughMirrors(prefixes.map((prefix) => withPrefix(url, prefix)));
  const tag = String(payload?.tag_name ?? "").trim();
  if (!tag) throw new Error("GitHub 返回的 latest release 里没有 tag_name");
  return tag;
}

/**
 * 「当前已装」的 ponytail 版本 = **引擎落点里实际存在的最高版本**；一个都没装才回落随包常量。
 *
 * ⛔ 别拿随包常量 `PONYTAIL_VERSION` 当当前版本：在线更新装的是**按标签命名**的目录
 *    （`…/ponytail/ponytail/5.2.0`），与随包版本（4.9.0）不同名 —— 只报常量会让控制台
 *    永远停在「4.9.0 → v5.2.0（有可用更新）」，更新成功了也不刷新（10-13 用户实测）。
 * 版本大小比较走 `updates.ts` 的 `compareVersions`（单一真相源，别在这里手写第二份）。
 */
async function installedPonytailVersion(codexHome: string): Promise<string> {
  const versions = await listInstalledPonytailVersions(codexHome);
  return versions.sort(compareVersions).pop() ?? PONYTAIL_VERSION;
}

/** ponytail 更新：下载标签归档 → 校验 → 落到 cache → 重跑注册（幂等）。 */
async function updatePonytail(ctx: UpdateContext, tag: string): Promise<void> {
  const prefixes = mirrorOrder("github", ctx.source);
  const url = `https://github.com/${PONYTAIL_REPO}/archive/refs/tags/${tag}.tar.gz`;
  let archive: Buffer | null = null;
  const errors: string[] = [];
  for (const prefix of prefixes) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const response = await fetch(withPrefix(url, prefix), { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) { errors.push(`${prefix || "直连"} → HTTP ${response.status}`); continue; }
      archive = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      errors.push(`${prefix || "直连"} → ${(error as Error)?.message ?? error}`);
    }
  }
  if (!archive) throw new Error(`ponytail 归档下载失败（${errors.join("；")}）`);

  const staging = path.join(ctx.userData, "update-cache", "ponytail", tag);
  const untar = await extractTarGz(archive, staging);
  if (!untar.files) throw new Error("归档解包后一个文件都没有（可能不是 tar.gz 或下载不完整）");
  // ⛔ 被跳过的条目要落日志（不是静默丢弃）：路径穿越 / 不受支持的条目是安全信号，事后能查
  if (untar.skipped) console.warn(`[update] ponytail 归档里有 ${untar.skipped} 个条目被跳过：` + untar.skippedNames.join("；"));
  // GitHub 归档外层是 `<repo>-<tag>/`，插件本体在它的 plugin.yaml 所在层
  const root = await findPonytailRoot(staging);
  if (!root) throw new Error("归档里找不到 plugin.yaml —— 该标签不是插件形态，已中止更新");
  const version = /^version:\s*(\S+)/m.exec(await fs.readFile(path.join(root, "plugin.yaml"), "utf8"))?.[1] ?? tag;
  const { ensurePonytailPlugin } = await import("./ponytail-plugin");
  await ensurePonytailPlugin(ctx.codexHome, root, version);
  await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
}

/** 在解出来的目录里找含 plugin.yaml 的那一层（归档可能多套一层）。 */
async function findPonytailRoot(root: string): Promise<string | null> {
  const maxDepth = 3;
  let frontier = [root];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const dir of frontier) {
      try {
        if ((await fs.stat(path.join(dir, "plugin.yaml"))).isFile()) return dir;
      } catch { /* 换下一个 */ }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory()) next.push(path.join(dir, entry.name));
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

/* ── 扫描：把每个 spec 展开成若干行 ─────────────────────────────────── */

export async function scanRows(spec: ComponentSpec, ctx: UpdateContext): Promise<ComponentRow[]> {
  const base = {
    specId: spec.id,
    group: spec.group,
    pkg: spec.pkg,
    mirror: spec.mirror,
    reason: spec.reason,
    detectable: true,
    error: "",
  };
  const row = (id: string, label: string, patch: Partial<ComponentRow>): ComponentRow => ({
    ...base,
    id,
    label,
    installed: false,
    current: "",
    latest: "",
    hasUpdate: false,
    enabled: ctx.enabledOf(id),
    unsupported: "",
    ...patch,
  });

  // 结论性不支持的一类：出现在列表里，但不给操作
  if (spec.channel === "none") {
    return [row(spec.id, spec.label, { unsupported: spec.reason, detectable: false })];
  }

  try {
    switch (spec.kind) {
      case "engine": {
        const info = await checkEngineUpdateInfo();
        return [row(spec.id, spec.label, {
          installed: Boolean(info.current), current: info.current, latest: info.latest, hasUpdate: info.hasUpdate,
        })];
      }
      case "npm-tool": {
        if (!updateableToolIds().includes(spec.id)) return [];
        const r = await checkRuntimeUpdateRow(spec.id);
        return [row(spec.id, spec.label, {
          installed: Boolean(r.current), current: r.current, latest: r.latest, hasUpdate: r.hasUpdate, error: r.error,
        })];
      }
      case "pip-tool": {
        const current = await pipInstalledVersion(spec.pkg);
        if (!current) return [row(spec.id, spec.label, { installed: false, current: "", latest: "" })];
        let latest = "";
        let error = "";
        try { latest = await pipLatestVersion(spec.pkg, ctx.source); }
        catch (err) { error = (err as Error)?.message ?? String(err); }
        return [row(spec.id, spec.label, {
          installed: true, current, latest, error,
          hasUpdate: Boolean(latest) && compareSemverLike(latest, current) > 0,
        })];
      }
      case "ponytail": {
        const current = await installedPonytailVersion(ctx.codexHome);
        let latest = "";
        let error = "";
        try { latest = await ponytailLatestTag(ctx.source); }
        catch (err) { error = (err as Error)?.message ?? String(err); }
        return [row(spec.id, spec.label, {
          installed: true, current, latest, error,
          hasUpdate: Boolean(latest) && compareVersions(latest, current) > 0,
        })];
      }
      case "market-skill": {
        const rows = await checkSkillUpdateRows();
        return rows.map((entry) => row(`${spec.id}/${entry.folder}`, entry.name, {
          installed: true,
          current: entry.state === "current" ? "与市场一致" : "内容已变化",
          latest: entry.state === "current" ? "同上" : "市场最新内容",
          hasUpdate: entry.state === "update",
          error: entry.state === "unresolved" ? entry.detail : "",
          ...(entry.state === "unresolved" ? { detectable: false } : {}),
        }));
      }
      case "market-plugin": {
        const rows = await checkMarketPluginUpdates(codexMarketDir(ctx.codexHome));
        return rows.map((entry) => row(`${spec.id}/${entry.slug}`, `${entry.name}（市场插件）`, {
          installed: true, current: entry.current, latest: entry.latest,
          hasUpdate: entry.hasUpdate, detectable: entry.comparable,
          error: entry.comparable ? "" : "市场清单里没有它的版本号，无法比对 —— 可执行「重新安装」拉取最新内容",
        }));
      }
      case "official-plugin": {
        const rows = await checkOfficialPluginUpdates(codexOfficialMarketDir(ctx.codexHome));
        return rows.map((entry) => row(`${spec.id}/${entry.slug}`, `${entry.name}（官方插件）`, {
          installed: true, current: entry.current, latest: entry.latest,
          hasUpdate: entry.hasUpdate, detectable: entry.comparable,
          error: entry.comparable ? "" : "上游没给版本号，无法比对 —— 可执行「重新安装」拉取最新内容",
        }));
      }
      case "expert-skill": {
        const slugs = await installedExpertSkillsets();
        return slugs.map((slug) => row(`${spec.id}/${slug}`, `${slug}（专家包）`, {
          installed: true, current: "已安装", latest: "SkillHub 最新内容", hasUpdate: false, detectable: false,
          error: "SkillHub 不提供版本号或内容摘要，无法在不下载的情况下判定；「更新」会重新拉取并在内容一致时不改写",
        }));
      }
      case "soul": {
        const current = await currentSkillHubSoul();
        if (!current?.soulSlug) {
          return [row(spec.id, spec.label, { installed: false, current: "未应用人格", detectable: false })];
        }
        return [row(spec.id, `${current.soulSlug}（人格包）`, {
          installed: true, current: "已应用", latest: "SkillHub 最新内容", hasUpdate: false, detectable: false,
          error: "人格包无版本号；「更新」会重新拉取同一人格的最新文案",
        })];
      }
      default:
        return [row(spec.id, spec.label, { unsupported: "未接入更新后端", detectable: false })];
    }
  } catch (error) {
    // ⛔ 扫描失败**不能让整块消失**：把这一行的错误显示出来，其余行照常
    return [row(spec.id, spec.label, { error: (error as Error)?.message ?? String(error) })];
  }
}

/** 找出本地装了哪些专家包（按 .skillhub.json 里记录的 skillset slugs）。 */
async function installedExpertSkillsets(): Promise<string[]> {
  try {
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    const slugs = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const raw = await fs.readFile(path.join(userSkillsDir, entry.name, ".skillhub.json"), "utf8").catch(() => "");
      const kind = raw.match(/"kind"\s*:\s*"(skillset|skillset-child)"/)?.[1];
      const slug = raw.match(/"skillset"\s*:\s*"([^"]+)"/)?.[1] ?? (kind === "skillset" ? entry.name : "");
      if (slug) slugs.add(slug);
    }
    return [...slugs].sort();
  } catch { return []; }
}

/* ── 执行：更新单个组件 ─────────────────────────────────────────────── */

/**
 * 更新一行。**幂等**：内容与更新前一致 ⇒ 返回 unchanged（不重下载、不重安装）。
 * ⛔ 有目标目录的一律走 withRollback —— 失败自动回到更新前的确定状态。
 */
export async function updateComponent(spec: ComponentSpec, rowId: string, ctx: UpdateContext): Promise<UpdateOutcome> {
  const instance = String(rowId).includes("/") ? String(rowId).split("/").slice(1).join("/") : "";
  const outcome = (action: UpdateAction, message: string, before = "", after = "", label = spec.label): UpdateOutcome =>
    ({ id: rowId, label, action, before, after, message });

  if (spec.channel === "none") return outcome("skipped", spec.reason);

  ctx.progress(rowId, `开始更新 ${spec.label}…`, 5);
  try {
    switch (spec.kind) {
      case "engine": {
        const before = (await checkEngineUpdateInfo()).current;
        // ⛔⛔ 成功之后**必须把引擎拉回来**：performEngineUpdateFlow 为了替换二进制会先
        //    `server.stop()`，而"更新成功"这条分支它自己不会 restart（那条接缝是留给调用方的）。
        //    旧的手动链路由渲染层倒计时**重启整个应用**来生效；本系统的调用方没有那个倒计时，
        //    不拉起来就等于「引擎更新成功 + 应用从此残废」。
        const result = await performEngineUpdateFlow(async () => {
          const { server } = await import("./runtime-refs");
          await server.restart().catch(() => undefined);
        });
        if (!result.ok) throw new Error(result.message || "引擎更新失败");
        return outcome("updated", `${before || "旧版本"} → ${result.version}`, before, result.version);
      }
      case "npm-tool": {
        if (!updateableToolIds().includes(spec.id)) return outcome("skipped", "当前平台不可用");
        const before = (await checkRuntimeUpdateRow(spec.id)).current;
        if (!before) return outcome("skipped", "未检测到已安装版本，请先安装");
        const result = await performRuntimeUpdate(spec.id);
        if (!result.ok || !result.to) throw new Error(`${spec.label} 更新失败（没读出更新后的版本号）`);
        return result.to === result.from
          ? outcome("unchanged", "已经是最新版，未重复安装", before, before)
          : outcome("updated", `${result.from} → ${result.to}`, before, result.to);
      }
      case "pip-tool": {
        const before = await pipInstalledVersion(spec.pkg);
        if (!before) return outcome("skipped", "未检测到已安装版本，请先安装");
        ctx.progress(rowId, `正在从国内镜像更新 ${spec.pkg}…`, 20);
        await pipUpgrade(spec.pkg, ctx.source, (line) => ctx.progress(rowId, line, 50));
        const after = await pipInstalledVersion(spec.pkg);
        if (!after) throw new Error(`${spec.label} 装完读不到版本号，可能没真的装上`);
        await refreshEngineIfNeeded(ctx, spec.id);
        return after === before
          ? outcome("unchanged", "已经是最新版，未重复安装", before, before)
          : outcome("updated", `${before} → ${after}`, before, after);
      }
      case "ponytail": {
        const before = await installedPonytailVersion(ctx.codexHome);
        const tag = await ponytailLatestTag(ctx.source);
        if (compareVersions(tag, before) <= 0) return outcome("unchanged", "已经是最新版", before, before);
        ctx.progress(rowId, `下载 ${tag} 归档…`, 30);
        await updatePonytail(ctx, tag);
        ctx.progress(rowId, "已更新并重新注册", 95);
        return outcome("updated", `${before} → ${tag}`, before, tag);
      }
      case "market-skill": {
        if (!instance) return outcome("skipped", "缺少要更新的技能目录名");
        const targetDir = path.join(userSkillsDir, path.basename(instance));
        const before = await dirFingerprint(targetDir);
        const wrapped = await withRollback({
          targetDir, userData: ctx.userData, id: `market-skill/${path.basename(instance)}`,
          run: async () => updateSkillFolder(instance),
        });
        const after = await dirFingerprint(targetDir);
        return after === before
          ? outcome("unchanged", "市场内容与本地一致，未改写", before.slice(0, 8), before.slice(0, 8))
          : outcome("updated", `内容指纹 ${before.slice(0, 8)} → ${after.slice(0, 8)}`, before.slice(0, 8), after.slice(0, 8));
      }
      case "market-plugin": {
        if (!instance) return outcome("skipped", "缺少插件 slug");
        const marketDir = codexMarketDir(ctx.codexHome);
        const targetDir = path.join(marketDir, instance);
        const before = await dirFingerprint(targetDir);
        const plugin = await findMarketPlugin(instance);
        if (!plugin) return outcome("failed", "市场清单里找不到该插件（可能已下架），无法更新");
        await withRollback({
          targetDir, userData: ctx.userData, id: `market-plugin/${instance}`,
          run: async () => installCodexMarketPlugin({ plugin, destinationRoot: marketDir }),
        });
        const after = await dirFingerprint(targetDir);
        return after === before
          ? outcome("unchanged", "内容与市场一致，未改写", "", "")
          : outcome("updated", "已拉取最新内容", "", "");
      }
      case "official-plugin": {
        if (!instance) return outcome("skipped", "缺少插件 slug");
        const marketDir = codexOfficialMarketDir(ctx.codexHome);
        const targetDir = path.join(marketDir, instance);
        const before = await dirFingerprint(targetDir);
        const plugin = await findOfficialMarketPlugin(instance);
        if (!plugin) return outcome("failed", "官方市场里找不到该插件（可能已改名或下架），无法更新");
        await withRollback({
          targetDir, userData: ctx.userData, id: `official-plugin/${instance}`,
          run: async () => installOfficialMarketPlugin({ plugin, marketDir }),
        });
        const after = await dirFingerprint(targetDir);
        return after === before
          ? outcome("unchanged", "内容与上游一致，未改写", "", "")
          : outcome("updated", "已拉取最新内容", "", "");
      }
      case "expert-skill": {
        if (!instance) return outcome("skipped", "缺少专家包 slug");
        const before = await dirFingerprint(path.join(userSkillsDir, instance));
        await withRollback({
          targetDir: path.join(userSkillsDir, instance), userData: ctx.userData, id: `expert-skill/${instance}`,
          run: async () => installSkillHubSkillset({
            slug: instance,
            destinationRoot: userSkillsDir,
            onProgress: (stage, message) => ctx.progress(rowId, message, 40),
          }),
        });
        const after = await dirFingerprint(path.join(userSkillsDir, instance));
        return after === before
          ? outcome("unchanged", "SkillHub 内容与本地一致，未改写", "", "")
          : outcome("updated", "已重新拉取专家包内容", "", "");
      }
      case "soul": {
        const current = await currentSkillHubSoul();
        if (!current?.soulSlug) return outcome("skipped", "当前没有应用人格包");
        await applySkillHubSoul(current.soulSlug, ctx.codexHome);
        return outcome("updated", `已重新拉取人格「${current.soulSlug}」的最新文案`, current.soulSlug, current.soulSlug);
      }
      default:
        return outcome("skipped", "未接入更新后端");
    }
  } catch (error) {
    return outcome("failed", (error as Error)?.message ?? String(error));
  }
}

/** 工具换版本后引擎仍持有旧进程 ⇒ 空闲时重启一次，让引擎看到新二进制。 */
async function refreshEngineIfNeeded(ctx: UpdateContext, id: string): Promise<void> {
  try {
    const { server } = await import("./runtime-refs");
    ctx.progress(id, "正在刷新引擎以加载新版本…", 90);
    await server.restart().catch(() => undefined);
  } catch { /* 重启失败不否定更新本身：下次冷启动会加载新版本 */ }
}
