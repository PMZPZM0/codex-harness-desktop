/**
 * 渠道机器人同族缺陷守卫（11-04 用户：「其他几个 bot 机器人通道，都同步审查一下，看看有没有类似问题」）。
 *
 * QQ 那轮修完，用同一把尺子量微信 / Telegram / 飞书 / 钉钉 / 企微，五类问题在各家反复出现：
 *   ① 业务错误被当成功（飞书 SDK 的响应拦截器只 `return resp.data`，HTTP 200 + code≠0 不抛）；
 *   ② 「已连接」说谎（只看对象/token 存在；钉钉 connect() 永不 reject、飞书 start() 连不上也不抛）；
 *   ③ 至少一次投递没有去重（飞书超时重推最多 4 次；钉钉**不回 ACK** 官方就一直重推 ⇒ 同一问题跑两遍）；
 *   ④ 静默丢弃（取不到字段直接 return，一行日志没有）；
 *   ⑤ 长度按字符算（企微 markdown 上限是 **4096 字节**，中文 3 字节 ⇒ 1500 字必被拒 40058）。
 *
 * 判据一律**跑构建产物**（dist-electron/*.js）+ 桩 fetch / 假 client：这些缺陷全是"看起来成功、
 * 实际没落地"，静态正则证明不了。
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join} from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
process.env.CODEX_HARNESS_USER_DATA = mkdtempSync(join(tmpdir(), "channel-parity-"));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };
const art = (name) => join(ROOT, "dist-electron", name);

const missing = ["feishu-gateway.js", "im-gateway/dingtalk-gateway.js", "im-gateway/wecom-webhook-gateway.js", "im-gateway/telegram-gateway.js"].filter((f) => !existsSync(art(f)));
if (missing.length) {
  ok(false, `构建产物齐备（缺 ${missing.join("、")} —— 先 npm run build:electron）`);
} else {
  const { FeishuGateway } = require_(art("feishu-gateway.js"));
  const { DingtalkGateway } = require_(art("im-gateway/dingtalk-gateway.js"));
  const { WecomWebhookGateway } = require_(art("im-gateway/wecom-webhook-gateway.js"));
  const { TelegramGateway } = require_(art("im-gateway/telegram-gateway.js"));
  const realFetch = globalThis.fetch;
  const calls = [];

  // ── ① 飞书：业务错误必须判失败 ────────────────────────────────────────────
  const feishu = new FeishuGateway({ onMessage: () => undefined, log: () => undefined });
  feishu["client"] = { im: { message: { create: async () => ({ code: 230002, msg: "no permission" }) } } };
  let fsErr = "";
  try { await feishu.sendMessage("oc_x", "正文"); } catch (error) { fsErr = String(error?.message ?? error); }
  ok(/230002/.test(fsErr) && /no permission/.test(fsErr),
    `①飞书 HTTP 200 + code≠0 必须判失败（SDK 拦截器只 return resp.data，旧写法当成功 ⇒ 上层还记「回复已发送」假日志）${fsErr ? `；实测：${fsErr.slice(0, 70)}` : "（没抛异常）"}`);
  feishu["client"] = { im: { message: { create: async () => ({ code: 0, data: { message_id: "om_1" } }) } } };
  let fsOkErr = "";
  try { await feishu.sendMessage("oc_x", "正文"); } catch (error) { fsOkErr = String(error?.message ?? error); }
  ok(!fsOkErr, `①飞书 code=0 是成功${fsOkErr ? `（误判：${fsOkErr.slice(0, 80)}）` : ""}`);
  // 超长必须留标记（旧写法 slice(0,4000) 静默砍尾，用户以为模型只说了这些）
  feishu["client"] = { im: { message: { create: async (arg) => { calls.push(JSON.parse(arg.data.content).text); return { code: 0 }; } } } };
  await feishu.sendMessage("oc_x", "长".repeat(4200));
  ok(String(calls.at(-1)).includes("已截断"), "①飞书超长正文带「已截断」标记（不许静默砍尾）");

  // ──  飞书 / 钉钉 / Telegram：hasSession 不许拿「对象存在」当证据 ──────────
  feishu["running"] = true;
  feishu["ws"] = { getConnectionStatus: () => ({ state: "failed" }) };
  ok(feishu.hasSession() === false, "②飞书 SDK 报 failed 时 hasSession 必须为假（旧写法 Boolean(ws) 常亮绿点）");
  feishu["ws"] = { getConnectionStatus: () => ({ state: "connected" }) };
  ok(feishu.hasSession() === true, "②飞书 state=connected 才算已连接");
  feishu["ws"] = null; feishu["running"] = false;
  const ding = new DingtalkGateway({ onMessage: () => undefined, log: () => undefined });
  ok(ding.hasSession() === false, "②钉钉未连接时 hasSession 为假");
  ding["client"] = { connected: true, registered: false };
  ok(ding.hasSession() === false, "②钉钉 socket 通了但没注册成功 ⇒ 仍算未连接（connect() 永不 reject，旧写法直接报已连接）");
  ding["client"] = { connected: true, registered: true };
  ok(ding.hasSession() === true, "②钉钉 connected + registered 才算已连接");
  const tg = new TelegramGateway({ onMessage: () => undefined, log: () => undefined });
  tg["token"] = "123:abc"; tg["running"] = false; tg["lastPollOkAt"] = Date.now();
  ok(tg.hasSession() === false, "②Telegram 有 token 但轮询已停 ⇒ 不算已连接（旧写法只看 token）");
  tg["running"] = true; tg["lastPollOkAt"] = Date.now() - 5 * 60_000;
  ok(tg.hasSession() === false, "②Telegram 最近 90s 没有成功的 getUpdates ⇒ 不算已连接（token 被撤/409 双实例时 UI 不再骗人）");
  tg["lastPollOkAt"] = Date.now();
  ok(tg.hasSession() === true, "②Telegram 轮询活着才算已连接");

  // ──  至少一次投递：去重 ─────────────────────────────────────────────────
  ok(feishu["isDuplicate"]("om_same") === false && feishu["isDuplicate"]("om_same") === true,
    "③飞书同 message_id 第二次判为重推（官方超时按 15s/5min/1h/6h 最多重推 4 次，不去重 = 跑两遍回合回两遍）");
  ok(ding["isDuplicate"]("msg_a") === false && ding["isDuplicate"]("msg_a") === true,
    "③钉钉同 msgId 判重（回调不 ACK 时官方会持续重推）");

  // ── ④⑤ 钉钉 sessionWebhook 时效 + 企微字节上限 ──────────────────────────
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return { ok: true, status: 200, text: async () => '{"errcode":0,"errmsg":"ok"}', json: async () => ({ errcode: 0 }) };
  };
  ding["sessions"].set("cid1", { webhook: "https://oapi.dingtalk.com/robot/sendBySession?session=x", chatId: "cid1", from: "u", expiresAt: Date.now() - 1000 });
  let ddErr = "";
  try { await ding.sendMessage("cid1", "正文"); } catch (error) { ddErr = String(error?.message ?? error); }
  ok(/过期/.test(ddErr), `④钉钉按官方 sessionWebhookExpiredTime 判过期（旧写法硬编码 90 分钟还在发送成功后刷新，闸门形同虚设）${ddErr ? `；实测：${ddErr.slice(0, 60)}` : "（没拦住）"}`);
  ding["sessions"].set("cid2", { webhook: "https://oapi.dingtalk.com/robot/sendBySession?session=y", chatId: "cid2", from: "u", expiresAt: Date.now() + 60 * 60_000 });
  let ddOkErr = "";
  try { await ding.sendMessage("cid2", "正文"); } catch (error) { ddOkErr = String(error?.message ?? error); }
  ok(!ddOkErr, `④钉钉未过期时正常发送${ddOkErr ? `（误拦：${ddOkErr.slice(0, 70)}）` : ""}`);
  const wecom = new WecomWebhookGateway({ log: () => undefined });
  wecom["webhookUrl"] = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000";
  await wecom.sendMarkdown("中".repeat(2000)); // 6000 字节：旧写法按字符算 3800 会原样发出去 ⇒ errcode 40058
  const lastBody = String(calls.at(-1)?.body ?? "");
  const sentContent = JSON.parse(lastBody).markdown.content;
  ok(Buffer.byteLength(sentContent, "utf8") <= 4096 && sentContent.includes("已截断"),
    `⑤企微按 **UTF-8 字节**截断（实测送出 ${Buffer.byteLength(sentContent, "utf8")} 字节；旧写法按 3800 字符算，中文答复 ~11400 字节必被拒）`);

  // ── 结构面：ACK / 分因日志 / 串台 / 监听器泄漏 ──────────────────────────
  const dingCode = stripComments(read("electron/im-gateway/dingtalk-gateway.ts"));
  ok(/socketCallBackResponse\?\.\(messageId/.test(dingCode) && /const ack = \(\)/.test(dingCode) && /ack\(\);/.test(dingCode),
    "③钉钉回调显式回 ACK（SDK 的 onCallback 只 emit、不代发回执；不回执 ⇒ 官方持续重推）");
  ok(!/if \(!text \|\| !chatId\) return \{ code: 200 \};/.test(dingCode) && /取不到 conversationId/.test(dingCode) && /没有可用文本/.test(dingCode),
    "④钉钉「没有正文」与「没有会话标识」分开记日志（合并写法会把真因盖掉）");
  const wxCode = stripComments(read("electron/weixin-gateway.ts"));
  ok(/取不到 from_user_id/.test(wxCode), "④微信取不到发送者时留一行（旧写法直接 return，「没反应」无从定性）");
  const inbCode = stripComments(read("electron/features/im-inbound.ts"));
  const disposed = (inbCode.match(/stopTurnWatch\?\.\(\);/g) || []).length;
  ok(disposed >= 3,
    `⑥起回合失败必须摘掉结束监听，三个入站处理都要（实测 ${disposed} 处）—— 留着它，下次该会话在桌面端跑完，答复会被推给渠道用户`);
  ok(/function onTurnDone\([\s\S]{0,80}?\): \(\) => void \{/.test(inbCode) && /setTimeout\(dispose, 30 \* 60_000\)/.test(inbCode),
    "⑥onTurnDone 返回 dispose + 30 分钟 TTL 兜底（结束事件形态不对时不能永久挂着）");
  const gwCode = stripComments(read("electron/features/im-gateways.ts"));
  ok(/weixinThreadChat\.get\(threadId\)/.test(gwCode) && /const wxInitiator/.test(gwCode),
    "⑥微信流式先认「这条线程是谁发起的」（渠道级绑定让所有用户共用一个 thread 时，按 weixinBindings 反查会串台）");
  /* 11-05（用户原话「微信可以控制，QQ 控制不了」）：机器人可以绑定**已有桌面会话**，而那个会话
     可能建在 workspace-write / read-only 沙箱下 ⇒ 只按线程继承时，渠道发过去的指令能聊不能做。
     turn/start 支持逐回合覆盖 sandboxPolicy / approvalPolicy（引擎 0.166 schema 实测），
     三条入站 turn/start 必须全部带上 —— 少一条就有一种渠道「控制不了电脑」。 */
  const turnStarts = (inbCode.match(/server\.request\("turn\/start"/g) || []).length;
  const withOverride = (inbCode.match(/turn\/start", \{ threadId, \.\.\.CHANNEL_TURN_OVERRIDE/g) || []).length;
  /* 11-08：多了「超限压缩后重试」那一条 turn/start（同样带覆盖）⇒ 判据改成「每一条都带」。 */
  ok(turnStarts >= 3 && withOverride === turnStarts,
    `⑦渠道回合（含超限重试）都带全权限覆盖（实测 ${withOverride}/${turnStarts}）—— 绑到受限会话的机器人会「能聊不能做」`);
  ok(/sandboxPolicy: \{ type: "dangerFullAccess"/.test(inbCode) && /approvalPolicy: "never"/.test(inbCode),
    "⑦覆盖值必须是 dangerFullAccess + approval never（渠道是遥控入口，准入由配对门卫把关）");
  /* ⛔ 11-08 用户反馈「⚠️ Codex 内容超出模型上限」：渠道会话是**长期复用**的（一句一拍），
     超限后每轮都被上游拒。⇒ 回合结束看到超限错误就解除该渠道绑定（下一条自动开新会话）。 */
  ok(/recoverOverflow/.test(inbCode)
    && /thread\/compact\/start/.test(inbCode)
    && /if \(opts\.retried\) rotateChannelThreadOnOverflow\(threadId\)/.test(inbCode)
    && /setChannelHandoff\(channel, digest\)/.test(inbCode)
    && /takeChannelHandoff\("wechat"\)/.test(inbCode),
    "⑧渠道上下文超限 ⇒ 先压缩并重试原消息（保留历史）；压缩失败才换会话并带上最近几轮摘要");
  /* ⛔ 11-08 用户令「把真实限额按模型持久化，全局生效」：超限报错的 M 记成模型级限额，
     桌面/渠道/委派共用；下一轮按 min(配置阈值, 真实) 提前压。 */
  {
    const srvSrc = stripComments(read("electron/codex-server.ts"));
    const guardSrc = stripComments(read("electron/context-compact-guard.ts"));
    ok(/noteOverflowLimit\(message\.method, message\.params\)/.test(srvSrc)
      && /noteRealLimit\(this\.codexHome, modelKey, limit\)/.test(srvSrc)
      && /shouldCompact\(this\.codexHome, threadId, modelKey\)/.test(srvSrc)
      && /model-real-limits\.json/.test(guardSrc)
      && /Math\.min\(limit, hit\.limit\)/.test(guardSrc),
      "⑨真实限额按模型持久化 + 全局生效（引擎通知单一出口识别；桌面/渠道/委派一起提前压）");
  }
  globalThis.fetch = realFetch;
}

console.log(fails ? `\n【渠道一致性】失败 ${fails} 项` : `\n【渠道一致性】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
