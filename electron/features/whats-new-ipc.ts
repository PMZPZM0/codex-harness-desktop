/**
 * whatsnew-ipc（2026-10-06 立）—— 域：**应用更新后的「新功能介绍」**。
 *
 * 用户需求原话：「每次应用更新到新版本后，需要在用户界面自动弹出一个小窗口，
 * 用于展示本次更新的核心内容。在新版本首次启动时自动出现，并包含版本号与更新要点列表。
 * 提供关闭或查看详情的操作按钮。避免在用户已查看过该版本时重复弹出。」
 *
 * ── 两道数据都在主进程（⛔ 渲染层不许自己判断"该不该弹"）────────────────────
 *   · **要点内容** = `electron/whats-new-notes.ts`（纯数据，随包进 dist-electron）；
 *   · **"看没看过"** = `userData/whats-new.json`，只有本域读写。
 *   ⇒ 渲染层拿到的是一份已经算好的 `shouldShow`，它只负责画和回报"知道了"。
 *
 * ── ⛔⛔ 时机陷阱（本域唯一难的地方）──────────────────────────────────────
 *   判定"这是**升级**还是**全新安装**"要靠"这台机器以前跑过本应用吗"。
 *   本应用的 userData 里 `boot-timing.json` 是**每次启动都会写**的（`flushBootTiming`），
 *   但它的写入时机是窗口 `did-finish-load` —— 而渲染层此刻**可能已经**在调本域的通道了
 *   ⇒ 在 handler 里现场读会**偶发地把老用户判成全新安装**（弹窗该出现却不出现，且静默）。
 *   ⇒ 在 `app.once("ready")`（**早于创建窗口**）抓一次快照存进闭包，判定只用它。
 *   ⛔ 也**不能**在模块顶层/setup 里读：`app.setPath("userData", …)` 在 main.ts 的模块体里，
 *     被 import 的模块体先于它执行 ⇒ 拿到的是默认目录（路径静默漂移，守卫【91】盯着这条）。
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { WHATS_NEW_ENTRIES, whatsNewEntryOf } from "../whats-new-notes";
import { GITHUB_REPO } from "../updates";

/** 本域占用的通道（卸载时要逐个摘掉）。 */
const WHATSNEW_CHANNELS = ["whatsnew:state", "whatsnew:ack", "whatsnew:history"];

/** 曾经启动过的旁证：这些都是本应用**自己**写进 userData 的状态文件（Chromium 的不算）。 */
const PRIOR_STATE_FILES = ["boot-timing.json", "app-settings.json", "personalization.json", "memory-mode.json"];

type WhatsNewRecord = { lastLaunchedVersion?: string; lastSeenVersion?: string; seenAt?: number };

function recordFile(userData: string) {
  return path.join(userData, "whats-new.json");
}

function readRecord(userData: string): WhatsNewRecord {
  try {
    const raw = fs.readFileSync(recordFile(userData), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WhatsNewRecord) : {};
  } catch {
    return {};   // 文件不存在 / 坏了都当"没有记录"（这份记录丢了最多多弹一次，不值得为它报错）
  }
}

function writeRecord(userData: string, next: WhatsNewRecord): void {
  try {
    fs.mkdirSync(userData, { recursive: true });
    // 原子写：先写临时文件再 rename（同 data/releases 的既有做法）——
    // 中途断电不会留下半截 JSON（半截 JSON 会被 readRecord 当"没记录"⇒ 再弹一次，不算灾难但要避免）。
    const tmp = `${recordFile(userData)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, recordFile(userData));
  } catch { /* 写不进去（盘满/只读）不该影响启动 —— 大不了下次再弹 */ }
}

export const whatsNewFeature = defineFeature<null>({
  id: "whatsnew",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("whatsnew: 缺少 ipc 服务（宿主未提供）");

    /** 这台机器**以前**跑过本应用吗（见文件头"时机陷阱"）。
     *  `null` = 还没抓到快照（handler 理论上不会在此之前被调用）。 */
    let hadPriorState: boolean | null = null;
    /** 本次启动**之前**那次的版本号（空串 = 这份记录还不存在 ⇒ 说明以前没跑过带本功能的版本）。 */
    let previousVersion = "";

    const snapshot = () => {
      try {
        const userData = app.getPath("userData");
        const record = readRecord(userData);
        previousVersion = String(record.lastLaunchedVersion ?? "");
        hadPriorState = PRIOR_STATE_FILES.some((name) => fs.existsSync(path.join(userData, name)));
        // 每次启动都记一笔"这次跑的是哪个版本"，下次启动就能确定性地判"升级了"。
        writeRecord(userData, { ...record, lastLaunchedVersion: String(app.getVersion() || "") });
      } catch {
        hadPriorState = false;
      }
    };
    if (app.isReady()) snapshot();
    else {
      app.once("ready", snapshot);
      // 卸载（热插拔停用本域）时摘掉这个一次性监听，别留悬挂回调
      ctx.effect(() => { app.removeListener("ready", snapshot); });
    }

    /**
     * 该不该弹。
     * @returns `{ version, entry, shouldShow, reason }`
     *   `reason` 只用于诊断（不展示给用户）：`no_notes` / `already_seen` / `fresh_install` / `upgrade`
     */
    ipcHost.handle("whatsnew:state", () => {
      const version = String(app.getVersion() || "");
      const entry = whatsNewEntryOf(version);
      const userData = app.getPath("userData");
      const record = readRecord(userData);
      const seen = record.lastSeenVersion === version;
      let shouldShow = false;
      let reason = "";
      if (!entry) reason = "no_notes";
      else if (seen) reason = "already_seen";
      /* ⛔ "以前没跑过" 有两种可能：**全新安装**（不该弹 —— 用户不是"更新"过来的）
         还是**第一次跑带本功能的版本**（= 从旧版升上来，**必须弹**）。
         靠 `hadPriorState`（ready 时刻的快照）区分：老用户的 userData 里必有本应用自己的状态文件。 */
      else if (!previousVersion && hadPriorState === false) reason = "fresh_install";
      else { shouldShow = true; reason = "upgrade"; }
      /* 「查看详情」的落点：完整发版说明就是该版本的 GitHub Release 正文。
         ⛔ 仓库名只在主进程有一份（`updates.ts` 的 GITHUB_REPO）⇒ URL 在主进程拼好，
         别让渲染层再写一遍 "PMZPZM0/..."（两处写死必然有一处先过期）。 */
      const releaseUrl = entry ? `https://github.com/${GITHUB_REPO}/releases/tag/v${version}` : "";
      return { ok: true, version, entry, shouldShow, reason, seen, releaseUrl };
    });

    /** 全量版本要点（10-07 新手引导 →「版本更新日志」页用）。
     *  ⛔ 数据源仍是 `whats-new-notes.ts` 的同一份 WHATS_NEW_ENTRIES（单一真相源）——
     *    渲染层不许抄一份自己的 changelog；Release 链接同样在主进程拼好（同 state 的口径）。 */
    ipcHost.handle("whatsnew:history", () => ({
      ok: true,
      entries: WHATS_NEW_ENTRIES.map((entry) => ({
        ...entry,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${entry.version}`,
      })),
    }));

    /** 用户看过了（关闭 / 点"知道了"）⇒ 记下这个版本，之后不再弹。 */
    ipcHost.handle("whatsnew:ack", (_event, version: string) => {
      const current = String(app.getVersion() || "");
      /* ⛔ 只接受"当前版本"：渲染层传别的值会被写进记录 ⇒ 下次真升级时被误判成"看过"
         （与 updates:install 只认刚校验过的包同一个口径：**权威值在主进程**）。 */
      if (String(version ?? "") !== current) return { ok: false, error: "version_mismatch" };
      const userData = app.getPath("userData");
      writeRecord(userData, { ...readRecord(userData), lastSeenVersion: current, seenAt: Date.now() });
      return { ok: true };
    });

    ctx.effect(() => {
      for (const channel of WHATSNEW_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
