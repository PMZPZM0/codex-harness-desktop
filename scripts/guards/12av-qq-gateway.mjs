/**
 * QQ 机器人网关守卫（11-03 用户：「QQ 机器人连接不上」；11-04 审查补第二层根因 + 四条连带缺陷）。
 *
 * 连不上有两层根因（都实测/官方文档核对过，缺一层仍连不上）：
 *   ① token 接口写在了 api.sgroup.qq.com（POST 404「不支持的调用」）——官方 2026 统一地址是
 *      https://api.bot.qq.com（文档「API 调用指南」），gateway 与 /v2 消息接口同域。
 *   ② intents 多订了 1<<12（DIRECT_MESSAGE＝**频道**私信，与群聊@/单聊无关）。文档「事件订阅 Intents」
 *      写明「鉴权时传递了无权限的 intents，websocket 会报错并直接关闭连接」，错误码表里
 *      4014「intent 无权限」两列都是「不可重试」。
 * 四条连带缺陷（11-04 审查抓到）：
 *   ③ 发送接口用 `retcode/code` 判失败——成功响应里没有这两个字段 ⇒ 每条成功的回复都报「发送失败」；
 *   ④ 重连不摘旧 socket ⇒ 长连接越叠越多（超官方最大连接数吃 4008，且消息成倍重复）；
 *   ⑤ 新 session 沿用上一条连接的 seq ⇒ 心跳被服务端判 seq 错误（4007）反复断连；
 *   ⑥ socket 一 open 就当「已连接」并落盘——鉴权没过时后台根本不下发事件，用户看到的是
 *      「卡片说已绑定、状态页说没连上、还什么都查不到原因」。
 *
 * 判据分两层：**行为断言跑构建产物**（真 require dist-electron/qq-gateway.js + 桩 fetch +
 * 本机 ws 服务当网关，读客户端**真正发出**的 op2 帧）——③⑥ 与 intents 取值静态正则看不出来；
 * 结构断言只钉剩下的不变量。
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** ⛔ 负向断言必须先剥注释：注释里原样写着旧地址、旧字段名与 `1 << 12`，裸正则必假红 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");
const src = readFileSync(join(ROOT, "electron", "qq-gateway.ts"), "utf8");
const code = stripComments(src);

let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 一、行为断言：跑构建产物 ----------
const artifact = join(ROOT, "dist-electron", "qq-gateway.js");
if (!existsSync(artifact)) {
  ok(false, "构建产物存在（dist-electron/qq-gateway.js —— 先 npm run build:electron 再跑本守卫）");
} else {
  // ⛔ 临时目录跑真实现（与【145】同款口径）：守卫不许碰用户真实 qq-account.json
  const userData = mkdtempSync(join(tmpdir(), "qq-guard-"));
  process.env.CODEX_HARNESS_USER_DATA = userData;
  const accountFile = join(userData, "qq-account.json");
  const require_ = createRequire(import.meta.url);
  const { QqGateway } = require_(artifact);
  const { WebSocketServer } = require_("ws");

  const calls = [];
  const identifyFrames = [];
  let lastSock = null;
  let wsUrl = "";
  /** 鉴权通过回执（文档「WebSocket 方式」的 Ready Event 形态） */
  const READY_FRAME = JSON.stringify({ op: 0, s: 1, t: "READY", d: { session_id: "s1", user: { id: "1" } } });
  /** 服务端对 op2 的反应："ready" = 鉴权通过并下发 READY；"hold" = 先不发（验「open 不等于连上」）；数字 = 用该关闭码踢掉连接 */
  let identifyReply = "ready";
  /** "hold" 模式下服务端把 READY 扣住；守卫调这个函数才放行（用来验「open ≠ 连上」） */
  let releaseReady = () => {};
  /** 桩：按官方口径造响应——成功 = 直接返回业务数据（**没有** err_code / code 字段） */
  const stubFetch = async (url, init) => {
    const link = String(url);
    calls.push({ url: link, body: init?.body ? JSON.parse(String(init.body)) : null, auth: init?.headers?.Authorization ?? "" });
    if (link.includes("/app/getAppAccessToken")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "AT-test", expires_in: 7200 }) };
    }
    if (link.includes("/gateway")) return { ok: true, status: 200, json: async () => ({ url: wsUrl }) };
    if (link.includes("/messages")) {
      return link.includes("/FAIL/")
        ? { ok: false, status: 400, json: async () => ({ err_code: 40034005, message: "回复消息msg_id已过期", trace_id: "t" }) }
        : { ok: true, status: 200, json: async () => ({ id: "ROBOT1.0_x", timestamp: "2026-11-04T10:00:00+08:00" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch;

  // 本机假网关：连接后先发 Hello，收到 op2 后按 identifyReply 决定放行或踢人
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  wsUrl = `ws://127.0.0.1:${server.address().port}/websocket`;
  server.on("connection", (sock) => {
    lastSock = sock;
    sock.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
    sock.on("message", (raw) => {
      let frame;
      try { frame = JSON.parse(String(raw)); } catch { return; }
      if (frame.op !== 2) return;
      identifyFrames.push(frame);
      if (identifyReply === "hold") { releaseReady = () => sock.send(READY_FRAME); return; } // 扣住鉴权结果
      if (identifyReply === "ready") sock.send(READY_FRAME);
      else sock.close(identifyReply);
    });
  });

  // ① HTTP 层：成功响应不得判失败；失败按 err_code 并回显官方原文
  const httpGateway = new QqGateway({ onMessage: () => undefined, log: () => undefined });
  let sendErr = "";
  try {
    await httpGateway.sendMessage("GOODID", "你好", { msgId: "m1", scene: "group" });
  } catch (error) {
    sendErr = String(error?.message ?? error);
  }
  ok(!sendErr, `③发送成功（HTTP 200 + 纯业务数据）不被判成失败${sendErr ? `（实测被判失败：${sendErr.slice(0, 90)}）` : ""}`);
  let failMsg = "";
  try {
    await httpGateway.sendMessage("FAIL", "你好", { msgId: "m1", scene: "group" });
  } catch (error) {
    failMsg = String(error?.message ?? error);
  }
  ok(/40034005/.test(failMsg) && /msg_id已过期/.test(failMsg),
    `失败按 err_code 判定并回显官方原文${failMsg ? `（实测：${failMsg.slice(0, 60)}…）` : "（未抛异常）"}`);
  ok(calls.every((c) => c.url.startsWith("https://api.bot.qq.com/")), "token/gateway/消息同走 api.bot.qq.com");

  // ② 鉴权被拒（文档：4014 intent 无权限，不可重试）：当场失败、给原因、不落盘
  identifyReply = 4014;
  const rejected = new QqGateway({ onMessage: () => undefined, log: () => undefined });
  let rejectErr = "";
  try {
    await rejected.connect("100000", "secret-x");
  } catch (error) {
    rejectErr = String(error?.message ?? error);
  }
  ok(/4014/.test(rejectErr) && /intent 无权限/.test(rejectErr),
    `⑥服务端用 4014 踢连接时当场失败并翻译成人话${rejectErr ? `：${rejectErr.slice(0, 80)}…` : "（connect 竟成功了）"}`);
  ok(!rejected.hasSession(), "⑥被踢后 hasSession 为假（不「看着连着、实际收不到」）");
  ok(!existsSync(accountFile), "⑥凭据/权限没过不落盘（否则下次启动继续自动恢复一个连不上的账号）");

  // ③ 鉴权在飞：op2 已发出、READY 还没回 —— 这一刻不许算「已连接」，connect 也不许返回成功
  identifyFrames.length = 0;
  identifyReply = "hold";
  const logs = [];
  const inbound = [];
  const gateway = new QqGateway({ onMessage: (m) => inbound.push(m), log: (_l, m) => logs.push(m) });
  let connectResolved = false;
  let connectError = "";
  const connectPromise = gateway.connect("100000", "secret-ok").then(
    () => { connectResolved = true; },
    (error) => { connectError = String(error?.message ?? error); },
  );
  for (let i = 0; i < 100 && identifyFrames.length === 0; i++) await sleep(30);
  await sleep(300); // 给「open 就立刻返回成功」的实现一点时间露馅
  ok(identifyFrames.length === 1, `②客户端确实发出了 op2 Identify（实测 ${identifyFrames.length} 帧）`);
  const identify = identifyFrames[0]?.d ?? {};
  ok(identify.intents === 1 << 25,
    `②op2 的 intents 恰为 1<<25（实测 ${identify.intents}；带 1<<12 的旧值就是上面那种 4014）`);
  ok(identify.token === "QQBot AT-test", "op2 的 token 是 QQBot {access_token}（文档「WebSocket 方式」）");
  ok(Array.isArray(identify.shard) && identify.shard.join() === "0,1", "op2 带 shard [0,1]（单连接不分片）");
  ok(!connectResolved && !gateway.hasSession() && !existsSync(accountFile),
    `⑥READY 未回 ⇒ connect 未返回、hasSession 为假、还没落盘（实测 resolved=${connectResolved} hasSession=${gateway.hasSession()} 落盘=${existsSync(accountFile)}；只看 socket open 的实现会在这里双双报「已连接」）`);
  // ④ 放行 READY：这时才允许报成功
  identifyReply = "ready";
  releaseReady();
  await connectPromise;
  ok(!connectError && connectResolved && gateway.hasSession(),
    `收到 READY 后 connect 才成功且 hasSession 为真${connectError ? `（实测：${connectError.slice(0, 70)}）` : ""}`);
  ok(logs.some((m) => /正在建立长连接/.test(m)) && logs.some((m) => /READY/.test(m)) && logs.some((m) => /已连接/.test(m)),
    "日志三段式：正在建立长连接 → READY → 已连接（旧写法在鉴权前就报已连接）");
  // ⑤ 入站事件真跑一遍（用户报「发消息没反应」——这一段决定能不能分清「平台没推」与「我们没接」）
  lastSock?.send(JSON.stringify({
    op: 0, s: 2, t: "GROUP_AT_MESSAGE_CREATE",
    d: { id: "MSG-1", group_openid: "GROUP-OPENID-ABCDEFG", content: "@测试机器人 今天天气怎么样", author: { member_openid: "USER-1" } },
  }));
  for (let i = 0; i < 40 && inbound.length === 0; i++) await sleep(25);
  ok(inbound.length === 1, `群聊@事件确实交给上层（实测 ${inbound.length} 条）`);
  const got = inbound[0] ?? {};
  ok(got.scene === "group" && got.chatId === "GROUP-OPENID-ABCDEFG" && got.msgId === "MSG-1"
    && got.text === "今天天气怎么样",
    `解析出的字段对（scene/chatId/msgId + 去掉 @ 后的正文：实测 "${got.text}" / ${got.scene} / ${got.chatId}）`);
  ok(logs.some((m) => /收到 QQ 群聊@消息/.test(m)),
    "⑤事件到达必须留一行日志（没这行时「没反应」无法定性：用户 11-04 就撞在这上面）");
  lastSock?.send(JSON.stringify({
    op: 0, s: 3, t: "C2C_MESSAGE_CREATE",
    d: { id: "MSG-2", user_openid: "USER-OPENID-XYZ", content: "@测试机器人", author: { user_openid: "USER-2" } },
  }));
  await sleep(200);
  ok(logs.some((m) => /没有可用文本/.test(m)) && inbound.length === 1,
    "⑤只有 @ 的事件：明确记「没有可用文本 ⇒ 不回复」，且不进上层（⛔ 不许静默丢弃）");
  // `<@!openid>` 是 QQ 另一种 @ 写法：旧正则只剥 `@名字`，这种会残留一个 `<` 当正文送进模型
  lastSock?.send(JSON.stringify({
    op: 0, s: 4, t: "GROUP_AT_MESSAGE_CREATE",
    d: { id: "MSG-3", group_openid: "GROUP-OPENID-ABCDEFG", content: "<@!123456>", author: { member_openid: "USER-3" } },
  }));
  await sleep(200);
  ok(inbound.length === 1, `⑤「<@!openid>」形式的纯 @ 也不进上层（实测 ${inbound.length} 条；旧剥法会漏一个 "<" 当正文）`);
  lastSock?.send(JSON.stringify({
    op: 0, s: 5, t: "GROUP_AT_MESSAGE_CREATE",
    d: { id: "MSG-4", group_openid: "GROUP-OPENID-ABCDEFG", content: "<@!123456> 帮我查一下", author: { member_openid: "USER-4" } },
  }));
  for (let i = 0; i < 40 && inbound.length < 2; i++) await sleep(25);
  ok(inbound[1]?.text === "帮我查一下",
    `⑤带正文的「<@!openid> 正文」剥干净（实测 "${inbound[1]?.text ?? ""}"）`);
  // ⛔ 官方**单聊**事件里对方标识只在 author.user_openid（顶层没有 user_openid）。
  //   只读顶层时每条私聊都被判成「没有可用文本」丢掉 —— 11-04 用户实测「机器人在线、发了没反应」的真因。
  lastSock?.send(JSON.stringify({
    op: 0, s: 6, t: "C2C_MESSAGE_CREATE",
    d: { id: "MSG-5", content: "哈喽", timestamp: "2026-11-04T15:18:00+08:00", author: { user_openid: "AUTHOR-ONLY-OPENID" } },
  }));
  for (let i = 0; i < 40 && inbound.length < 3; i++) await sleep(25);
  const c2c = inbound[2] ?? {};
  ok(c2c.scene === "c2c" && c2c.chatId === "AUTHOR-ONLY-OPENID" && c2c.text === "哈喽",
    `⑥单聊事件只有 author.user_openid 时也要认得出聊天对象（实测 chatId="${c2c.chatId ?? ""}" text="${c2c.text ?? ""}"）`);
  ok(!logs.some((m) => /取不到会话标识/.test(m)), "⑥不该再出现「取不到会话标识」的错误分支");
  // 官方：「为确保消息可达，相同 msg_id 可能重复推送」⇒ 不去重就是同一条消息跑两遍、回复两遍
  const beforeDup = inbound.length;
  lastSock?.send(JSON.stringify({ op: 0, s: 7, t: "C2C_MESSAGE_CREATE", d: { id: "MSG-5", content: "哈喽", author: { user_openid: "AUTHOR-ONLY-OPENID" } } }));
  await sleep(250);
  ok(inbound.length === beforeDup && logs.some((m) => /重复推送/.test(m)),
    `⑦同一 msg_id 再推一次只处理一遍（实测上层 ${inbound.length - beforeDup} 条新增、日志有「重复推送」=${logs.some((m) => /重复推送/.test(m))}）`);
  // ⛔ 认「带 AppID 的那次 token 请求」：前面 sendMessage 用例的实例没填凭据，找错对象会读到老请求
  const tokenCall = calls.find((c) => c.url.includes("getAppAccessToken") && c.body?.appId);
  ok(tokenCall?.body?.appId === "100000" && !("appID" in (tokenCall?.body ?? {})),
    "token 请求体字段是小写 appId（实测传 appID 得 {code:100007,appid invalid}，字段名错照样连不上）");
  ok(calls.some((c) => c.auth === "QQBot AT-test"), "HTTP 鉴权头为 QQBot {access_token}（文档「API 调用指南」）");
  ok(existsSync(accountFile), "连上之后才落盘（qq-account.json 跟随 userData）");
  gateway.logout();
  ok(!existsSync(accountFile), "解绑清除落盘账号");

  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
}

// ---------- 二、结构断言 ----------
ok(/const API = "https:\/\/api\.bot\.qq\.com"/.test(code) && !/"https:\/\/api\.sgroup\.qq\.com"/.test(code),
  "统一请求地址 = api.bot.qq.com（sgroup 的 token 接口实测 404）");
ok(/app\.getPath\("userData"\), "qq-account\.json"/.test(code) && !/const STATE_FILE/.test(code),
  "账号落盘跟随 userData（自定义配置目录也能恢复）");
ok(/private detachSocket\(\)/.test(code) && /removeAllListeners\(\); this\.ws\.close\(\)/.test(code),
  "detachSocket 本体：先摘监听再 close（顺序反了 close 会自己再排一次重连）");
const connectBody = code.slice(code.indexOf("async connect("), code.indexOf("private detachSocket()"));
ok(/this\.detachSocket\(\);/.test(connectBody) && /this\.openSocket\(/.test(connectBody)
  && connectBody.indexOf("this.detachSocket();") < connectBody.indexOf("this.openSocket("),
  "connect 开新 socket 前先摘旧的（重复绑定不再叠出双份消息）");
ok(/async resumeSocket\(\)[\s\S]{0,420}?this\.detachSocket\(\);/.test(code),
  "④重连也先摘旧 socket（只在 connect 摘 = 断线重连仍会叠连接、触发 4008 频控）");
ok(/this\.socketReady = false;\s*this\.sessionReady = false;\s*this\.lastCloseCode = 0;\s*this\.lastSeq = null;/.test(code),
  "⑤detachSocket 归零 lastSeq（文档：op1 心跳的 d 是**本次 session**最新事件的 s，带旧序号 ⇒ 4007 seq 错误）");
ok(/intents: 1 << 25/.test(code) && !/1 << 12/.test(code),
  "intents 只订 GROUP_AND_C2C_EVENT(1<<25)：群聊@与单聊都在它下面，多一位无权限就整条连接被拒");
ok(/if \(!this\.running \|\| this\.reconnectTimer \|\| this\.reconnecting\) return;/.test(code),
  "重连单飞（close/op7/op9 同帧叠发会各开一条，超官方最大连接数）");
ok(/if \(gw\.url && this\.running\) this\.openSocket/.test(code),
  "取回网关地址后重新确认 running（期间解绑就不许把长连接开回来）");
ok(/code === 4914 \|\| code === 4915/.test(code) && /this\.running = false;/.test(code),
  "4914 已下架 / 4915 已封禁 ⇒ 停止重连并说明（文档：不可重试，继续重连只刷日志）");
ok(/try \{\s*packet = JSON\.parse\(String\(raw\)\);\s*\} catch \{/.test(code),
  "WS 帧解析兜异常（监听器里抛出 = 主进程未捕获异常，一帧脏数据就能崩应用）");
ok(/case 9:/.test(code) && /QQ 会话被判定无效（op9）/.test(code),
  "op9 无效会话要报错并重连（不能「看着连着、实际收不到」）");
ok(/this\.lastCloseCode = code;/.test(code),
  "close 记下官方关闭码（没有它，用户与我们都分不清凭据错、权限没开还是频控）");
ok(/return this\.socketReady && this\.sessionReady;/.test(code),
  "hasSession = socket open **且** 收到过事件（鉴权没过时后台不下发任何事件）");
ok(/await this\.waitSessionReady\(/.test(code)
  && connectBody.indexOf("waitSessionReady") < connectBody.indexOf("fs.writeFileSync(stateFile()"),
  "connect 先等 READY 再落盘再报成功（顺序反了会把连不上的账号写进自动恢复）");
ok(/if \(error\?\.code === "ENOENT"\) return false;/.test(code),
  "没绑过 QQ 的自动恢复静默返回（不刷 channel-log 错误）");
ok(/!response\.ok \|\| !Number\.isFinite\(errCode\) \|\| errCode !== 0/.test(code)
  && !/\.then\(\(r\) => r\.json\(\)\)/.test(code),
  "③HTTP 状态 + err_code 双判，且没有裸 r.json()（代理返回 HTML 时抛的是英文 SyntaxError）");

/* ⑥⑦ 事件体字段口径（官方 autogen/event/c2c_message_create：事件体只有 author.user_openid，
   顶层没有 user_openid）与「至少一次投递」的去重义务 */
ok(/d\?\.group_openid \?\? d\?\.user_openid \?\? d\?\.author\?\.user_openid/.test(code),
  "⑥单聊的聊天对象必须能从 author.user_openid 取到（只读顶层 ⇒ 每条私聊都被丢掉）");
ok(/if \(!chatId\) \{\s*this\.log\("error", `QQ \$\{kind\} 事件取不到会话标识/.test(code),
  "⑥「没有会话标识」单独一条分支且立刻报 error（合并成 `!chatId && !text` 或 `!text || !chatId` 都会把真因写成「没文本」）");
ok(/if \(!text\) \{\s*this\.log\("info", `QQ \$\{kind\} 事件没有可用文本/.test(code),
  "⑥「没有正文」单独一条分支（纯 @/图片/卡片是真没内容，不该和取不到 id 混在一起）");
ok(/取不到会话标识/.test(code) && /没有可用文本/.test(code),
  "两种丢弃各有一条明确日志（并带上收到的字段名 / message_type，便于下次定性）");
ok(/private isDuplicate\(msgId: string\)/.test(code)
  && code.indexOf("this.isDuplicate(msgId)") < code.indexOf("this.events.onMessage"),
  "⑦重复推送在进入上层之前就被拦掉（官方：相同 msg_id 可能重复推送，不去重 = 回复两遍）");
ok(/this\.seenMsgIds\.clear\(\);/.test(code), "解绑清空判重表（换机器人不该受上一台的历史影响）");

// ---------- 三、扫码接入（qq-qr-connect）：首码必须在返回前落地 ----------
/* 11-04 审查抓到：注释写着「qqQrStart 返回的快照就带 qr」，但代码是 void 异步任务 + 立刻
   return snapshot —— 任务刚跑到 create_bind_task 就挂起，返回的快照没有 qr，前端要空转一轮
   （1.5s 轮询）才看到码。注释与代码相反 = 下一轮照注释办事。 */
const qrSrc = readFileSync(join(ROOT, "electron", "qq-qr-connect.ts"), "utf8");
const qrCode = qrSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");
ok(/await Promise\.race\(\[firstQr, sleep\(8000, signal\)\]\);\s*\n\s*return snapshot;/.test(qrCode),
  "qqQrStart 等首码落地才返回（带 8s 上限，q.qq.com 不通时不挂死）");
const startBody = qrCode.slice(qrCode.indexOf("export async function qqQrStart("));
const runOnceBody = qrCode.slice(qrCode.indexOf("const runOnce = async"));
ok(runOnceBody.indexOf("settleFirstQr()") > runOnceBody.indexOf("await emitQr(buildConnectUrl"),
  "首码渲染完成后才放行 firstQr（渲染前就 return 等于没等）");
ok(/const fail = \(message: string\) => \{[\s\S]{0,200}?settleFirstQr\(\);/.test(startBody),
  "建任务/绑定失败也要放行 firstQr（⛔ 否则失败态把 qqQrStart 卡到 8s 兜底才回）");
ok(/扫码协议两端仍在/.test("") === false && /status === 2/.test(qrCode) && /status === 3/.test(qrCode) && /create_bind_task/.test(qrCode) && /poll_bind_result/.test(qrCode),
  "扫码协议两端仍在（create_bind_task / poll_bind_result，status 2=完成 3=过期，实测 q.qq.com 两口都通）");

/* 入站管线（im-inbound）：QQ 的回复要带 msg_id 上下文，且「收到 / 被配对拦下 / 已回复」三步都得有行可查。
   11-04 用户报「能连上但发信息没反应」——原来只有失败会记日志，成功与静默丢弃全是空白。 */
const inboundCode = stripComments(readFileSync(join(ROOT, "electron", "features", "im-inbound.ts"), "utf8"));
ok(/qq 回复失败|`\$\{channel\} 回复失败/.test(inboundCode) && /回复已发送/.test(inboundCode),
  "回复的成功与失败都要留日志（只有失败有日志时，「没反应」分不清是没发到还是发失败了）");
ok(/`\$\{channel\} 收到消息（聊天/.test(inboundCode), "入站第一步就记一行（在配对判定之前）");
ok(/配对判定 = \$\{gate\.action\}/.test(inboundCode),
  "被配对门卫拦下也要记一行（QQ 首次使用必然先走配对，这行是唯一能看出「卡在这里」的证据）");
ok(/已交给会话 \$\{String\(threadId\)\.slice\(0, 8\)/.test(inboundCode),
  "「进会话」单独记一行：区分「没进会话」与「进了会话但回合没回」两种毛病");

console.log(fails ? `\n【qq-gateway】失败 ${fails} 项` : `\n【qq-gateway】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
