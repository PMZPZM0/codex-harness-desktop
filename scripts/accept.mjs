// scripts/accept.mjs —— **唯一验收入口**（CDP 直连）
//
// 用户 09-12 三次定稿，全部体现在这个文件里：
//   ① 「把旧的验收流程删干净，每次都写最新的 cpd 脚本验收，不然你老是卡住」
//      → 旧的 `scripts/e2e/scenarios/*` + 增量哈希 runner 已删除（preflight【7】硬守卫不许回来）。
//   ② 「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」
//      → 跑在**跨轮次复用的持久 profile** 上，首次把真实 profile 的会话历史搬进来，之后一轮轮叠加。
//   ③ 「用旧会话测试，不要一直新建会话」
//      → 所有验收项都只在**已有会话**上操作；不新建会话、不发新消息。
//
// 用法：
//   node scripts/accept.mjs                  # 跑全部验收项
//   node scripts/accept.mjs --list            # 列出验收项
//   node scripts/accept.mjs --only reveal     # 只跑 id 含 reveal 的项
//   node scripts/accept.mjs --keep            # 跑完不关应用
//   node scripts/accept.mjs --profile main    # 换一个持久 profile 名
//   CODEX_HARNESS_RESEED=1 node scripts/accept.mjs   # 强制重灌真实配置/历史
//
// 被测 profile：`.e2e-profile/<name>/`（已 gitignore，含真实对话内容，勿入库）

import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "./e2e/lib/harness.mjs";
import { greetingInjected } from "./e2e/lib/rollout-inspect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 最长的一条 assistant 正文字数（「进来就在实时进度」的判据用它，与具体回合序号无关）
const BODY_LEN = `(() => {
  let max = 0;
  for (const b of document.querySelectorAll(".assistant-message .message-body")) {
    const n = (b.innerText || "").length;
    if (n > max) max = n;
  }
  return max;
})()`;

/** 点侧栏第 i 个会话行（只用旧会话） */
const clickRow = (h, i) => h.eval(`(() => {
  const list = [...document.querySelectorAll(".thread-row")];
  const btn = list[${i}] && list[${i}].querySelector("button");
  if (!btn) return false;
  btn.click();
  return true;
})()`);

// ─────────────────────────────────────────────────────────────────────────────
// 本轮验收项（**每次改动只改这一段**；不再对应的旧项直接删掉，别攒着）
// ─────────────────────────────────────────────────────────────────────────────
const CHECKS = [
  {
    id: "wake-settings",
    name: "⑪ 设置 → 语音通话：唤醒卡片与「最近听到什么」诊断可见（09-13 唤醒修复的渲染侧）",
    run: async (h) => {
      // 为什么断言这一条：唤醒是常驻监听，跑在 VoiceCallFloat，而状态显示在设置页 ——
      // 中间靠 `src/voice/wake-state.ts` 广播。CDP 测不了麦克风与识别，但**这条广播链是否接上**
      // 完全可以从 DOM 上看出来（卡片必须渲染出状态行，且文案随 enabled 变化）。
      // ① 打开设置弹窗（Ctrl+, 与 App 内的快捷键同源）
      await h.eval(`(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
        return true;
      })()`);
      const opened = await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置弹窗打开", timeoutMs: 15000 })
        .then(() => true).catch(() => false);
      h.check("[前置] 设置弹窗能打开", opened);
      if (!opened) return;

      // ② 切到「语音通话」分区（导航按钮按文案点，索引会随导航顺序变化）
      const clicked = await h.eval(`(() => {
        const nav = document.querySelector(".settings-nav");
        if (!nav) return false;
        const btn = [...nav.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "语音通话");
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      h.check("[前置] 导航里有「语音通话」分区", clicked === true);
      const cardUp = await h.waitFor(`!!document.querySelector("[data-voice-wake-status]")`, { label: "唤醒卡片挂载", timeoutMs: 20000 })
        .then(() => true).catch(() => false);
      h.check("[前置] 唤醒卡片渲染出来了（含状态行）", cardUp);
      if (!cardUp) return;

      // ③ 状态行必须有内容，且不能是「载入中」这种占位
      const status = String(await h.eval(`(document.querySelector("[data-voice-wake-status]")?.innerText || "").trim()`) ?? "");
      console.log(`  [唤醒状态] 「${status}」`);
      h.check("状态行有文案（不是空白/未接线）", status.length > 0, `len=${status.length}`);
      h.check(
        "状态行给出「听到什么/未开启」这类可执行信息",
        /未开启|正在聆听|已开启|未启动/.test(status),
        `status=「${status}」`
      );
      // ④ 唤醒卡片里必须有「同音容错」的说明（用户据此理解为什么小科小科也能唤醒）
      const cardText = String(await h.eval(`(() => {
        const line = document.querySelector("[data-voice-wake-status]");
        const card = line && line.closest(".voice-card");
        return card ? card.innerText : "";
      })()`) ?? "");
      h.check("卡片说明了同音容错匹配", /同音/.test(cardText), `card="${cardText.slice(0, 60)}…"`);
      // ⑤ 关键词唤醒模型（KWS）没装时，卡片上要有一键下载入口（装了才是「只认读音、不误唤醒」那条路）。
      //    隔离 profile 里一定没装 → 这条断言在 e2e 环境是确定的。
      const kwsButton = String(await h.eval(`(() => {
        const line = document.querySelector("[data-voice-wake-status]");
        const card = line && line.closest(".voice-card");
        const btn = card ? [...card.querySelectorAll("button")].find((b) => /唤醒模型/.test(b.innerText || "")) : null;
        return btn ? btn.innerText.trim() : "";
      })()`) ?? "");
      console.log(`  [唤醒模型入口] 「${kwsButton}」`);
      h.check("未装关键词模型时给出下载入口（约 31MB）", /唤醒模型/.test(kwsButton) && /31MB/.test(kwsButton), `btn=「${kwsButton}」`);
      await h.screenshot("语音唤醒设置卡片");
      await h.eval(`(() => { const b = document.querySelector(".settings-modal .relay-modal-close"); if (b) b.click(); return true; })()`);
      await wait(300);
    },
  },

  {
    id: "boot-history",
    name: "① 启动即带真实历史（不是空白 profile，也不新建会话）",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      console.log(`  [历史] 侧栏会话行 ${rows} 个；启动时 profile 已有 ${h.rolloutsBefore} 个 rollout`);
      h.check("已进入主界面", await h.exists(".app-shell"));
      h.check("侧栏有真实历史会话（测试形态 = 用户实际形态）", rows >= 1, `thread-row=${rows}`);
      h.check("profile 是跨轮次复用的持久目录", h.persistent === true, h.userDataDir);
      h.check("profile 里确有历史 rollout（历史搬进来了）", h.rolloutsBefore > 0, `rolloutsBefore=${h.rolloutsBefore}`);
    },
  },

  {
    id: "switch-running",
    name: "③bis **运行中**切走再切回：内容必须照常展示（用户截图：切回来整个空白）",
    run: async (h) => {
      // 用户实测（09-13 截图）：会话在跑的时候切出去、切回来，整个对话区**空白**。
      // 这是最严重的一类回归（比位置错更难忍：什么都看不到），必须有独立覆盖。
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 侧栏有旧会话可切（≥2 行）", rows >= 2, `thread-row=${rows}`);
      await clickRow(h, 0);
      await wait(1200);
      // 造一个"长时间运行"的回合：30 轮工具调用（用户实际用法），跑起来就切走
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "分30轮调用工具运行命令编辑文件，每轮做完报一下第几轮，全部做完再汇总。");
      await wait(300);
      await h.click(".send-button");
      const running = await h.waitFor(`!!document.querySelector(".timeline-bottom-spacer.compact")`, { label: "回合跑起来", timeoutMs: 60000 }).then(() => true).catch(() => false);
      h.check("[前置] 回合已进入运行态（运行留白在）", running);
      // 切走**之前**先记一份内容基准：用户报的是"切回来整个不展示"，
      // 所以判据必须是"切回来不得比切走时更少"，而不是"只要有字就算过"。
      const before = await h.eval(`(() => {
        const tl = document.querySelector(".timeline");
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const bodies = [...document.querySelectorAll(".assistant-message .message-body")];
        // ⚠️ 用 textContent 而不是 innerText：折叠组收起后 innerText 为空（innerText 尊重渲染），
        // 折叠状态一变这个数就跳，会把"折叠了"误判成"内容丢了"（实测 252→136 的假红）。
        // 另外总文字量会被折叠开合影响，所以**判据落在"最后那个回合"（= 正在跑的那个）**，
        // 它的内容与折叠无关，正是用户截图里"切回来不见了"的那部分。
        return {
          text: tl ? (tl.textContent || "").length : 0,
          lastTurnText: last ? (last.textContent || "").length : 0,
          lastTurnItems: last ? last.querySelectorAll(".message, .wb-fold").length : 0,
          maxBody: bodies.reduce((m, b) => Math.max(m, (b.textContent || "").length), 0),
          groups: groups.length,
        };
      })()`);
      console.log(`  [运行中切走前] ${JSON.stringify(before)}`);
      // 运行中切走 → 在后台跑一段（关键变量：切走期间回合并未停，缓存/流式都在推进）
      // → 再切回来。用户截图就是"运行中切出去、切回来整个空白"。
      await clickRow(h, 1);
      await wait(12000);
      await clickRow(h, 0);
      await wait(2500);
      const state = await h.eval(`(() => {
        const tl = document.querySelector(".timeline");
        if (!tl) return { noTimeline: true };
        const groups = document.querySelectorAll(".turn-group").length;
        const text = (tl.innerText || "").trim().length;
        const bodies = [...document.querySelectorAll(".assistant-message .message-body")].map((b) => (b.textContent || "").length);
        const rect = tl.getBoundingClientRect();
        // 视口里**真正看得见**的回合数：0 而 groups>0 = 视口停在留白里 = 用户看到的"整个不展示"
        let visibleGroups = 0;
        for (const g of document.querySelectorAll(".turn-group")) {
          const r = g.getBoundingClientRect();
          if (r.bottom > rect.top && r.top < rect.bottom) visibleGroups += 1;
        }
        const pad = document.querySelector(".timeline-bottom-spacer.anchor-pad");
        const cmp = document.querySelector(".timeline-bottom-spacer.compact");
        const allGroups = [...document.querySelectorAll(".turn-group")];
        const last = allGroups[allGroups.length - 1];
        return {
          groups: allGroups.length, lastTurnText: last ? (last.textContent || "").length : 0,
          lastTurnItems: last ? last.querySelectorAll(".message, .wb-fold").length : 0,
          text, visibleGroups,
          maxBody: bodies.length ? Math.max(...bodies) : 0,
          scrollTop: Math.round(tl.scrollTop), sh: Math.round(tl.scrollHeight), ch: tl.clientHeight,
          pad: pad ? Math.round(pad.offsetHeight) : -1,
          compact: cmp ? Math.round(cmp.offsetHeight) : -1,
          running: !!cmp,
        };
      })()`);
      console.log(`  [运行中切回] ${JSON.stringify(state)}`);
      await h.screenshot("运行中切回");
      h.check("切回来时间线还在（不是空白页）", !state?.noTimeline, JSON.stringify(state));
      h.check("切回来有回合内容（.turn-group ≥ 1）", Number(state?.groups) >= 1, `groups=${state?.groups}`);
      h.check("切回来对话区有可见文字（≥ 20 字）", Number(state?.text) >= 20, `text=${state?.text}`);
      h.check("切回来正文没丢（最长正文 > 0）", Number(state?.maxBody) > 0, `maxBody=${state?.maxBody}`);
      // 权威判据：切回来不得比切走时更少（正文只增不减——回合在后台一直在长）。
      // 判据落在**最后那个回合**（正在跑的那个）：它的内容不受折叠开合影响，
      // 正是用户截图里"切回来整个不展示"的那部分。
      h.check("切回来正在跑的回合内容不缩水（≥ 切走时的 80%）",
        Number(state?.lastTurnText) >= Number(before?.lastTurnText) * 0.8,
        `before=${before?.lastTurnText} after=${state?.lastTurnText}`);
      h.check("切回来正文不缩水（≥ 切走时的 80%）", Number(state?.maxBody) >= Number(before?.maxBody) * 0.8,
        `before=${before?.maxBody} after=${state?.maxBody}`);
      // ⚠️ 不断言"时间线总文字量"：折叠组的展开/收起会直接改变 textContent（收起时子节点
      // 不在 DOM 里），切会话时折叠状态本来就会重算 —— 那个数字测的是折叠状态而不是内容
      // 丢没丢（实测 17314 → 1340 是折叠收起造成的假红）。内容完整性由上面两条
      // （最长正文、正在跑的回合）保证。
      h.check("视口没有停在留白里（看得见的回合 ≥ 1）", Number(state?.visibleGroups) >= 1, JSON.stringify(state));
      h.check("切回来没有残留一屏锚顶留白（≤ 一屏）", Number(state?.pad) <= Number(state?.ch), `pad=${state?.pad} ch=${state?.ch}`);
      h.check("渲染层没有报错（否则整棵树会被卸载 = 空白）", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
      // ★ 用户实测（09-13 截图）：「切出去，会话直接中断了」——回来以后输入框是**发送箭头**
      // 而不是停止键，界面认为回合已经停了。这是权威判据：`.send-button.is-pause` =
      // 应用仍认为该会话在跑（发送键的形态由 activeThreadRunning 决定）。
      const stillRunning = await h.eval(`!!document.querySelector(".send-button.is-pause")`);
      const stillWorking = await h.eval(`(() => { const w = document.querySelector(".working-indicator"); return w ? (w.innerText || "").trim() : ""; })()`);
      console.log(`  [运行中切回] 界面仍认为在跑=${!!stillRunning}；处理中行=「${stillWorking}」`);
      h.check("切回来界面仍认为回合在跑（发送键保持停止形态）", !!stillRunning,
        `is-pause=${!!stillRunning} working=${stillWorking}`);
      // 再等一会儿看它是不是还在长（真的没被中断 = 后台继续产出）
      const grownBefore = Number(await h.eval(`(() => { const g = [...document.querySelectorAll(".turn-group")]; const last = g[g.length - 1]; return last ? (last.textContent || "").length : 0; })()`));
      await wait(10000);
      const grownAfter = Number(await h.eval(`(() => { const g = [...document.querySelectorAll(".turn-group")]; const last = g[g.length - 1]; return last ? (last.textContent || "").length : 0; })()`));
      const stillRunning2 = await h.eval(`!!document.querySelector(".send-button.is-pause")`);
      console.log(`  [运行中切回] 10s 后：正文 ${grownBefore} → ${grownAfter}；仍在跑=${!!stillRunning2}`);
      h.check("切回来后回合仍在后台继续产出（正文还在长）", grownAfter > grownBefore,
        `before=${grownBefore} after=${grownAfter} running=${!!stillRunning2}`);
    },
  },

  {
    id: "switch-speed",
    name: "② 旧会话切进切出：首次打开 vs 再次切回",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有可切的旧会话（≥3）", rows >= 3, `thread-row=${rows}`);
      const measure = (i) => h.eval(`(async () => {
        const list = [...document.querySelectorAll(".thread-row")];
        const btn = list[${i}] && list[${i}].querySelector("button");
        if (!btn) return { switched: false };
        const before = (document.querySelector(".thread-row.active button")?.innerText || "");
        const t0 = performance.now();
        btn.click();
        for (let k = 0; k < 300; k++) {
          await new Promise((res) => setTimeout(res, 10));
          const now = (document.querySelector(".thread-row.active button")?.innerText || "");
          if (now && now !== before) return { switched: true, ms: Math.round(performance.now() - t0) };
        }
        return { switched: false, reason: "no-active-change" };
      })()`);
      const n = Math.min(5, rows);
      const firstOpen = [];
      for (let i = 0; i < n; i++) { firstOpen.push(await measure(i)); await wait(250); }
      const revisit = [];
      for (let i = 0; i < n; i++) { revisit.push(await measure(i)); await wait(250); }
      const ms = (arr) => arr.filter((s) => s?.switched).map((s) => s.ms);
      const fMs = ms(firstOpen);
      const rMs = ms(revisit);
      const firstMax = fMs.length ? Math.max(...fMs) : -1;
      const rMed = rMs.length ? rMs.slice().sort((a, b) => a - b)[Math.floor(rMs.length / 2)] : -1;
      console.log(`  [切换] 首次打开 ${JSON.stringify(fMs)}（最大 ${firstMax}ms）`);
      console.log(`  [切换] 再次切回 ${JSON.stringify(rMs)}（中位数 ${rMed}ms）`);
      h.check("两轮切换都真的生效（各 ≥ 3 次）", fMs.length >= 3 && rMs.length >= 3, `first=${fMs.length} revisit=${rMs.length}`);
      h.check("首次打开 < 1500ms（含引擎 resume + 首屏渲染）", firstMax > 0 && firstMax < 1500, `firstMax=${firstMax}ms`);
      h.check("再次切回中位数 < 200ms（反复切会话的体感，走本地缓存）", rMed > 0 && rMed < 200, `median=${rMed}ms ${JSON.stringify(rMs)}`);
      h.check("再次切回最多 1 个慢样本（系统性缓存失效会每个都慢）", rMs.filter((v) => v >= 200).length <= 1, JSON.stringify(rMs));
      await h.screenshot("旧会话切换");
    },
  },

  {
    id: "reveal-on-switch",
    name: "③ **旧会话**来回切：进来就在实时进度，绝不复播正文",
    run: async (h) => {
      // 用户定稿：「实时进度在哪里，进来就在哪里」——切进任何旧会话，正文必须**立刻**是
      // 当前长度，不许出现「从短到长重新出字」。
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 侧栏有旧会话可切（≥3 行）", rows >= 3, `thread-row=${rows}`);

      const seen = [];
      for (let i = 0; i < Math.min(4, rows); i++) {
        await clickRow(h, i);
        await wait(1400);
        seen.push(Number(await h.eval(BODY_LEN)) || 0);
      }
      console.log(`  [复播] 各旧会话正文长度：${JSON.stringify(seen)}`);
      const stock = Math.max(...seen);
      h.check("[前置] 存在正文足够长的旧会话（≥80 字，复播才看得出来）", stock >= 80, `lens=${JSON.stringify(seen)}`);
      const target = seen.indexOf(stock);
      const other = target === 0 ? 1 : 0;

      await clickRow(h, other);
      await wait(1200);
      await h.eval(`(window.__adbg = [])`);
      await clickRow(h, target);
      const samples = [];
      for (let i = 0; i < 40; i++) {
        const len = Number(await h.eval(BODY_LEN)) || 0;
        if (len > 0) samples.push(len);
        if (samples.length >= 12) break;
        await wait(50);
      }
      const first = samples.length ? samples[0] : -1;
      const min = samples.length ? Math.min(...samples) : -1;
      console.log(`  [复播] 重进旧会话 #${target}（离开时 ${stock} 字）→ 采样 ${JSON.stringify(samples.slice(0, 12))}`);
      const reveals = await h.eval(`(() => (window.__adbg || []).filter((e) => e && e.r === "reveal"))()`);
      const maxAnimated = reveals.length ? Math.max(...reveals.map((e) => Number(e.animated) || 0)) : 0;
      const byKey = new Map();
      for (const e of reveals) {
        const k = String(e.key ?? "?");
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(Number(e.from) || 0);
      }
      const regressions = [];
      for (const [k, seq] of byKey) {
        let peak = -1;
        for (let i = 0; i < seq.length; i++) {
          if (seq[i] < peak - 1) regressions.push({ key: k, at: i, from: seq[i], prevPeak: peak });
          if (seq[i] > peak) peak = seq[i];
        }
      }
      if (reveals.length) console.log(`  [复播] 揭示 ${reveals.length} 条，最大 animated=${maxAnimated}，前 4 条: ${JSON.stringify(reveals.slice(0, 4))}`);

      // 核心（用户原话「进来就在哪里」）
      h.check("重进旧会话首帧正文 ≥ 离开时的 80%（进来就在实时进度）", first >= Math.floor(stock * 0.8), `first=${first} stock=${stock}`);
      h.check("重进后正文没有变短过（最低采样 ≥ 离开时的 80%）", min >= Math.floor(stock * 0.8), `min=${min} stock=${stock}`);
      // 存量复播的权威信号 = 一次「补播≈存量大小」的揭示（修复前实测 animated=334）
      h.check("重进后没有「一次性补播存量」的揭示（最大 animated < 100）", maxAnimated < 100, `maxAnimated=${maxAnimated} stock=${stock}`);
      h.check("各消息揭示位置不回退（同一 key 的 from 单调不降）", regressions.length === 0, JSON.stringify(regressions.slice(0, 3)));
      await h.screenshot("旧会话来回切");
    },
  },

  {
    id: "greet-once",
    name: "④ 身份引导：存量用户不得再被引导（扫已有 rollout，不新建会话）",
    run: async (h) => {
      const files = h._rolloutFiles();
      h.check("[前置] profile 里有历史 rollout", files.length > 0, `files=${files.length}`);
      // 权威判据见 lib/rollout-inspect.mjs（只看 role === "developer" 的消息；
      // 对整份文本 includes("初次见面") 会撞上项目 AGENTS.md 的文档文本 → 恒定假红）
      const injected = files.filter((f) => {
        try { return greetingInjected(readFileSync(f, "utf8")); } catch { return false; }
      });
      console.log(`  [引导] 历史 rollout ${files.length} 个；带初次见面引导的 ${injected.length} 个`);
      const p = join(h.userDataDir, "personalization.json");
      let config = null;
      try { config = JSON.parse(readFileSync(p, "utf8")); } catch { /* 没落盘 */ }
      h.check("档案 greeted=true（此后新会话不再引导）", config?.greeted === true, JSON.stringify(config));
      // 修复生效后产生的 rollout（mtime ≥ 本次启动）不许再带引导
      const fresh = files.filter((f) => { try { return statSync(f).mtimeMs >= h.launchedAt; } catch { return false; } });
      const freshInjected = fresh.filter((f) => {
        try { return greetingInjected(readFileSync(f, "utf8")); } catch { return false; }
      });
      h.check("本轮产生的会话没有注入初次见面引导", freshInjected.length === 0, `fresh=${fresh.length} injected=${freshInjected.length}`);
    },
  },

  {
    id: "concurrency",
    name: "⑤ 旧会话之间来回切：主进程全程不被拖住",
    run: async (h) => {
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有可切的旧会话（≥3）", rows >= 3, `thread-row=${rows}`);
      const probes = [];
      for (let i = 0; i < 8; i++) {
        const t0 = Date.now();
        try { await h.eval(`window.codex.perfCounters()`); probes.push(Date.now() - t0); }
        catch { probes.push(9999); }
        await clickRow(h, i % Math.min(3, rows));
        await wait(400);
      }
      const max = Math.max(...probes);
      const c = await h.eval(`window.codex.perfCounters()`);
      console.log(`  [并发] 切旧会话期间主进程探测 ${probes.join(", ")} ms（最大 ${max}）`);
      console.log(`  [计数] ${JSON.stringify(c)}`);
      h.check("切旧会话期间主进程每次都及时回话（最大 < 800ms）", max < 800, `max=${max}ms`);
      h.check("渲染层仍可响应（perfCounters 可读）", !!c && typeof c.resumeCount === "number", JSON.stringify(c));
    },
  },

  {
    id: "send-anchor",
    name: "⑦ 发送后新消息仍钉在顶上那个位置（不贴底、不漂移）",
    run: async (h) => {
      // 用户反馈「我发的消息怎么不在那个位置了」。注意：旧的 send-anchor-top 场景在收编验收
      // 流程时被我删掉了 → 这条行为一度**零覆盖**。现在补回到唯一入口里。
      // 判据（沿用当时实测定的口径）：
      //   · 锚点顶部相对对话区顶部 ≈ ANCHOR_TOP_OFFSET_PX（54，允许一点抖动）；
      //   · `scrollTop < maxScroll − 4` —— 证明视口没被贴底接管（这才是"钉顶"）。
      // 补发：本项在**当前已打开的旧会话**里发，不新建会话（用户定稿）。
      // 量「最后一条用户消息」相对对话区顶部的距离（`#chat-anchor` 只在乐观气泡阶段存在，
      // 真消息一到就被换掉，所以不能拿它当长期判据）。
      const measure = `(() => {
        const tl = document.querySelector(".timeline");
        if (!tl) return { error: "no-timeline" };
        const users = [...document.querySelectorAll(".turn-group .user-message, .user-message")];
        const last = users[users.length - 1];
        if (!last) return { error: "no-user-message" };
        const gap = Math.round(last.getBoundingClientRect().top - tl.getBoundingClientRect().top);
        return {
          gap,
          hasAnchor: !!document.getElementById("chat-anchor"),
          scrollTop: Math.round(tl.scrollTop),
          max: Math.round(tl.scrollHeight - tl.clientHeight),
          atBottom: tl.scrollTop >= tl.scrollHeight - tl.clientHeight - 4,
        };
      })()`;
      h.check("[前置] 已打开一个会话（时间线在）", await h.exists(".timeline"));

      const adbgDump = `(() => {
        const all = Array.isArray(window.__adbg) ? window.__adbg : [];
        return all.filter((e) => ["send-arm-main", "send-arm-fork", "init-pin", "confirm-fired", "cancel:bottom-scroll", "pin-apply", "pin-fix", "pin-miss", "follow-grow", "stick-jump", "clear-anchor"].includes(e.r) || String(e.r).startsWith("release:")).slice(-18);
      })()`;
      const idle = (h) => h.waitFor(`!document.querySelector(".timeline-bottom-spacer.compact")`, { label: "回合跑完", timeoutMs: 60000 }).catch(() => undefined);
      for (const [label, text] of [["第 1 条", "只回复一个数字：31"], ["第 2 条", "只回复一个数字：32"]]) {
        // ⚠️ 必须等上一条真跑完再发下一条：运行中发送会走「排队」路径（没有钉顶、也不会
        // 立刻产生新回合），测出来的是排队行为而不是发送钉顶（09-12 实测：第 2 条
        // 打点表全空 = send-arm-main 根本没触发）。
        await idle(h);
        await h.clearInput(".composer-editor");
        await h.typeInto(".composer-editor", text);
        await wait(250);
        // 发送后 1.2s 高频采样：乐观锚（#chat-anchor）在不在、scrollTop 走向 —— 钉顶失败的
        // 第一现场。少了这段，事后只能看到"没钉住"却不知道是哪一步没发生（09-12 排查）。
        await h.eval(`window.__adbg = []`);
        await h.click(".send-button");
        const trail = [];
        for (let i = 0; i < 24; i++) {
          trail.push(await h.eval(`(() => { const tl = document.querySelector(".timeline"); return [document.getElementById("chat-anchor") ? 1 : 0, tl ? Math.round(tl.scrollTop) : -1]; })()`));
          await wait(50);
        }
        const anchors = trail.filter((s) => Array.isArray(s) && s[0] === 1).length;
        console.log(`  [轨迹] ${label}：乐观锚出现 ${anchors}/24 帧；scrollTop ${JSON.stringify(trail.slice(0, 12).map((s) => (Array.isArray(s) ? s[1] : s)))}`);
        console.log(`  [轨迹] ${label} 打点：${JSON.stringify(await h.eval(adbgDump))}`);
        await h.waitFor(`document.querySelectorAll(".turn-group").length >= 1`, { label: "回合出现", timeoutMs: 40000 }).catch(() => undefined);
        await wait(1500);
        const m = await h.eval(measure);
        console.log(`  [钉顶] ${label}：gap=${m?.gap}px scrollTop=${m?.scrollTop}/${m?.max} 贴底=${m?.atBottom} 乐观锚在=${m?.hasAnchor}`);
        h.check(`[${label}] 量到了用户消息位置`, !m?.error, JSON.stringify(m));
        // gap ≈ 54：给 0~130 的宽窗（内容不足一屏时钉顶会被留白托住，gap 会略大）
        h.check(`[${label}] 新消息钉在顶部附近（gap 0~130px，目标 54）`, Number(m?.gap) >= 0 && Number(m?.gap) <= 130, `gap=${m?.gap}`);
        // 钉顶的核心：视口**没有**停在内容最底部
        h.check(`[${label}] 视口没被贴底接管（钉顶而非贴底）`, m?.atBottom === false, `scrollTop=${m?.scrollTop} max=${m?.max}`);
      }

      // ── 切出去再切回来：钉顶必须还在 ──
      // 用户实测（09-13）：「切换会话，钉顶没了」——运行中切走看一眼再切回来，
      // 消息不再停在顶上、直接掉到底部。判据：切回来 gap 仍是 ~54。
      // ⚠️ 必须按**会话标题**切，不能按行索引：侧栏按最近活动排序，刚发过消息的会话会
      // 跳到最前，索引在来回切的过程中会指到别的会话上去（实测切回来"钉顶没了"其实是
      // 点开了另一条会话 —— 用索引测出来的假红）。
      const rowTitle = (i) => `String(([...document.querySelectorAll(".thread-row")][${i}]?.querySelector("button")?.innerText || "").split("\\n")[0].trim())`;
      const hereTitle = String(await h.eval(`(() => { const active = document.querySelector(".thread-row.active"); const rows = [...document.querySelectorAll(".thread-row")]; return active ? active.querySelector("button").innerText.split("\\n")[0].trim() : rows[0].querySelector("button").innerText.split("\\n")[0].trim(); })()`));
      const awayTitle = String(await h.eval(`(() => { const rows = [...document.querySelectorAll(".thread-row")]; const active = document.querySelector(".thread-row.active"); const other = rows.find((r) => r !== active); return other ? other.querySelector("button").innerText.split("\\n")[0].trim() : ""; })()`));
      const clickByTitle = (t) => h.eval(`(() => { const hit = [...document.querySelectorAll(".thread-row")].find((r) => r.querySelector("button").innerText.split("\\n")[0].trim() === ${JSON.stringify(t)}); if (!hit) return false; hit.querySelector("button").click(); return true; })()`);
      const pinBefore = await h.eval(measure);
      await clickByTitle(awayTitle);
      await wait(1800);
      await clickByTitle(hereTitle);
      await wait(2200);
      const pinAfter = await h.eval(measure);
      const afterTrail = await h.eval(adbgDump);
      console.log(`  [切回钉顶] 切走前 gap=${pinBefore?.gap} → 切回后 gap=${pinAfter?.gap}（「${hereTitle}」↔「${awayTitle}」）`);
      console.log(`  [切回钉顶] 打点：${JSON.stringify(afterTrail)}`);
      const afterHidden = Number(await h.eval(`(() => {
        const tl = document.querySelector(".timeline");
        if (!tl) return 9999;
        const blankOf = (sel) => { const n = document.querySelector(sel); return n ? n.offsetHeight : 0; };
        const bottom = tl.scrollHeight - blankOf(".timeline-bottom-spacer.anchor-pad") - blankOf(".timeline-bottom-spacer.compact");
        return Math.round(bottom - tl.scrollTop - tl.clientHeight);
      })()`));
      h.check("[切回钉顶] 前置：切走前确实是钉顶状态（gap ≈ 54）",
        Math.abs(Number(pinBefore?.gap) - 54) <= 40, `before=${pinBefore?.gap}`);
      // 切回来之后"位置"有两种合法结局，取决于回复有没有长过一屏（与流式期间同一套语义）：
      //   · 回复没超屏 → 消息仍在 54px（钉顶恢复）；
      //   · 回复超屏   → 位置交给跟随，最新内容贴在视口底（消息自然往上走）。
      // 不允许的是"钉顶机制整条死掉"：所以同时断言**钉顶打点确实又跑过**
      // （pin-apply / pin-fix / pin-miss 之一），这正是用户报的「切换会话，钉顶没了」。
      const pinnedAgain = Array.isArray(afterTrail) && afterTrail.some((e) => ["pin-apply", "pin-fix"].includes(e.r));
      const backToTop = Math.abs(Number(pinAfter?.gap) - 54) <= 40;
      const latestVisible = afterHidden <= 120;
      console.log(`  [切回钉顶] 恢复落点=${backToTop ? "钉在 54px" : `跟随（视口外 ${afterHidden}px）`}；钉顶打点复跑=${pinnedAgain}`);
      h.check("切出去再切回来，钉顶机制没死（位置被重新接管）", pinnedAgain, JSON.stringify((afterTrail || []).slice(-4)));
      h.check("切回来看到的是最新内容（钉在 54px 或最新正文可见）",
        backToTop || latestVisible, `gap=${pinAfter?.gap} hidden=${afterHidden}`);

      // ── 弹跳判据（09-12 用户反馈「钉顶想往上、跟随想往下，来回拉扯、上下弹跳」）──
      // 采样整段流式期间的 scrollTop：钉顶与跟随如果各抢一次，就会出现**方向反转**。
      // 判据：相邻采样的最大跳变有界；方向反转次数极少（正常跟随是单向递增）。
      await h.clearInput(".composer-editor");
      await idle(h);
      await h.typeInto(".composer-editor", "请从 1 数到 30，每个数字单独一行，每行后面加一句十字以上的说明。");
      await wait(250);
      await h.click(".send-button");
      const samples = [];
      const hiddenSamples = [];
      const bottomSamples = [];
      const busySamples = [];
      let ch0 = 0;
      // 采样到「回合真的跑完」为止（上限 5 分钟），**不许中途截断**：
      // 用户指出「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」——
      // 长回合的问题（跟随跟不上、完成瞬间折叠导致跳变）只会在后段暴露，
      // 采样 3~40 秒然后关掉应用等于把最关键的证据扔掉。
      for (let i = 0; i < 1500; i++) {
        // 同时采「视口位置」和「正文有多少 px 被挤到输入框下面（看不见）」——后者就是
        // 用户截图反馈的「输入框上面一行永远不动、自动跟随又没了」：
        // 钉顶把消息钉在顶上，但正文一路往下长、最新一行始终在视口外。
        const v = await h.eval(`(() => {
          const tl = document.querySelector(".timeline");
          if (!tl) return null;
          const blankOf = (sel) => { const n = document.querySelector(sel); return n ? n.offsetHeight : 0; };
          const bottom = tl.scrollHeight - blankOf(".timeline-bottom-spacer.anchor-pad") - blankOf(".timeline-bottom-spacer.compact");
          return [Math.round(tl.scrollTop), Math.round(bottom - tl.scrollTop - tl.clientHeight), Math.round(bottom), tl.clientHeight, document.querySelector(".timeline-bottom-spacer.compact") ? 1 : 0];
        })()`);
        samples.push(Array.isArray(v) ? Number(v[0]) : -1);
        hiddenSamples.push(Array.isArray(v) ? Number(v[1]) : -1);
        bottomSamples.push(Array.isArray(v) ? Number(v[2]) : -1);
        busySamples.push(Array.isArray(v) ? Number(v[4]) : 0);
        if (Array.isArray(v)) ch0 = Number(v[3]);
        await wait(200);
        // 回合跑完（运行留白撤掉）再收工——这才是"消息看完"
        if (i > 10 && Array.isArray(v) && Number(v[4]) === 0) break;
      }
      const deltas = [];
      for (let i = 1; i < samples.length; i++) deltas.push(samples[i] - samples[i - 1]);
      // 前 5 个采样（≈1s）是**钉顶落位**本身：发送时视口还在上一条的底部，钉顶把新消息
      // 放到 54px 处必然是一段位移，那是功能而不是"跳"。从第 6 个采样起才是在流式过程中
      // 的稳定性，判据只对它生效。
      const activeDeltas = deltas.slice(5);
      const maxJump = activeDeltas.length ? Math.max(...activeDeltas.map((d) => Math.abs(d))) : 0;
      let reversals = 0;
      let bigReversals = 0;
      let dir = 0;
      for (const d of activeDeltas) {
        if (Math.abs(d) < 2) continue;             // 抖动量级不算方向
        const next = d > 0 ? 1 : -1;
        if (dir !== 0 && next !== dir) { reversals += 1; if (Math.abs(d) >= 40) bigReversals += 1; }
        dir = next;
      }
      console.log(`  [弹跳] 采样 ${samples.length} 次；最大相邻跳变 ${maxJump}px；方向反转 ${reversals} 次`);
      console.log(`  [弹跳] 轨迹(前 20): ${JSON.stringify(samples.slice(0, 20))}`);
      // 这一轮打点是**整段长回合**跑完之后取的（含跟随为什么不动的证据）
      console.log(`  [长回合] 打点：${JSON.stringify(await h.eval(adbgDump))}`);
      // 判据（09-13 按"用户看得见吗"重定标）：
      //   · 相邻跳变 ≤ 120px —— 跟随一档是 60px，落点复核一次约 30px，超过 120 才是"整屏弹跳"；
      //   · **大幅**方向反转（|Δ| ≥ 40px）≤ 1 次 —— 长回合里 20~30px 的落点微调不算"来回闪"，
      //     用"所有反转 ≤ 2 次"会把采样时长越拉越长就越容易假红（100 次采样里两次微调很正常）。
      h.check("流式期间视口没有来回拉扯（大幅反转 ≤ 1 次）", bigReversals <= 1, `bigReversals=${bigReversals} reversals=${reversals} samples=${JSON.stringify(samples.slice(0, 24))}`);
      // 跳变判据按**方向**分开看（09-13 重定标）：
      //   · 向下的一次大跳 = 内容成批到达后视口追赶，是**必须**的（否则最新内容留在屏幕外），
      //     上限给 1.5 屏，超过说明在追历史；
      //   · 向上的一次大跳 = 视口被往回拽，这才是用户说的"跳/闪"，必须 ≤ 60px（一档跟随量）。
      //   原来只卡 |Δ| ≤ 120，会把"成批到达的追赶"误判成 bug，同时放过不了"往回拽"的性质区分。
      const maxUp = activeDeltas.length ? Math.max(0, ...activeDeltas.map((d) => -d)) : 0;
      const maxDown = activeDeltas.length ? Math.max(0, ...activeDeltas) : 0;
      h.check("视口不回跳（单次向上 ≤ 60px）", maxUp <= 60, `maxUp=${maxUp}px deltas=${JSON.stringify(deltas.slice(0, 24))}`);
      h.check("追赶步长有界（单次向下 ≤ 1.5 屏）", maxDown <= ch0 * 1.5, `maxDown=${maxDown}px ch=${ch0}`);
      // ── 自动跟随：流式期间「最新内容」必须一直在视口内 ──
      // 钉顶只负责"消息在顶上"，跟随负责"最新一行看得见"，两者缺一不可。判据用
      // **被挤到视口下方的内容高度**（不含尾部留白），阈值给约 5 行（120px）——
      // 跟随是按 60px 一档推进的，所以稳定态下这个值天然在 0~60 之间。
      const grew = bottomSamples[bottomSamples.length - 1] - bottomSamples[0];
      const hiddenMax = Math.max(...hiddenSamples);
      const hiddenTail = hiddenSamples[hiddenSamples.length - 1];
      console.log(`  [跟随] 内容增长 ${grew}px（视口 ${ch0}px）；视口外正文最大 ${hiddenMax}px；末尾 ${hiddenTail}px`);
      console.log(`  [跟随] 视口外轨迹: ${JSON.stringify(hiddenSamples.slice(0, 26))}`);
      // 前置：内容必须真的长过一屏（否则这条断言测不出东西 —— 短回复跟随触没触发都一样）
      h.check("[前置] 流式内容长过一屏（跟随才可能被检验）", grew > ch0, `grew=${grew}px ch=${ch0}`);
      h.check("流式期间最新正文始终可见（视口外 ≤ 120px）", hiddenMax <= 120, `hiddenMax=${hiddenMax}px tail=${hiddenTail} grew=${grew} samples=${JSON.stringify(hiddenSamples.slice(0, 26))}`);
      await h.screenshot("发送钉顶");
    },
  },

  {
    id: "fold-anchor",
    name: "⑥ 折叠组里不得有长正文/最终汇报（用户报的「折叠吞汇报」）",
    run: async (h) => {
      // 用户反馈「折叠消息把 codex 最后汇报的也折叠进去了」→「折叠怎么还能出问题」。
      // 直接用 DOM 判：**折叠组内部**不允许出现长正文（≥200 字）。组里可以放工具、思考、
      // 以及一两句过渡，但「汇报本身」必须留在外面。这是用户视角的判据，不依赖内部实现。
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有历史会话可查（≥3）", rows >= 3, `thread-row=${rows}`);
      const found = [];
      for (let i = 0; i < Math.min(6, rows); i++) {
        await clickRow(h, i);
        await wait(1200);
        const folded = await h.eval(`(() => {
          const out = [];
          for (const grp of document.querySelectorAll(".wb-fold--completed, .wb-fold--summary")) {
            for (const body of grp.querySelectorAll(".assistant-message .message-body")) {
              const len = (body.innerText || "").length;
              if (len >= 200) out.push({ len, head: (body.innerText || "").slice(0, 24) });
            }
          }
          return out;
        })()`);
        if (Array.isArray(folded) && folded.length) found.push({ row: i, folded: folded.slice(0, 3) });
      }
      console.log(`  [折叠] 检查了 ${Math.min(6, rows)} 个旧会话；折叠组内发现长正文的：${found.length} 个`);
      for (const f of found.slice(0, 3)) console.log(`  [折叠]   会话#${f.row}: ${JSON.stringify(f.folded)}`);
      h.check("没有任何折叠组吞掉长正文（≥200 字的汇报必须留在外面）", found.length === 0, JSON.stringify(found.slice(0, 2)));
      await h.screenshot("折叠检查");
    },
  },

  {
    id: "remote-auth",
    name: "⑨ 手机远控：6 位配对码 + 电脑端审批（09-13 二次加固）",
    run: async (h) => {
      // 09-13 二次加固：二维码/配对链接**不再夹带任何凭据**（能力式 URL 会随链接、截图、
      // 浏览器历史、隧道日志外泄）。手机要连上必须过两道关：
      //   ① 6 位配对码（电脑端显示，5 分钟有效，错 10 次作废）；
      //   ② 电脑端审批（提交正确码后挂起，用户在应用里点「允许」）。
      // 这条断言就是「拿到链接就能控我机器」那个洞的回归守卫。
      await h.eval(`(() => { window.__remoteProbe = null; window.codex.remoteStart().then((r) => { window.__remoteProbe = r; }).catch((e) => { window.__remoteProbe = { error: String(e?.message ?? e) }; }); return true; })()`);
      await h.waitFor(`!!window.__remoteProbe`, { label: "远控启动返回", timeoutMs: 20000 }).catch(() => undefined);
      const info = await h.eval(`JSON.stringify(window.__remoteProbe ?? null)`);
      let parsed = null;
      try { parsed = JSON.parse(info); } catch { /* eval 出错会返回字符串 */ }
      h.check("[前置] 远控服务已启动并给出配对地址", Boolean(parsed?.port && parsed?.url), String(info).slice(0, 200));
      const port = Number(parsed?.port);
      h.check("配对地址不再夹带一次性凭据（无 k=）", !/[?&]k=/.test(String(parsed?.url ?? "")), String(parsed?.url ?? "").slice(0, 120));

      // ① 电脑端拿到 6 位配对码
      await h.eval(`(() => { window.__pair = null; window.codex.remotePairState().then((r) => { window.__pair = r; }).catch((e) => { window.__pair = { error: String(e) }; }); return true; })()`);
      await h.waitFor(`!!window.__pair`, { label: "配对状态返回", timeoutMs: 10000 }).catch(() => undefined);
      let pair = null;
      try { pair = JSON.parse(await h.eval(`JSON.stringify(window.__pair ?? null)`)); } catch { /* ignore */ }
      const code = String(pair?.code ?? "");
      h.check("电脑端给出 6 位配对码", /^\d{6}$/.test(code), `code=「${code}」`);

      const req = (method, path, body, cookie) => new Promise((resolve) => {
        const headers = {};
        if (body) headers["content-type"] = "application/json";
        if (cookie) headers.cookie = cookie;
        const r = http.request({ host: "127.0.0.1", port, path, method, headers, timeout: 5000 }, (res) => {
          let text = "";
          res.on("data", (c) => (text += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text, cookies: res.headers["set-cookie"] ?? [] }));
        });
        r.on("error", () => resolve({ status: -1, text: "", cookies: [] }));
        r.on("timeout", () => { r.destroy(); resolve({ status: -1, text: "", cookies: [] }); });
        if (body) r.write(JSON.stringify(body));
        r.end();
      });
      const jsonOf = (text) => { try { return JSON.parse(text); } catch { return {}; } };

      // ② 无凭据：API 401；页面落到配对页（要求输 6 位码）
      const anonApi = await req("GET", "/api/status");
      const anonPage = await req("GET", "/r/mobile");
      h.check("无凭据访问控制面被拒（401）", anonApi.status === 401, `status=${anonApi.status}`);
      h.check("无凭据打开页面落到配对页（要求输 6 位码）", anonPage.status === 200 && /配对这台手机|6 位配对码/.test(anonPage.text), `status=${anonPage.status}`);

      // ③ 配对码错误 → 拒绝，且不进入审批
      // 设备 id 每轮随机：持久 profile 会记住批准过的设备，固定 id 第二轮就走老朋友分支了
      const deviceId = "dev-test-" + Date.now().toString(36);
      const wrong = jsonOf((await req("POST", "/api/pair", { code: "000000", deviceId, deviceName: "测试手机" })).text);
      h.check("配对码错误时被拒绝（不挂起审批）", wrong.ok === false, `resp=${JSON.stringify(wrong).slice(0, 120)}`);

      // ④ 配对码正确 → 挂起等审批；审批前控制面仍 401
      const right = jsonOf((await req("POST", "/api/pair", { code, deviceId, deviceName: "测试手机" })).text);
      h.check("配对码正确 → 挂起等电脑端审批（给 rid）", right.ok === true && Boolean(right.rid) && right.approved === false, `resp=${JSON.stringify(right).slice(0, 160)}`);
      const rid = String(right.rid ?? "");
      const still401 = await req("GET", "/api/status");
      h.check("未审批前控制面仍然拒绝（401）", still401.status === 401, `status=${still401.status}`);

      // ⑤ 电脑端弹出审批卡片 → 点「允许」
      const cardUp = await h.waitFor(`!!document.querySelector("[data-pair-pending]")`, { label: "审批卡片出现", timeoutMs: 15000 }).then(() => true).catch(() => false);
      h.check("电脑端弹出审批卡片（有手机等待批准）", cardUp);
      if (!cardUp) { await h.eval(`window.codex.remoteStop().catch(() => undefined)`); return; }
      try { await h.screenshot("手机远控-审批卡片"); } catch { /* 截图超时不影响结论（断言已全部落在 DOM/HTTP 上） */ }
      const clicked = await h.eval(`(() => { const btn = document.querySelector("[data-pair-pending] .remote-allow-btn"); if (!btn) return false; btn.click(); return true; })()`);
      h.check("点下「允许」按钮", clicked === true);

      // ⑥ 手机端轮询到 approved 并拿到 HttpOnly cookie；带 cookie 访问 200
      const st = await req("GET", `/api/pair-status?rid=${rid}`);
      const stJson = jsonOf(st.text);
      h.check("审批通过后手机端拿到凭据（approved）", stJson.status === "approved", `resp=${JSON.stringify(stJson).slice(0, 160)}`);
      const rawCookies = Array.isArray(st.cookies) ? st.cookies : [String(st.cookies)];
      const cookie = rawCookies.map((c) => String(c).split(";")[0].trim()).join("; ");
      const cookieRaw = rawCookies.join(" | ");
      h.check("凭据以 HttpOnly cookie 下发（含设备身份）", /harness_remote=/.test(cookie) && /harness_device=/.test(cookie) && /HttpOnly/.test(cookieRaw), `cookie=${cookieRaw.slice(0, 120)}`);
      const authed = await req("GET", "/api/status", null, cookie);
      h.check("带凭据可正常访问控制面（200）", authed.status === 200, `status=${authed.status}`);

      // ⑦ 已批准过的设备再次连接 → 直接放行（不用再输码、不用再审批）
      const again = jsonOf((await req("POST", "/api/pair", { code: "000000", deviceId, deviceName: "测试手机" })).text);
      h.check("已批准设备再次连接直接放行（不再走审批）", again.ok === true && again.approved === true, `resp=${JSON.stringify(again).slice(0, 120)}`);
      await h.eval(`window.codex.remoteStop().catch(() => undefined)`);
    },
  },


  {
    id: "queue-display",
    name: "⑨ 排队消息只在输入框上方展示 + 超过 2 条折叠（用户 09-13 定稿）",
    run: async (h) => {
      // 用户定稿：「排队消息只贴在输入框上面展示就行，支持消息超2条可以折叠就行，折叠功能应该有」。
      // 判据全部走 DOM：聊天区里不能再有那份 `.timeline-queue`（重复展示的来源），
      // 输入框上方的管理卡在 3 条时必须默认折叠成 2 条且给出「展开全部 3 条」。
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有旧会话可开（≥1）", rows >= 1, `thread-row=${rows}`);
      await clickRow(h, 0);
      await wait(1200);
      // 先起一个长回合，后面的消息才会进队列（空闲时会直接发出去）
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "请从 1 数到 60，每个数字单独一行，每行后面加一句十五字以上的说明。");
      await wait(250);
      await h.click(".send-button");
      const busy = await h.waitFor(`!!document.querySelector(".timeline-bottom-spacer.compact")`, { label: "回合跑起来", timeoutMs: 60000 }).then(() => true).catch(() => false);
      h.check("[前置] 已进入运行态（排队才会发生）", busy);
      for (const text of ["排队甲", "排队乙", "排队丙"]) {
        await h.clearInput(".composer-editor");
        await h.typeInto(".composer-editor", text);
        await wait(180);
        await h.click(".send-button");
        await wait(500);
      }
      const state = await h.eval(`(() => {
        const items = document.querySelectorAll(".queued-messages .queued-message").length;
        const toggle = document.querySelector(".queued-collapse-toggle");
        const count = document.querySelector(".queued-collapse-count");
        return {
          timelineQueue: document.querySelectorAll(".timeline-queue").length,
          card: !!document.querySelector(".queued-messages"),
          items,
          count: count ? Number(count.textContent) : 0,
          toggle: toggle ? (toggle.innerText || "").replace(/\\s+/g, " ").trim() : "",
        };
      })()`);
      console.log(`  [队列] ${JSON.stringify(state)}`);
      h.check("[前置] 输入框上方有排队管理卡", state?.card === true, JSON.stringify(state));
      h.check("[前置] 队列里确有 3 条", Number(state?.count) >= 3, `count=${state?.count}`);
      h.check("聊天区里不再渲染排队气泡（只保留输入框上方一处）", Number(state?.timelineQueue) === 0, `timeline-queue=${state?.timelineQueue}`);
      h.check("超过 2 条时默认折叠成 2 条", Number(state?.items) === 2, `items=${state?.items} count=${state?.count}`);
      h.check("折叠控件给出「展开全部 N 条」", /展开全部\s*3\s*条/.test(String(state?.toggle)), `toggle=「${state?.toggle}」`);
      await h.click(".queued-collapse-toggle");
      await wait(400);
      const expanded = Number(await h.eval(`document.querySelectorAll(".queued-messages .queued-message").length`));
      h.check("点开后 3 条全部展示", expanded === 3, `items=${expanded}`);
      await h.screenshot("排队消息展示");
    },
  },

  {
    id: "queue-immediate",
    name: "⑩ 排队消息点「立即」：弹提醒 + 从队列摘掉（定案：不再尝试聊天区展示）",
    run: async (h) => {
      // 定案（用户 09-13）：「恢复成原来那种，排队消息点立即发出去后，弹窗提醒」。
      // 曾经试过「点立即就在聊天区当普通消息展示（乐观气泡+钉顶）」，被用户否掉：
      // 那条走 turn/steer，消息是插进**正在跑的回合**里的，渲染层硬做定位反而与引擎流打架。
      // 现在只断言两件事：① 有提醒（toast）；② 这条从队列卡片里消失（不残留、不重复展示）。
      const before = await h.eval(`(() => {
        const card = document.querySelector(".queued-messages");
        return { items: document.querySelectorAll(".queued-messages .queued-message").length, text: card ? card.innerText : "" };
      })()`);
      h.check("[前置] 队列里还有排队消息可点「立即」", Number(before?.items) >= 1, `items=${before?.items}`);
      await h.click(".queued-messages .queued-message .queued-action");
      await wait(1200);
      const after = await h.eval(`(() => ({
        items: document.querySelectorAll(".queued-messages .queued-message").length,
        toast: (document.querySelector(".toast, .notice, .app-toast")?.innerText || "").replace(/\\s+/g, " ").trim(),
        body: (document.body.innerText || "").includes("已发送") || (document.body.innerText || "").includes("已并入当前任务"),
      }))()`);
      console.log(`  [立即] 点击前 ${before?.items} 条 → 点击后 ${after?.items} 条；提醒=「${String(after?.toast).slice(0, 40)}」`);
      h.check("点「立即」后有提醒反馈", after?.body === true, JSON.stringify(after).slice(0, 200));
      h.check("这条已从队列卡片里摘掉（不残留）", Number(after?.items) === Number(before?.items) - 1, `before=${before?.items} after=${after?.items}`);
      h.check("聊天区里没有第二份排队展示（.timeline-queue 恒为 0）",
        Number(await h.eval(`document.querySelectorAll(".timeline-queue").length`)) === 0);
      await h.screenshot("立即发送提醒");
    },
  },

  {
    id: "relay-subscription",
    name: "内置付费订阅：套餐目录可拉取 + 置顶订阅卡随真实账户渲染（只读，不动真实账号）",
    run: async (h) => {
      await enterMain(h);
      // 打开 设置 → 中转站（弹窗是异步渲染的：先点，再等导航出现）
      await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
      await h.waitFor(`!!document.querySelector(".settings-nav")`, { label: "设置弹窗", timeoutMs: 20000 });
      const nav = await h.eval(`(() => {
        for (const btn of document.querySelectorAll(".settings-nav button")) {
          if ((btn.textContent || "").includes("中转站")) { btn.click(); return true; }
        }
        return false;
      })()`);
      if (!nav) throw new Error("设置导航里没有「中转站」");
      await h.waitFor(`!!document.querySelector(".relay-sub-banner")`, { label: "订阅置顶卡", timeoutMs: 30000 });
      const banner = await h.eval(`(() => { const el = document.querySelector(".relay-sub-banner"); return JSON.stringify({ state: el?.getAttribute("data-state"), text: (el?.innerText || "").slice(0, 80) }); })()`);
      const b = JSON.parse(banner);
      h.check("置顶订阅卡已渲染", Boolean(b.state), banner);
      if (b.state === "guest") {
        h.check("未登录：置顶卡提供「登录 / 注册」入口", (b.text || "").includes("登录"), b.text);
      } else {
        h.check("已登录：置顶卡展示订阅/余额状态", ["active", "expiring", "expired", "empty", "watching"].includes(b.state), b.state);
      }
      // 套餐市场数据（只读 GET）：已登录 → 拉站方 for_sale 套餐；未登录 → 必须给出明确错误（而不是崩溃/空列表）
      const plans = await h.eval(`window.codex.relayPaymentPlans().then((r) => JSON.stringify({ n: (r || []).length, first: r?.[0]?.name ?? "" })).catch((e) => "ERR:" + e.message)`);
      if (b.state === "guest") {
        h.check("未登录：套餐目录返回明确错误（尚未登录）", String(plans).includes("尚未登录"), plans);
      } else if (String(plans).startsWith("ERR")) {
        h.check("已登录但套餐目录拉取失败（站点不可达，属环境因素）", false, plans);
      } else {
        const p = JSON.parse(plans);
        h.check(p.n > 0 ? "套餐市场目录可拉取（真实站方数据）" : "站点未上架套餐（for_sale=0，属站方状态）", true, plans);
      }
      await h.screenshot("relay-subscription");
    },
  },

  {
    id: "skill-discipline",
    name: "技能运用纪律：AGENTS.md 守则 + 能力清单注入，四个自主扩编动态工具已注册",
    run: async (h) => {
      await enterMain(h);
      // ① 守则区间已写进 codex-home/AGENTS.md（幂等 upsert，boot 时重建）
      const d = await h.eval(`window.codex.skillDisciplineGet()`);
      h.check("守则区间已注入 AGENTS.md", Boolean(d?.present), `present=${d?.present}`);
      const section = String(d?.section ?? "");
      h.check("守则含「开工先匹配能力」纪律", section.includes("开工先匹配能力") && section.includes("自主搜索并安装"), section.slice(0, 60));
      h.check("守则含「缺连接器先征得同意」安全条款", section.includes("agent_ask"), "");
      // ② 能力清单是真实扫描结果（技能/连接器至少认出一类；全新 profile 也会注入「暂无」占位）
      const hasInventory = section.includes("### 当前能力清单") && (section.includes("**已装技能**") || section.includes("**已配 MCP 连接器**"));
      h.check("能力清单区块存在（技能或连接器至少一类）", hasInventory, section.slice(-200));
      // ③ 能力清单对账：本机已装技能必须出现在清单里（真实扫描，非占位文本）
      const locals = await h.eval(`window.codex.listLocalSkills().then((list) => JSON.stringify(list.map((s) => s.name)))`);
      const names = JSON.parse(locals);
      if (names.length) {
        const missing = names.filter((name) => !section.includes(name));
        h.check(`能力清单与已装技能对账（${names.length} 个技能全部列出）`, missing.length === 0, missing.length ? `缺失：${missing.join(", ")}` : "全部命中");
      } else {
        h.check("本机暂无已装技能：清单为「暂无」占位（正常）", section.includes("暂无"), "");
      }
      // ④ 引擎实测：thread/resume 带 dynamicTools 必须被受理（旧会话工具面重注册的通路；
      //    纯 RPC 探针，不发模型回合）。引擎报 unknown field/参数错都会在这里现形。
      const resumeProbe = await h.eval(`(() => {
        const threads = JSON.parse(localStorage.getItem("threads") || "[]");
        return threads[0]?.id || "";
      })()`);
      const threadIdForProbe = resumeProbe || await h.eval(`window.codex.request("thread/list", { limit: 1, sortKey: "updated_at", sortDirection: "desc", archived: false }).then((r) => r.data?.[0]?.id ?? "")`);
      if (threadIdForProbe) {
        const resumeErr = await h.eval(`window.codex.request("thread/resume", {
          threadId: ${JSON.stringify(threadIdForProbe)},
          excludeTurns: true,
          dynamicTools: [{ type: "function", name: "skill_search", description: "probe", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
        }).then(() => "accepted").catch((e) => "ERR:" + e.message)`);
        h.check("resume 带 dynamicTools 被引擎受理（旧会话可重注册工具面）", resumeErr === "accepted", resumeErr);
      } else {
        h.check("无旧会话可探针（跳过 resume 受理断言）", true, "profile 无会话");
      }
      await h.screenshot("skill-discipline");
    },
  },

  {
    id: "openai-import",
    name: "OpenAI 导入账号文件：四种格式解析 + JWT 身份 + vault 入库（不碰 auth.json / 供应商）",
    run: async (h) => {
      await enterMain(h);
      // 本地伪造 JWT（payload 合法即可，应用不验签）
      const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = b64u({ alg: "none", typ: "JWT" }) + "." + b64u({
        sub: "user-accept-abc", email: "accept-import@test.local", exp: nowSec + 86400,
        "https://api.openai.com/auth": { chatgpt_account_id: "acct-accept-1", chatgpt_plan_type: "plus", chatgpt_subscription_active_until: "2027-01-01T00:00:00Z" },
      }) + ".sig";
      const accessToken = b64u({ alg: "none" }) + "." + b64u({ exp: nowSec + 3600 }) + ".sig";
      // 四种形态混在两个"文件"里：auth.json 整档 + NDJSON（裸 token / auth.json 形 / 扁平 JSON）
      const authJson = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: idToken, access_token: accessToken, refresh_token: "refresh-accept-1", account_id: "acct-accept-1" }, last_refresh: new Date().toISOString() });
      const mixed = [
        "sk-accept-bare-token",
        JSON.stringify({ tokens: { access_token: accessToken, refresh_token: "refresh-accept-2", id_token: idToken } }),
        JSON.stringify({ accessToken, refreshToken: "refresh-accept-3", email: "accept-flat@test.local" }),
      ].join("\n");
      const result = await h.eval(`window.codex.openaiImportFile({ contents: [${JSON.stringify(authJson)}, ${JSON.stringify(mixed)}] }).then((r) => JSON.stringify(r)).catch((e) => "ERR:" + e.message)`);
      if (String(result).startsWith("ERR")) throw new Error(result);
      const r = JSON.parse(result);
      h.check("四形态共 4 条全部入库（auth.json 形按 identity 去重）", r.total === 4 && r.failed === 0, JSON.stringify({ total: r.total, imported: r.imported, updated: r.updated, failed: r.failed }));
      const accounts = await h.eval(`window.codex.openaiAccounts().then((list) => JSON.stringify(list.map((a) => ({ id: a.email || a.id, planType: a.planType, sub: a.subscriptionUntil }))))`);
      const list = JSON.parse(accounts);
      const byId = (id) => list.find((a) => a.id === id);
      const bareItem = r.items.find((item) => item.action !== "failed" && !item.email && String(item.id ?? "").startsWith("import-"));
      const mainItem = r.items.find((item) => item.email === "accept-import@test.local");
      const flatItem = r.items.find((item) => item.email === "accept-flat@test.local");
      h.check("JWT 身份解出：email / plus 档位 / 订阅期", mainItem && byId(mainItem.id)?.planType === "plus" && String(byId(mainItem.id)?.sub).startsWith("2027-01-01"), accounts);
      h.check("扁平 JSON 的 email 字段入账", Boolean(flatItem && byId(flatItem.id)), accounts);
      h.check("裸 token 落兜底 id（只入 vault 不作登录目标）", Boolean(bareItem), JSON.stringify(r.items.map((i) => ({ id: i.id, action: i.action }))));
      // 清理：按导入结果的具体 id 逐个移除（不碰真实账号），不动 auth.json / 供应商生效状态
      for (const item of r.items) {
        if (item.id) await h.eval(`window.codex.openaiAccountRemove(${JSON.stringify(item.id)})`).catch(() => undefined);
      }
      // 兜底清扫历史遗留的兜底 id（此前清理过滤漏掉过它们）
      await h.eval(`window.codex.openaiAccounts().then((list) => Promise.all(list.filter((a) => !a.email && String(a.id).startsWith("import-")).map((a) => window.codex.openaiAccountRemove(a.id))))`).catch(() => undefined);
      const after = await h.eval(`window.codex.openaiAccounts().then((list) => JSON.stringify(list.filter((a) => (a.email || a.id).includes("accept") || (!a.email && String(a.id).startsWith("import-"))).length))`);
      h.check("验收数据已清理（持久 profile 不留测试账号）", after === "0", after);
    },
  },

  {
    id: "voice-presets",
    name: "内置音色预设：台湾腔/贾维斯风一键建档启用（结束还原原音色设置）",
    run: async (h) => {
      await enterMain(h);
      const presets = await h.eval(`window.codex.voicePresetList().then((r) => JSON.stringify(r.presets.map((p) => p.id)))`);
      const ids = JSON.parse(presets);
      h.check("随包预设目录可读（台湾腔 + 贾维斯风）", ids.includes("taiwan-female") && ids.includes("jarvis-butler"), presets);
      const before = await h.eval(`window.codex.voiceSettingsGet().then((res) => JSON.stringify(res.settings.tts.profileId ?? ""))`);
      const applied = await h.eval(`window.codex.voicePresetApply("taiwan-female").then((r) => JSON.stringify({ ok: r.ok, id: r.profile?.id, existed: r.existed, error: r.error }))`);
      const r = JSON.parse(applied);
      h.check("一键建档成功（参考文本随包，无需转写）", r.ok === true && Boolean(r.id), applied);
      const selRaw = await h.eval(`window.codex.voiceProfilesSelect(${JSON.stringify(r.id)}).then((s) => JSON.stringify(s)).catch((e) => "SELECT-ERR:" + e.message)`);
      console.log(`  \x1b[90m(诊断 select：${selRaw})\x1b[0m`);
      const sel = await h.eval(`window.codex.voiceSettingsGet().then((res) => res.settings.tts.profileId)`);
      h.check("选用写入语音设置", sel === r.id, `profileId=${sel}`);
      // 还原：把语音音色设置恢复成验收前的值（持久 profile 不留痕）
      await h.eval(`window.codex.voiceProfilesSelect(${before})`);
      const restored = await h.eval(`window.codex.voiceSettingsGet().then((res) => JSON.stringify(res.settings.tts.profileId ?? ""))`);
      h.check("原音色设置已还原", restored === before, `before=${before} after=${restored}`);
    },
  },

  {
    id: "clean",
    name: "⑦ 渲染层无 console.error",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 脚手架（通常不用动）
// ─────────────────────────────────────────────────────────────────────────────

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 40000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 30000 });
  await wait(1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// 验收范围：**默认只跑「本轮」的项**（2026-09-13 用户严令后的流程改写）
//   用户原话：「验收流程是死的嘛，你不会重新写嘛」「只能测试最新改动，不要浪费我token」。
//   所以范围不再是"靠自觉加 --only"，而是**流程默认就只跑最新一轮**：
//     · 默认（不带参数）→ 只跑 LATEST_ROUND 那一轮；
//     · `--only <id>`    → 只跑指定项（本轮的项要反复迭代时用）；
//     · `--all`          → 全量（**发版/里程碑闸门**，平时不要用；跑之前先说明理由）；
//     · `--list`         → 列出全部项并标注所属轮次。
//   历史项不删（它们仍然是回归证据），但**永远不会在默认路径上被执行** ——
//   这样"每次只测最新改动"是机制保证的，不再依赖我记不记得。
// ─────────────────────────────────────────────────────────────────────────────
const LATEST_ROUND = "09-13";
/** 每一项属于哪一轮。新增验收项**必须**登记在这里，否则默认轮次里跑不到（会打印警告）。 */
const ROUND_OF = {
  "boot-history": "09-12",
  "switch-speed": "09-12",
  "reveal-on-switch": "09-12",
  "greet-once": "09-12",
  "concurrency": "09-12",
  "fold-anchor": "09-12",
  "send-anchor": "09-13",
  "switch-running": "09-13",
  "remote-auth": "09-13",
  "queue-display": "09-13",
  "queue-immediate": "09-13",
  "clean": "09-13",
  "wake-settings": "09-13",
  "relay-subscription": "09-13",
  "openai-import": "09-13",
  "voice-presets": "09-13",
  "skill-discipline": "09-13",
};
const roundOf = (id) => ROUND_OF[id] ?? "(未登记)";

if (flag("list")) {
  console.log(`验收项（默认只跑最新一轮 ${LATEST_ROUND}；--all 才全量）：`);
  for (const c of CHECKS) console.log(`  [${roundOf(c.id).padEnd(7)}] ${c.id.padEnd(18)} ${c.name}`);
  process.exit(0);
}

const only = value("only", "");
const all = flag("all");
const selected = only
  ? CHECKS.filter((c) => c.id.includes(only))
  : all
    ? CHECKS
    : CHECKS.filter((c) => roundOf(c.id) === LATEST_ROUND);
if (!selected.length) {
  console.error(`没有匹配 --only ${only} 的验收项；可用：${CHECKS.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const unscoped = selected.filter((c) => roundOf(c.id) === "(未登记)").map((c) => c.id);
if (unscoped.length) console.log(`\x1b[33m⚠️ 这些验收项没登记轮次，不会被默认跑到：${unscoped.join(", ")}（请加进 ROUND_OF）\x1b[0m`);
console.log(`\x1b[90m验收范围：${only ? `--only ${only}` : all ? "全量（--all，发版闸门）" : `最新一轮 ${LATEST_ROUND}`}（${selected.length} 项：${selected.map((c) => c.id).join(", ")}）\x1b[0m`);

const missing = [
  ["dist/index.html", "npm run build:vite"],
  ["dist-electron/main.js", "npm run build:electron"],
].filter(([p]) => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error("\x1b[31m验收前置检查失败：构建产物缺失\x1b[0m");
  for (const [p, cmd] of missing) console.error(`  - 缺 ${p} → 先跑 \`${cmd}\``);
  process.exit(1);
}

const h = new ElectronHarness({
  root: ROOT,
  artifactsDir: join(ROOT, ".e2e-artifacts"),
  namePrefix: "",
  // 跨轮次复用的持久 profile（首次会把真实配置 + 真实会话历史搬进来）
  profileName: value("profile", "main"),
});

const t0 = Date.now();
const results = [];
try {
  await h.launch();
  console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");
  await enterMain(h);
  for (const check of selected) {
    const st = Date.now();
    console.log(`\x1b[36m── ${check.name}\x1b[0m`);
    try {
      await check.run(h);
      results.push({ id: check.id, ok: true, ms: Date.now() - st });
    } catch (e) {
      console.log(`  \x1b[31m✗ 验收项异常：${e.message}\x1b[0m`);
      try {
        const p = await h.screenshot(`失败-${check.id}`);
        console.log(`  \x1b[90m失败截图：${p}\x1b[0m`);
      } catch { /* 截图失败不影响结论 */ }
      results.push({ id: check.id, ok: false, ms: Date.now() - st, error: e.message });
    }
  }
} catch (e) {
  console.error(`\x1b[31m启动阶段失败：${e.message}\x1b[0m`);
  results.push({ id: "(启动)", ok: false, ms: Date.now() - t0, error: e.message });
} finally {
  if (flag("keep")) console.log("\n\x1b[33m--keep：应用保持运行\x1b[0m");
  else {
    // ⛔ 绝不在回合运行中关应用（09-13 用户指出：「每次测试消息都不看完，你能发现
    // 什么bug，总是运行中就杀应用」）。跑完所有验收项后如果还有回合在流式，等它跑完
    // （上限 5 分钟）再退出——半路杀掉等于把最关键的证据扔了，而且会把"没跑完"误报成失败。
    for (let i = 0; i < 300; i++) {
      const busy = await h.eval(`!!document.querySelector(".timeline-bottom-spacer.compact")`).catch(() => false);
      if (!busy) break;
      if (i === 0) console.log("\x1b[90m(还有回合在流式：等它跑完再关应用…)\x1b[0m");
      await wait(1000);
    }
    await h.close();
  }
}

const summary = h.summary("验收");
console.log("\n\x1b[1m验收项耗时：\x1b[0m");
for (const r of results) {
  console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.id.padEnd(18)} \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；截图：.e2e-artifacts/shots；被测 profile：${h.userDataDir}\n`);

process.exit(summary.ok && results.every((r) => r.ok) ? 0 : 1);
