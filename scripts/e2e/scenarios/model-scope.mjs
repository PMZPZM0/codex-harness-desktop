// scripts/e2e/scenarios/model-scope.mjs
//
// 回归场景：**每个会话独立选模型**（09-11「我切换的模型没生效」两次返工后的定稿）。
//
// 规则只有两条（纯逻辑在 src/lib/model-scope.mjs）：
//   1) 打开会话：该会话自己的记录优先；它还没记录才用全局默认。
//   2) 改全局默认：写全局（新会话用它）；有会话打开时只把这**一个**会话一并改过去。
//
// ⚠ 本场景**必须带真实模型配置**跑：harness 会把用户真实的
//   custom-model.json / custom-models.json / codex-home/{config.toml,model-catalog.json}
//   灌进隔离 profile。否则模型选择器里一个模型都没有，下面「用菜单选一个真实模型」的断言
//   根本无从谈起（只能摆弄假 model id）——那种测试等于没测。
//
// 三层断言：③ 用种值把纯规则钉死在真 openThread 上（不依赖 UI 稳定性）；
//           ④⑤⑥ 走**真实模型菜单**点选，验证真实 id 的隔离性；⑦ 渲染层无报错。

export const name = "model-scope";
export const description = "每个会话独立选模型：真实模型配置下用菜单选模型，会话之间互不串扰";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_A = "custom:e2e-fake:FAKE-A-MODEL";
const FAKE_B = "custom:e2e-fake:FAKE-B-MODEL";
const GLOBAL_SEED = "custom:e2e-fake:GLOBAL-SEED";

// 模型选择器 = .model-controls 里第 1 个 ComposerMenu（第 2 个是「思考」）
const MENU_BTN = ".model-controls .composer-setting";
const MENU_OPEN = ".model-controls .composer-menu.open .composer-menu-pop";
const MENU_OPTION = `${MENU_OPEN} button[role='option']`;

/** 造一个「引擎侧真存在、可 resume、可被启动恢复打开」的会话。
 *  引擎的 rollout 是**首回合**才落盘的：只 thread/start 的会话 resume 报 no rollout found、
 *  也不出现在 thread/list 里（启动恢复就不会打开它）→ 必须补一发 turn/start 坐实。
 *  探查回合故意用一个不存在的模型名：注定失败、不烧额度，但 rollout 已落盘，够用。 */
async function seedThread(h, tag) {
  const cwd = JSON.stringify(process.cwd());
  const id = await h.eval(
    `window.codex.request("thread/start", { model: "e2e-probe-model", cwd: ${cwd} })
       .then(r => (r && r.thread && r.thread.id) || "")`
  );
  h.check(`前置：${tag} 拿到会话 id`, typeof id === "string" && id.length > 0, String(id).slice(0, 40));
  if (typeof id !== "string" || !id) throw new Error(`thread/start（${tag}）未返回 id`);

  await h.eval(
    `window.codex.request("turn/start", {
       threadId: ${JSON.stringify(id)},
       input: [{ type: "text", text: ${JSON.stringify("e2e 探查回合 " + tag)}, text_elements: [] }],
       model: "e2e-probe-model",
       approvalPolicy: "never",
       sandboxPolicy: { type: "dangerFullAccess" },
     }).then(() => "ok").catch(e => "ERR:" + e.message)`
  );
  await wait(2200);

  const listed = await h.eval(
    `window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false })
       .then(r => (r.data || []).some(t => t.id === ${JSON.stringify(id)})).catch(() => false)`
  );
  h.check(`前置：${tag} 出现在 thread/list（启动恢复才会打开它）`, listed === true, `listed=${listed}`);
  return id;
}

/** 重载，等 openThread 把某会话的模型记录写成期望值（拿不到不抛，交给断言给出可读实际值） */
async function reopenAndExpect(h, threadId, want) {
  await h.reload();
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "重载后主界面", timeoutMs: 25000 });
  // 必须等到「会话真的打开」：composer-wrap 脱离 docked-center（空态=欢迎页悬浮输入框）
  // 才算 openThread 完成。只等 localStorage 会在记录早已是期望值时瞬间通过，
  // 而会话还在恢复中 → 随后的发送落空（⑦/⑦bis 假红，09-11 实测）。
  await h
    .waitFor(`(() => { const w = document.querySelector(".composer-wrap"); return !!w && !w.classList.contains("docked-center"); })()`, {
      label: `会话 ${threadId.slice(0, 8)} 真正打开（非欢迎页空态）`,
      timeoutMs: 25000,
    })
    .catch(() => undefined);
  await h
    .waitFor(`localStorage.getItem("thread-model-" + ${JSON.stringify(threadId)}) === ${JSON.stringify(want)}`, {
      label: `openThread 落定 ${want}`,
      timeoutMs: 20000,
    })
    .catch(() => undefined);
  return h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(threadId)})`);
}

/** 打开「模型」下拉 */
async function openModelMenu(h) {
  const hit = await h.eval(`(() => {
    const btn = document.querySelectorAll(${JSON.stringify(MENU_BTN)})[0];
    if (!btn) return "NO_BUTTON";
    btn.click();
    return btn.getAttribute("title") || "clicked";
  })()`);
  h.check("前置：模型选择器可点（选择器没被禁用）", hit !== "NO_BUTTON", String(hit));
  if (hit === "NO_BUTTON") throw new Error("找不到模型选择器");
  await h.waitFor(`!!document.querySelector(${JSON.stringify(MENU_OPEN)})`, { label: "模型菜单展开", timeoutMs: 10000 });
}

/** 菜单选项：title + 是否属于**当前生效供应商**（生效供应商的模型没有小字说明）
 *  必须只在生效供应商里挑：跨供应商的那条走「确认 + 重启应用」分支，测试会被重启打断。 */
async function modelOptions(h) {
  return h.eval(`Array.from(document.querySelectorAll(${JSON.stringify(MENU_OPTION)})).map((b) => ({
    title: ((b.querySelector("strong") || b).innerText || "").trim(),
    active: !b.querySelector("small"),
    selected: b.getAttribute("aria-selected") === "true",
  }))`);
}

/** 点开菜单里第 index 项，返回它的标题 */
async function pickOption(h, index) {
  const title = await h.eval(`(() => {
    const btns = Array.from(document.querySelectorAll(${JSON.stringify(MENU_OPTION)}));
    const b = btns[${index}];
    if (!b) return "";
    const t = ((b.querySelector("strong") || b).innerText || "").trim();
    b.click();
    return t;
  })()`);
  if (!title) throw new Error(`模型菜单里没有第 ${index} 项`);
  await wait(800);
  return title;
}

/** 取「生效供应商」模型在菜单里的下标（保证选的是同供应商，不会触发重启应用） */
async function activeOptionIndexes(h) {
  const opts = await modelOptions(h);
  h.modelMenuOptions = opts;
  return opts.map((o, i) => (o.active ? i : -1)).filter((i) => i >= 0);
}

/** `custom:<provider>:<model>` → 引擎侧的裸模型名 / 供应商 id */
const bareModel = (id) => String(id).split(":").slice(2).join(":");
const providerOf = (id) => String(id).split(":")[1] ?? "";

/**
 * 在已打开的会话里**真发一条消息**，等**真实后端**回话，再从引擎 rollout 里读证据。
 * 「真实生效」的完整判据链：turn_context.model = 引擎接的模型；token_usage_record 带
 * response_id = 真实模型网关真的回了包（09-11 用户指正：只测到引擎接参数不算拉起真实后端）。
 * 让模型只回一个字，省钱省时间；拿到证据立刻打断。
 */
async function sendAndReadEngineModel(h, threadId, { timeoutMs = 120000 } = {}) {
  const before = h.engineModelOf(threadId);
  await h.typeInto(".composer-editor", "e2e 模型生效验证：只回复一个「好」字，不要做任何其他事");
  await h.waitFor(`(document.querySelector(".composer-editor")?.innerText || "").includes("e2e 模型生效验证")`, {
    label: "文本已进输入框",
    timeoutMs: 8000,
  });
  await h.click(".send-button");
  // 等**真实后端**回包：新回合落盘 + token_usage_record（网关 response_id）出现。
  // 出现 error/stream_error 就早停早红（401 = Key 没带上，模型不存在 = 供应商不认）。
  const t0 = Date.now();
  let info = h.engineModelOf(threadId);
  while (Date.now() - t0 < timeoutMs) {
    info = h.engineModelOf(threadId);
    if (info.errors.length > before.errors.length) break;
    if (info.turns > before.turns && info.backendResponses.length > before.backendResponses.length) break;
    await wait(1000);
  }
  // 别把真实回复跑完（省钱省时间）：拿到证据就打断
  await h
    .eval(`window.codex.request("turn/interrupt", { threadId: ${JSON.stringify(threadId)} }).then(() => "ok").catch(e => "ERR:" + e.message)`)
    .catch(() => undefined);
  return { before, after: info };
}

export const steps = [
  {
    name: "① 跳过引导进入主界面（真实模型配置已灌入）",
    run: async (h) => {
      // 前置：真实模型配置真的灌进去了，否则后面全是空配置上的假通过
      h.check(
        "前置：已灌入真实模型配置（custom-model.json + config.toml）",
        Boolean(h.realConfig?.ok),
        h.realConfig ? `${h.realConfig.copied.join(" · ")} ← ${h.realConfig.src}` : "无"
      );
      h.check(
        "前置：config.toml 是从真实目录复制来的（不是空壳）",
        (h.realConfig?.copied ?? []).includes("codex-home/model-catalog.json"),
        JSON.stringify(h.realConfig?.copied ?? [])
      );
      // 真实后端测试的前提：Key 密文 + 解密密钥材料都在。缺一个，后面的
      // 「真实后端回话」断言必然 401 —— 这里先红，别让根因藏到 ⑦ 才暴露。
      const seededArchive = (() => { try { return JSON.parse(readFileSync(join(h.userDataDir, "custom-model.json"), "utf8")); } catch { return {}; } })();
      h.check("前置：encryptedKey 已保留（Key 密文进隔离 profile）", Boolean(seededArchive.encryptedKey), seededArchive.encryptedKey ? `密文 ${String(seededArchive.encryptedKey).length} 字符` : "缺失");
      h.check("前置：Local State 已复制（safeStorage 解密密钥材料）", existsSync(join(h.userDataDir, "Local State")), h.realConfig?.copied.join(" · ") ?? "");

      // 引导页可能被自动跳过：真实配置灌入后 custom-model.json 带可用 Key
      // （hasKey=true），App.tsx:7754 的兼容 effect 会**自动进入主界面**（写 login-skipped），
      // 引导页的「暂时不登录，直接进入」按钮随即消失。两种落点都接受，进主界面即算通过。
      await h.waitFor(
        `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
        { label: "引导页或主界面出现", timeoutMs: 30000 }
      );
      h.check("前置：已到引导页或已自动进入主界面", true);
      if (await h.exists(".login-skip")) {
        await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
      }
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });

      await wait(1800);
      h.check("主界面已挂载", true);
      await h.screenshot("主界面");
    },
  },

  {
    name: "② 造两个真实会话 + 确认选择器里有真实模型",
    run: async (h) => {
      h.threadA = await seedThread(h, "A");
      h.threadB = await seedThread(h, "B");
      h.check("前置：两个会话 id 不同", h.threadA !== h.threadB, `${h.threadA} vs ${h.threadB}`);

      // 真实模型配置是否真的进了 UI：打开选择器数一数生效供应商的模型
      await openModelMenu(h);
      const activeIdx = await activeOptionIndexes(h);
      await pickOption(h, activeIdx[0]); // 顺手关掉菜单（点第一项 = 当前项，无副作用）
      h.check(
        "前置：模型选择器里 ≥2 个真实模型可用（生效供应商）",
        activeIdx.length >= 2,
        `生效供应商模型 ${activeIdx.length} 个，菜单共 ${h.modelMenuOptions.length} 项：${h.modelMenuOptions.slice(0, 4).map((o) => o.title).join(", ")}`
      );
      h.check(
        "前置：菜单里没有 e2e 假模型（确认用的是真实配置）",
        !h.modelMenuOptions.some((o) => /e2e/i.test(o.title)),
        h.modelMenuOptions.map((o) => o.title).slice(0, 6).join(", ")
      );
      await h.screenshot("已建两个会话");
    },
  },

  {
    name: "③ 纯规则钉在真 openThread 上：有记录不被冲掉 / 没记录落全局默认",
    run: async (h) => {
      await h.eval(`(() => {
        localStorage.setItem("default-model", ${JSON.stringify(GLOBAL_SEED)});
        localStorage.setItem("thread-model-" + ${JSON.stringify(h.threadA)}, ${JSON.stringify(FAKE_A)});
        localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)});
        return true;
      })()`);
      const seeded = await h.eval(`(() => ({
        g: localStorage.getItem("default-model"),
        a: localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)}),
        last: localStorage.getItem("last-thread"),
      }))()`);
      h.check(
        "前置：全局与会话记录已按预期种好且互不相同",
        seeded.g === GLOBAL_SEED && seeded.a === FAKE_A && seeded.last === h.threadA,
        JSON.stringify(seeded)
      );

      const kept = await reopenAndExpect(h, h.threadA, FAKE_A);
      h.check("会话有记录 → 打开后仍是它自己的模型（不被全局默认覆盖）", kept === FAKE_A, `实际 ${kept}`);
      const g1 = await h.eval(`localStorage.getItem("default-model")`);
      h.check("打开会话不改写全局默认", g1 === GLOBAL_SEED, `实际 ${g1}`);

      // 反向：该会话没有记录时，必须落到全局默认（新会话要能拿到默认）
      await h.eval(`(() => {
        localStorage.removeItem("thread-model-" + ${JSON.stringify(h.threadA)});
        localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)});
        return true;
      })()`);
      const gone = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      h.check("前置：A 的会话记录确实不存在了", gone === null, String(gone));
      const fell = await reopenAndExpect(h, h.threadA, GLOBAL_SEED);
      h.check("会话没记录 → 用全局默认", fell === GLOBAL_SEED, `实际 ${fell}`);
      await h.screenshot("纯规则两个方向");
    },
  },

  {
    name: "④ 会话 A：用真实模型菜单选一个模型（不许动全局默认）",
    run: async (h) => {
      await h.eval(`(() => {
        localStorage.setItem("thread-model-" + ${JSON.stringify(h.threadA)}, ${JSON.stringify(FAKE_A)});
        localStorage.setItem("default-model", ${JSON.stringify(GLOBAL_SEED)});
        localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)});
        return true;
      })()`);
      await reopenAndExpect(h, h.threadA, FAKE_A);
      h.check("前置：A 已打开且当前是假模型（下一步的写入才看得出变化）", (await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`)) === FAKE_A);

      await openModelMenu(h);
      const activeIdx = await activeOptionIndexes(h);
      // 前置：至少 2 个生效供应商模型，才能让 A / B 选到**不同**的真实模型
      h.check("前置：生效供应商有 ≥2 个模型可选", activeIdx.length >= 2, `active=${activeIdx.length}`);
      if (activeIdx.length < 2) throw new Error("生效供应商可用模型不足 2 个，无法验证「两个会话各选各的」");
      const titleA = await pickOption(h, activeIdx[0]);

      const modelA = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      h.modelA = modelA;
      h.check("A 的会话记录变成真实模型 id（custom:<provider>:<model>）", /^custom:[^:]+:.+/.test(String(modelA)) && !/e2e/i.test(String(modelA)), `实际 ${modelA}（菜单项「${titleA}」）`);
      const g = await h.eval(`localStorage.getItem("default-model")`);
      h.check("在会话里选模型 → 全局默认不变（作用域没串）", g === GLOBAL_SEED, `实际 ${g}`);
      await h.screenshot("A 选了真实模型");
    },
  },

  {
    name: "⑤ 会话 B：选另一个真实模型 → 两边各记各的，互不影响",
    run: async (h) => {
      await h.eval(`(() => {
        localStorage.setItem("thread-model-" + ${JSON.stringify(h.threadB)}, ${JSON.stringify(FAKE_B)});
        localStorage.setItem("last-thread", ${JSON.stringify(h.threadB)});
        return true;
      })()`);
      await reopenAndExpect(h, h.threadB, FAKE_B);
      const aBefore = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);

      await openModelMenu(h);
      const activeIdx = await activeOptionIndexes(h);
      const titleB = await pickOption(h, activeIdx[1]);

      const modelB = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadB)})`);
      h.modelB = modelB;
      h.check("B 的会话记录变成真实模型 id", /^custom:[^:]+:.+/.test(String(modelB)) && !/e2e/i.test(String(modelB)), `实际 ${modelB}（菜单项「${titleB}」）`);
      h.check("A 在打开 B 之前没有被改过（延续 ④ 的结果）", aBefore === h.modelA, `④ 后 ${h.modelA}，开 B 前 ${aBefore}`);
      h.check("两个会话拿到的是**不同**的真实模型（各选各的）", Boolean(modelB) && modelB !== h.modelA, `A=${h.modelA} B=${modelB}`);
      const aAfter = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      h.check("打开 B 选模型 → A 的记录原样不动", aAfter === aBefore, `A 之前 ${aBefore}，现在 ${aAfter}`);
      const g = await h.eval(`localStorage.getItem("default-model")`);
      h.check("在会话里选模型 → 全局默认仍不变", g === GLOBAL_SEED, `实际 ${g}`);
      await h.screenshot("B 选了另一个真实模型，A 未受影响");
    },
  },

  {
    name: "⑥ 回欢迎页选模型 = 改全局默认：只动全局，两个会话都不动",
    run: async (h) => {
      await h.clickByText("新建任务");
      const onWelcome = await h.waitFor(`!!document.querySelector(".welcome-state")`, { label: "回到欢迎页", timeoutMs: 15000 }).then(() => true).catch(() => false);
      h.check("前置：已回到欢迎页（当前没有打开的会话）", onWelcome, onWelcome ? "" : await h.bodyText(160));

      const aBefore = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      const bBefore = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadB)})`);

      await openModelMenu(h);
      const activeIdx = await activeOptionIndexes(h);
      const title = await pickOption(h, activeIdx[1]);

      const g = await h.eval(`localStorage.getItem("default-model")`);
      h.check("欢迎页选模型 → 全局默认变成那个真实模型", g === h.modelB && /^custom:[^:]+:.+/.test(String(g)), `实际 ${g}（菜单项「${title}」）`);
      const aAfter = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      const bAfter = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadB)})`);
      h.check("改全局默认 → A 的会话记录不动（会话独立）", aAfter === aBefore, `A 之前 ${aBefore}，现在 ${aAfter}`);
      h.check("改全局默认 → B 的会话记录不动（会话独立）", bAfter === bBefore, `B 之前 ${bBefore}，现在 ${bAfter}`);
      await h.screenshot("欢迎页改全局默认未波及会话");
    },
  },

  {
    name: "⑦ 真实生效：各会话发的回合，引擎真跑了自己那个模型",
    run: async (h) => {
      const wantA = bareModel(h.modelA);
      const wantB = bareModel(h.modelB);
      const provA = providerOf(h.modelA);
      const provB = providerOf(h.modelB);

      // ── A：打开 A（它记着 modelA）→ 真发一条 → 引擎这一回合必须真跑 modelA ──
      await h.eval(`localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)})`);
      await reopenAndExpect(h, h.threadA, h.modelA);
      const a = await sendAndReadEngineModel(h, h.threadA);
      h.check(
        "前置：A 的回合数真的增加了（消息确实发出去了）",
        a.after.turns > a.before.turns,
        `回合数 ${a.before.turns} → ${a.after.turns}（file=${a.after.file ? a.after.file.split(/[\\/]/).pop() : "无 rollout"}）`
      );
      h.check("A 发出的回合，引擎真跑的是 A 选的模型（切换真实生效）", a.after.turnModel === wantA, `期望 ${wantA}，引擎实际 ${a.after.turnModel}`);
      h.check("A 的会话级模型设置也被引擎接受（thread_settings_applied）", a.after.settingsModel === wantA, `期望 ${wantA}，引擎记录 ${a.after.settingsModel}`);
      h.check("A 的会话绑定供应商与所选模型一致", a.after.provider === provA, `期望 ${provA}，引擎记录 ${a.after.provider}`);
      h.check(
        "前置：真实后端回了话（token_usage_record 带网关 response_id）",
        a.after.backendResponses.length > a.before.backendResponses.length,
        `后端响应 ${a.before.backendResponses.length} → ${a.after.backendResponses.length}，最新 output=${a.after.backendResponses.at(-1)?.outputTokens} tokens`
      );
      h.check("A 的回合无后端/流错误（401、模型不存在等）", a.after.errors.length === a.before.errors.length, a.after.errors.map((e) => `${e.type}:${e.message}`).join(" ｜ ") || "无");
      await h.screenshot("A 引擎侧真实生效");

      // ── B：切到 B（它记着 modelB）→ 真发一条 → 引擎必须跑 modelB，且 A 的 rollout 不动 ──
      const aTurnsBeforeB = h.engineModelOf(h.threadA).turns;
      await h.eval(`localStorage.setItem("last-thread", ${JSON.stringify(h.threadB)})`);
      await reopenAndExpect(h, h.threadB, h.modelB);
      const b = await sendAndReadEngineModel(h, h.threadB);
      h.check("前置：B 的回合数真的增加了", b.after.turns > b.before.turns, `回合数 ${b.before.turns} → ${b.after.turns}`);
      h.check("B 发出的回合，引擎真跑的是 B 选的模型（与 A 不同）", b.after.turnModel === wantB, `期望 ${wantB}，引擎实际 ${b.after.turnModel}`);
      h.check(
        "B 也是真实后端回的话（与 A 不同供应商响应链）",
        b.after.backendResponses.length > b.before.backendResponses.length && b.after.errors.length === b.before.errors.length,
        `后端响应 ${b.before.backendResponses.length} → ${b.after.backendResponses.length}，最新 output=${b.after.backendResponses.at(-1)?.outputTokens} tokens`
      );
      h.check(
        "两个会话在引擎侧跑的确实是两个不同模型（会话独立生效）",
        b.after.turnModel !== a.after.turnModel,
        `A 跑 ${a.after.turnModel}，B 跑 ${b.after.turnModel}`
      );

      const aAfter = h.engineModelOf(h.threadA);
      h.check("在 B 里发消息，不会给 A 追加回合（互不串扰）", aAfter.turns === aTurnsBeforeB, `A 回合数 ${aTurnsBeforeB} → ${aAfter.turns}`);
      h.check("A 的 rollout 里从未出现过 B 的模型", !aAfter.turnModels.includes(wantB), `A 跑过：${aAfter.turnModels.join(", ")}`);
      await h.screenshot("B 引擎侧真实生效，A 未受影响");
    },
  },

  {
    name: "⑦bis 同会话内把下拉改到另一个真实模型 = 下一轮立刻生效",
    run: async (h) => {
      // 用户实测场景（09-11 第三次反馈）：会话正在用真模型 A，在下拉里改成真模型 B 后
      // **下一条消息**就得用 B。「要重开会话 / 重开应用才生效」= 不达标。
      // 判据仍然取引擎 rollout 的 turn_context.model —— 下拉/记录只是意图。
      const wantNow = bareModel(h.modelB);
      await h.eval(`localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)})`);
      await reopenAndExpect(h, h.threadA, h.modelA);

      await openModelMenu(h);
      const activeIdx = await activeOptionIndexes(h);
      const opts = h.modelMenuOptions;
      const targetIdx = activeIdx.find((i) => String(opts[i].title).includes(wantNow));
      h.check(
        "前置：菜单里能找到一个**同供应商**的另一个真实模型（跨供应商会触发重启）",
        targetIdx !== undefined,
        `目标 ${wantNow}，可选：${activeIdx.map((i) => opts[i].title).join(" / ")}`
      );
      if (targetIdx === undefined) throw new Error("找不到可切换的同供应商真实模型");
      const title = await pickOption(h, targetIdx);

      const rec = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(h.threadA)})`);
      h.check("改下拉后，会话记录立刻变成新模型", rec === h.modelB, `期望 ${h.modelB}，实际 ${rec}（菜单项「${title}」）`);
      await h.screenshot("改下拉立刻换模型");

      const a = await sendAndReadEngineModel(h, h.threadA);
      h.check("前置：切换后的回合真的发出去了", a.after.turns > a.before.turns, `回合数 ${a.before.turns} → ${a.after.turns}`);
      h.check("改了下拉后的下一轮，引擎真跑新模型（立刻生效）", a.after.turnModel === wantNow, `期望 ${wantNow}，引擎实际 ${a.after.turnModel}`);
      h.check("引擎侧会话模型设置同步成新模型", a.after.settingsModel === wantNow, `期望 ${wantNow}，引擎记录 ${a.after.settingsModel}`);
      h.check("新回合没有继续用旧模型", a.after.turnModel !== bareModel(h.modelA), `旧模型 ${bareModel(h.modelA)}，本轮 ${a.after.turnModel}`);
      h.check(
        "换模型后的这一轮，也是真实后端回的话",
        a.after.backendResponses.length > a.before.backendResponses.length && a.after.errors.length === a.before.errors.length,
        `后端响应 ${a.before.backendResponses.length} → ${a.after.backendResponses.length}，最新 output=${a.after.backendResponses.at(-1)?.outputTokens} tokens`
      );
      // 供应商档案（custom-model.json 顶层 model）必须跟着选择走：模型被问「你是什么模型」
      // 时会读这个文件自查，不同步它就会自报旧模型（09-11 用户实测误判「切换没生效」的根源）
      const archive = JSON.parse(readFileSync(join(h.userDataDir, "custom-model.json"), "utf8"));
      h.check("供应商档案的当前模型已同步成新选择", archive.model === wantNow, `期望 ${wantNow}，档案实际 ${archive.model}`);
      // 100% 同步：config.toml 顶层 model 也要一并对齐（apply:true 一次性写齐）
      const cfgText = readFileSync(join(h.userDataDir, "codex-home", "config.toml"), "utf8");
      const cfgModel = /^\s*model\s*=\s*"([^"]*)"/m.exec(cfgText)?.[1] ?? "";
      h.check("config.toml 顶层 model 已同步成新选择", cfgModel === wantNow, `期望 ${wantNow}，config.toml 实际 ${cfgModel}`);
      await h.screenshot("切换后引擎侧跑新模型");
    },
  },

  {
    name: "⑦ter 打开另一个会话 = 档案跟着该会话的模型走（自查不撒谎）",
    run: async (h) => {
      // 「当前模型」档案只有一份，而会话各自记各自的模型 —— 打开哪个会话，档案就得是哪个
      // 会话的模型，否则在那个会话里问「你是什么模型」又会得到旧答案。
      const wantOpen = bareModel(h.modelA); // deepseek
      await h.eval(`(() => {
        localStorage.setItem("thread-model-" + ${JSON.stringify(h.threadA)}, ${JSON.stringify(h.modelA)});
        localStorage.setItem("last-thread", ${JSON.stringify(h.threadA)});
        return true;
      })()`);
      const shown = await reopenAndExpect(h, h.threadA, h.modelA);
      h.check("前置：会话打开后显示它自己的模型", shown === h.modelA, `实际 ${shown}`);
      await wait(1200); // 档案同步是异步落盘
      const archive = JSON.parse(readFileSync(join(h.userDataDir, "custom-model.json"), "utf8"));
      h.check("打开会话后，供应商档案已对齐该会话的模型", archive.model === wantOpen, `期望 ${wantOpen}，档案实际 ${archive.model}`);
      const cfgText = readFileSync(join(h.userDataDir, "codex-home", "config.toml"), "utf8");
      const cfgModel = /^\s*model\s*=\s*"([^"]*)"/m.exec(cfgText)?.[1] ?? "";
      h.check("config.toml 顶层 model 一并对齐", cfgModel === wantOpen, `期望 ${wantOpen}，config.toml 实际 ${cfgModel}`);
      await h.screenshot("打开会话档案对齐");
    },
  },

  {
    name: "⑧ 无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
