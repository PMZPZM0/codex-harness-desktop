/**
 * 指挥中枢（原 BOSS 群）—— **运行态**压测：真建群、真派活、真起 CLI 子进程。
 *
 * ⛔ 用 electron 跑（不是 node）：state/store/runner 是主进程代码，store 依赖 app.getPath。
 * ⛔ 引擎用**假 server**：本脚本只验证宿主侧编排（派活/交活/审查/打回/回投/并发），
 *    不验证模型质量 —— 那需要真模型，属另一类测试。假 server 按真实协议回 thread/turn/queue。
 * ⛔ CLI 成员是**真子进程**（node -e / 脚本文件），因此能验证命令行这条路径真的通。
 *
 * 用法（先 npm run build:electron）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/stress-boss-groups.cjs
 * ⛔ 它只碰临时目录（os.tmpdir()），不读也不写你的真实 boss-groups.json。
 */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist-electron");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "boss-live-"));
const WS = path.join(TMP, "workspace");
fs.mkdirSync(WS, { recursive: true });

app.disableHardwareAcceleration();
app.setPath("userData", path.join(TMP, "userData"));
try { fs.mkdirSync(path.join(TMP, "userData"), { recursive: true }); } catch { }

const log = [];
function say(line) { log.push(line); console.log(line); }
const t0 = Date.now();
const ms = () => Date.now() - t0;

app.whenReady().then(async () => {
  /* ── 假引擎：实现 runner 真正会用到的四个方法 + 事件总线 ───────────────── */
  let seq = 0;
  const listeners = new Set();
  const turns = new Map();          // turnId -> { threadId, text }
  let engineDelay = 8;              // 模拟引擎出活耗时
  const fakeServer = {
    request: async (method, params) => {
      switch (method) {
        case "thread/start": return { thread: { id: `th_${++seq}` } };
        case "thread/resume": return { thread: { id: params?.threadId } };
        case "thread/name/set": return {};
        case "thread/queue/add": return { id: `q_${++seq}` };
        case "thread/queue/list": return { data: [{ id: `q_${seq}` }] };
        case "thread/queue/start": return {};
        case "turn/start": {
          const turnId = `tu_${++seq}`;
          const text = String(params?.input?.[0]?.text ?? "");
          turns.set(turnId, { threadId: params.threadId, text });
          setTimeout(() => {
            const evt = { kind: "notification", method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, items: [{ type: "agentMessage", text: `【成品】${text.slice(0, 40)}…` }] } } };
            for (const fn of listeners) { try { fn(evt); } catch { } }
          }, engineDelay);
          return { turn: { id: turnId } };
        }
        default: return {};
      }
    },
    on: (event, fn) => { if (event === "event") listeners.add(fn); },
    off: (event, fn) => { if (event === "event") listeners.delete(fn); },
    emit: () => { },
  };

  /* ⛔ runner 从 "../main" 取 bridgeDial（那是 1200 行的启动壳，直接 require 会跑整个应用）。
     用 require.cache 先塞一个同路径的替身，只导出 bridgeDial。 */
  const refs = require(path.join(DIST, "runtime-refs.js"));
  refs.setServer(fakeServer);
  const mainPath = require.resolve(path.join(DIST, "main.js"));
  require.cache[mainPath] = { id: mainPath, filename: mainPath, loaded: true, exports: { bridgeDial: (_p, url) => url } };

  const state = require(path.join(DIST, "boss-groups/state.js"));
  const runner = require(path.join(DIST, "boss-groups/runner.js"));
  const store = require(path.join(DIST, "boss-groups/store.js"));

  const events = [];
  runner.setBossEventSink((payload) => events.push(payload));

  /* ── ① 真建群 ─────────────────────────────────────────────────────────── */
  const created = await runner.createGroupForBoss({
    name: "压测指挥部",
    workspace: WS,
    bossThreadId: "boss_live_1",
    members: [
      { name: "前端小张", role: "前端", model: "fake-model" },
      { name: "后端小李", role: "后端", model: "fake-model" },
    ],
    policy: { maxRejects: 2, budgetMinutes: 10_000, stallMs: 60_000 },
  });
  const groupId = created.group.group.id;
  say(`① 建群 OK：${groupId} / 成员 ${created.group.group.members.map((m) => `${m.name}(${m.source})`).join("、")}`);

  /* ── ② 真拉 CLI agent（走 memberForBoss 的 from="cli" 分支）────────────── */
  const cliScript = path.join(WS, "fake-cli-agent.js");
  fs.writeFileSync(cliScript, [
    "const prompt = process.argv[2] || '';",
    "const title = (prompt.match(/标题：(.+)/) || [])[1] || '（无标题）';",
    "console.log('CLI-AGENT 报告');",
    "console.log('- 收到的任务：' + title);",
    "console.log('- 提示词长度：' + prompt.length);",
    "console.log('- 结论：已按要求产出（这是一段真实子进程输出）');",
  ].join("\n"), "utf8");

  const cliMember = await runner.memberForBoss({
    action: "add", groupId, from: "cli",
    cliName: "node-fake", name: "命令行阿飞", role: "本机 CLI agent",
    cliCommand: `node "${cliScript}" "{prompt}"`,
  });
  say(`② 真拉 CLI agent：${cliMember.ok ? "OK" : "失败 — " + cliMember.error} / member=${cliMember.member?.id ?? "-"} source=${cliMember.member?.source ?? "-"}`);

  /* ── ③ 真派活：引擎成员 + CLI 成员各一条 ─────────────────────────────── */
  const tEngine = await runner.addTaskForBoss({ groupId, title: "引擎成员做活", brief: "随便做", criteria: "有成品" });
  let cliTaskId = null;
  {
    const s = store.bossStore.get();
    const task = state.addTask(s, { groupId, title: "CLI 成员做活", brief: "让命令行 agent 交报告", criteria: "报告含结论" });
    store.bossStore.save();
    cliTaskId = task.id;
    const r = await runner.dispatchTask(task.id, { memberId: cliMember.member.id });
    say(`③ CLI 派活：${r.ok ? "已派" : "失败 — " + r.error}`);
  }
  say(`③ 引擎派活：${tEngine.dispatched ? "已派" : "失败 — " + tEngine.error}`);

  await new Promise((r) => setTimeout(r, 900));   // 等引擎假回合 + CLI 子进程

  const afterDispatch = state.snapshot(store.bossStore.get(), groupId);
  const cliTask = afterDispatch.tasks.find((t) => t.id === cliTaskId);
  const engTask = afterDispatch.tasks.find((t) => t.id === tEngine.taskId);
  say(`④ 引擎任务状态=${engTask?.status}（期望 reviewing）/ CLI 任务状态=${cliTask?.status}（期望 reviewing）`);
  const cliChat = afterDispatch.events.filter((e) => e.kind === "chat-member");
  const cliEvent = cliChat.find((e) => String(e.text).includes("CLI-AGENT 报告"));
  say(`④ CLI 成品进群流：${cliEvent ? "YES" : "NO"}；片段=${cliEvent ? JSON.stringify(String(cliEvent.text).slice(0, 80)) : "-"}`);

  /* ── ⑤ 注入实验：验收标准里塞重定向，看 shell 会不会真的执行（判据 = 副作用文件）── */
  {
    const injected = path.join(WS, "INJECTED_MARKER.txt");
    try { fs.unlinkSync(injected); } catch { }
    const s = store.bossStore.get();
    const evil = state.addTask(s, {
      groupId, title: "注入实验",
      brief: `x & echo PWNED> "${injected}" & rem`,
      criteria: `c & echo PWNED2>> "${injected}"`,
    });
    store.bossStore.save();
    const quietScript = path.join(WS, "quiet-agent.js");
    fs.writeFileSync(quietScript, "console.log('quiet-agent: 收到 ' + String(process.argv[2] || '').length + ' 字');", "utf8");
    const quiet = await runner.memberForBoss({
      action: "add", groupId, from: "cli", cliName: "quiet", name: "静默命令行", role: "本机 CLI agent",
      cliCommand: `node "${quietScript}" "{prompt}"`,
    });
    await runner.dispatchTask(evil.id, { memberId: quiet.member.id });
    await new Promise((r) => setTimeout(r, 1200));
    const snap = state.snapshot(store.bossStore.get(), groupId);
    const t = snap.tasks.find((x) => x.id === evil.id);
    say(`⑤ 注入实验：任务状态=${t?.status}；副作用文件被创建=${fs.existsSync(injected) ? "YES（存在命令注入）" : "NO（已被净化挡住）"}`);
  }

  /* ── ⑥ 压测：并发派 40 条任务（3 个成员抢），看会不会破并发/丢成品 ────── */
  {
    const s = store.bossStore.get();
    const created2 = [];
    for (let i = 0; i < 40; i++) {
      created2.push(state.addTask(s, { groupId, title: `压测活 ${i}`, brief: "", criteria: `标准 ${i}` }));
    }
    store.bossStore.save();
    const t = Date.now();
    const results = await Promise.all(created2.map((task) => runner.dispatchTask(task.id)));
    const dispatched = results.filter((r) => r.ok).length;
    const firstErr = results.find((r) => !r.ok)?.error ?? "-";
    say(`⑥ 并发派活：40 条 → 成功 ${dispatched} 条（= 空闲成员数）/ 排队 ${40 - dispatched} 条 / 耗时 ${Date.now() - t}ms`);
    say(`⑥ 排队任务给出的原因示例：${firstErr}`);
    await new Promise((r) => setTimeout(r, 2500));
    const snap = state.snapshot(store.bossStore.get(), groupId);
    const reviewing = snap.tasks.filter((x) => x.title.startsWith("压测活") && x.status === "reviewing").length;
    say(`⑥ 压测结果：reviewing=${reviewing}/${dispatched}（等于派活成功数说明成品都收回来了）`);
    // 并发唯一性体检
    const perMember = new Map();
    for (const task of Object.values(store.bossStore.get().tasks)) {
      if (task.groupId !== groupId || task.status !== "running") continue;
      perMember.set(task.assignee, (perMember.get(task.assignee) ?? 0) + 1);
    }
    say(`⑥ 单成员并发 running 最大值 = ${Math.max(0, ...perMember.values())}（必须 ≤ 1）`);
  }

  /* ── ⑦ 打回 → 换人 → 超限升级（真状态机跑真账本）─────────────────────── */
  {
    const snap0 = state.snapshot(store.bossStore.get(), groupId);
    const target = snap0.tasks.find((x) => x.status === "reviewing");
    if (target) {
      let rejects = 0;
      for (let i = 0; i < 4; i++) {
        const s = store.bossStore.get();
        const task = s.tasks[target.id];
        if (!task || task.status === "escalated" || task.status === "done") break;
        const member = s.groups[groupId].members.find((m) => m.id === task.assignee);
        const review = state.recordReview(s, target.id, { by: "boss", verdict: "rejected", reasons: [`第 ${i + 1} 次：不达标`] });
        store.bossStore.save();
        rejects = review.rejects;
        if (review.status === "rejected") {
          const next = state.pickReassignee(s, review);
          if (next) { await runner.dispatchTask(target.id, { memberId: next.id }); await new Promise((r) => setTimeout(r, 400)); }
        }
        if (review.status === "escalated") {
          say(`⑦ 打回 ${rejects} 次 ⇒ escalated（成员「${member?.name}」被锁，选项=${review.escalation?.options.join("/")}）`);
          break;
        }
      }
    } else {
      say("⑦ 跳过（没有 reviewing 的任务）");
    }
  }

  /* ── ⑧ 落盘：json 是否可解析、原子写有没有留下 .tmp ───────────────────── */
  await store.bossStore.flush();
  const file = path.join(TMP, "userData", "boss-groups.json");
  const ok = fs.existsSync(file);
  let parsed = null;
  if (ok) { try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { } }
  say(`⑧ 落盘：文件${ok ? "存在" : "缺失"}、JSON${parsed ? "可解析" : "坏了"}、残留 .tmp=${fs.existsSync(`${file}.tmp`) ? "有" : "无"}`);
  say(`⑧ 群数=${parsed ? Object.keys(parsed.groups).length : 0} / 任务数=${parsed ? Object.keys(parsed.tasks).length : 0} / 事件数=${parsed ? parsed.events.length : 0}`);

  say(`⑨ 宿主事件广播共 ${events.length} 条；总耗时 ${ms()}ms`);
  say(`TMP=${TMP}`);

  fs.writeFileSync(path.join(TMP, "report.txt"), log.join("\n"), "utf8");
  console.log("\n===== 报告 =====");
  console.log(log.join("\n"));
  app.exit(0);
}).catch((error) => {
  console.error("harness failed:", error);
  app.exit(1);
});
