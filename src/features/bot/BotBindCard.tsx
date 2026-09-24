/** 渠道机器人绑定（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useRef, useEffect } from "react";
import { Bot, QrCode, RefreshCw } from "lucide-react";

export function BotBindCard({ bot, onBound }: { bot: { id: string; name: string; channel: string }; onBound: (deviceName: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "bound" | "expired">("idle");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [wxStatus, setWxStatus] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [credA, setCredA] = useState(""); // feishu/dingtalk/qq: ID；telegram: token
  const [credB, setCredB] = useState(""); // feishu/dingtalk/qq: Secret
  const [wecomUrl, setWecomUrl] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  const [qqQrMode, setQqQrMode] = useState(false); // QQ 扫码连接模式：出码等扫，成功即连
  const [qqQr, setQqQr] = useState<{ state: string; qr?: string; name?: string; error?: string } | null>(null);
  const [feishuQrMode, setFeishuQrMode] = useState(false); // 飞书扫码连接模式（Device Flow：扫码=自动建应用并授权）
  const [feishuQr, setFeishuQr] = useState<{ state: string; qr?: string; userCode?: string; name?: string; error?: string } | null>(null);
  const isWeixin = bot.channel === "wechat";
  const isTelegram = bot.channel === "telegram";
  const isFeishu = bot.channel === "feishu";
  const isDingtalk = bot.channel === "dingtalk";
  const isQq = bot.channel === "qq";
  const isWecomWebhook = bot.channel === "wecom-webhook";
  const timerRef = useRef(0);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  // Telegram Bot Token 连接：@BotFather 创建机器人拿 token，填入即连（长轮询自动恢复）
  async function startTelegramConnect() {
    const token = tgToken.trim();
    if (!token) { setWxStatus("请先粘贴 Bot Token（从 Telegram 里的 @BotFather 获取）"); return; }
    setTgBusy(true);
    setWxStatus("正在校验 Token 并连接…");
    try {
      const result = await window.codex.telegramConnect(token);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查 Token"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(`Telegram @${result.username ?? "bot"}`);
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 飞书 / 钉钉 / QQ：双凭据连接（官方长连接，免公网 IP）
  async function startCredConnect() {
    const a = credA.trim();
    const b = credB.trim();
    setTgBusy(true);
    setWxStatus("正在校验凭据并建立连接…");
    try {
      const result = isFeishu ? await window.codex.feishuConnect(a, b)
        : isDingtalk ? await window.codex.dingtalkConnect(a, b)
        : await window.codex.qqConnect(a, b);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查凭据"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(String(result.name ?? (isFeishu ? "飞书" : isDingtalk ? "钉钉" : "QQ")));
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 企微群机器人 Webhook：粘贴即连（校验 = 发一条接入通知）
  async function startWecomConnect() {
    const url = wecomUrl.trim();
    if (!url) { setWxStatus("请先粘贴群机器人 Webhook URL（企微群里「添加机器人」获取）"); return; }
    setTgBusy(true);
    setWxStatus("正在校验 Webhook 并发送接入通知…");
    try {
      const result = await window.codex.wecomWebhookConnect(url);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查 Webhook URL"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(String(result.name ?? "企业微信群"));
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 微信 iLink 登录轮询
  async function startWeixinLogin() {
    try {
      const result = await window.codex.weixinStartLogin();
      if (!result?.qrcodeImg) { setWxStatus("获取微信二维码失败，请重试"); return; }
      // 主进程已把 iLink 的二维码内容归一化成 data URL 图片或 SVG，直接注入
      setQr(result.qrcodeImg);
      setPhase("waiting");
      setWxStatus("等待扫码… 请用手机微信扫一扫");
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        try {
          // 双保险：pollLogin 带超时防长轮询挂死；每跳同时查渠道真实连接状态——
          // 即使 poll 漏报 connected，只要网关已连上界面就会及时更新（用户实测踩过）
          const status = await Promise.race([
            window.codex.weixinPollLogin(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
          ]);
          const cs = await window.codex.channelsStatus().catch(() => null);
          if (cs?.weixin) { window.clearInterval(timerRef.current); setPhase("bound"); setWxStatus(""); onBound("微信"); return; }
          if (status?.status === "scaned") setWxStatus("已扫码，正在验证…（如微信提示验证码，输入后继续）");
          else if (status?.verifyCodeRequired) setWxStatus("请在手机微信输入提示的数字验证码");
          else if (status?.status === "expired") { window.clearInterval(timerRef.current); setPhase("expired"); setWxStatus("二维码已过期"); }
          else if (status?.connected) { window.clearInterval(timerRef.current); setPhase("bound"); setWxStatus(""); onBound("微信"); }
        } catch { /* 单次轮询失败不中断循环 */ }
      }, 1500);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
    }
  }

  // QQ 官方扫码连接：桌面出二维码 → 手机 QQ（开放平台管理者账号）扫码确认 →
  // 官方回传凭据 → 主进程自动走 qqGateway.connect。注意会重置该机器人旧 AppSecret（腾讯规则）。
  async function startQqQrConnect() {
    setWxStatus("");
    try {
      const snapshot = await window.codex.qqQrStart();
      if (snapshot.state === "failed") { setWxStatus(snapshot.error || "获取二维码失败，请重试"); setQqQrMode(false); return; }
      setQqQr(snapshot);
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.qqQrStatus();
        setQqQr(status);
        if (status.state === "connected") {
          window.clearInterval(timerRef.current);
          setQqQrMode(false);
          setPhase("bound");
          setWxStatus("");
          onBound(status.name ?? "QQ 机器人");
        } else if (status.state === "failed") {
          window.clearInterval(timerRef.current);
          setWxStatus(status.error || "扫码连接失败，请重试或改用手动输入");
          setQqQrMode(false);
        }
      }, 1200);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
      setQqQrMode(false);
    }
  }

  function exitQqQrMode() {
    window.clearInterval(timerRef.current);
    void window.codex.qqQrCancel();
    setQqQrMode(false);
    setQqQr(null);
    setWxStatus("");
  }

  // 飞书官方扫码连接（Device Flow）：扫码 → 飞书自动创建应用并授权 → 凭据回传 → 自动连接。
  // 用户零手工配置（无需去开放平台手动建应用）。
  async function startFeishuQrConnect() {
    setWxStatus("");
    try {
      const snapshot = await window.codex.feishuQrStart();
      if (snapshot.state === "failed") { setWxStatus(snapshot.error || "获取二维码失败，请重试"); setFeishuQrMode(false); return; }
      setFeishuQr(snapshot);
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.feishuQrStatus();
        setFeishuQr(status);
        if (status.state === "connected") {
          window.clearInterval(timerRef.current);
          setFeishuQrMode(false);
          setPhase("bound");
          setWxStatus("");
          onBound(status.name ?? "飞书机器人");
        } else if (status.state === "failed") {
          window.clearInterval(timerRef.current);
          setWxStatus(status.error || "扫码连接失败，请重试或改用手动输入");
          setFeishuQrMode(false);
        }
      }, 1500);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
      setFeishuQrMode(false);
    }
  }

  function exitFeishuQrMode() {
    window.clearInterval(timerRef.current);
    void window.codex.feishuQrCancel();
    setFeishuQrMode(false);
    setFeishuQr(null);
    setWxStatus("");
  }

  // 控制端绑定码轮询（非微信渠道）
  async function startBind() {
    try {
      const result = await window.codex.botBindQrcode(bot.id, bot.name);
      if (!result?.qr) { setWxStatus("获取绑定码失败，请重试"); return; }
      setQr(result.qr);
      setCode(result.code);
      setPhase("waiting");
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.botBindStatus(result.code);
        if (status === "confirmed") {
          const consumed = await window.codex.botBindConsume(result.code);
          window.clearInterval(timerRef.current);
          setPhase("bound");
          onBound(consumed?.deviceName ?? "手机");
        } else if (status === "expired") {
          window.clearInterval(timerRef.current);
          setPhase((current) => current === "waiting" ? "expired" : current);
        }
      }, 1200);
    } catch (error: any) {
      setWxStatus("获取绑定码失败：" + (error?.message ?? "请检查网络后重试"));
    }
  }

  const start = isWeixin ? startWeixinLogin : startBind;

  // 凭据型渠道（Telegram/飞书/钉钉/QQ/企微Webhook）：各自表单，无扫码
  if (isTelegram || isFeishu || isDingtalk || isQq || isWecomWebhook) {
    const head = isTelegram
      ? { title: "连接 Telegram", desc: "在 Telegram 里找 @BotFather 发送 /newbot 创建机器人，把得到的 Bot Token（形如 123456:ABC-xxx）粘贴到下面。连接后在 Telegram 里给机器人发消息即可对话，回复实时回推。" }
      : isFeishu
        ? { title: "连接飞书机器人", desc: "在 open.feishu.cn 创建「企业自建应用」：①添加「机器人」能力；②开通 im:message 相关权限并发布应用版本；③把「凭证与基础信息」页的 App ID / App Secret 填到下面。连接后群里 @机器人 或私聊发消息即可对话。" }
        : isDingtalk
          ? { title: "连接钉钉机器人", desc: "在 open-dev.dingtalk.com 创建企业内部应用：①「添加应用能力」里开通「机器人」，消息接收模式选「Stream 模式」；②发布应用；③把「应用信息」页的 Client ID / Client Secret 填到下面。连接后在群里 @机器人 发消息即可对话。" }
          : isQq
            ? { title: "连接 QQ 机器人", desc: "推荐「扫码连接」：点下方按钮出二维码，用手机 QQ 扫一下并确认即可，凭据自动回传（注意会重置该机器人旧 AppSecret）。也可在 q.qq.com 实名创建机器人后，把「开发设置」页的 AppID / AppSecret 手动填入。群聊 @机器人 需在开放平台申请「群聊消息」场景与发送权限并上线机器人；审核通过前可先用单聊测试。" }
            : { title: "企微群机器人推送", desc: "在企微群右键 →「添加群机器人」创建后，把 Webhook URL 粘贴到下面。连接即发一条接入通知。此通道为推送型：自动化任务结果、通知会实时推送到群（企微群机器人不支持收消息对话，腾讯限制）。" };
    const busy = tgBusy;
    const connect = isTelegram ? startTelegramConnect : isWecomWebhook ? startWecomConnect : startCredConnect;
    const connectLabel = isTelegram ? "连接" : isWecomWebhook ? "连接并测试" : "连接";
    return (
      <div className="bot-bind-wrap">
        <div className="bot-detail-row bot-bind-card">
          <div><strong>{head.title}</strong><small>{head.desc}</small></div>
        </div>
        {phase !== "bound" ? (
          <div className="bot-bind-panel tg-token-panel">
            {isQq && qqQrMode ? (
              <>
                {isImageSource(qqQr?.qr ?? "")
                  ? <div className="remote-qr-box"><img src={qqQr!.qr} alt="QQ 扫码二维码" style={{ display: "block", width: "100%" }} /></div>
                  : <div className="remote-qr-box">{qqQr?.qr ? <div dangerouslySetInnerHTML={{ __html: qqQr.qr }} /> : <span className="bind-spinner" />}</div>}
                <div className="bot-bind-state">
                  <span className="bot-bind-state-title"><span className="bind-spinner" />等待手机 QQ 扫码</span>
                  <span>用手机 QQ「扫一扫」扫描二维码并确认（需为开放平台上该机器人的管理者账号）</span>
                  <span>扫码确认后凭据自动回传并连接，无需手动输入；注意：会重置该机器人已保存的 AppSecret</span>
                  <button className="remote-mini-btn" onClick={exitQqQrMode}>取消扫码</button>
                </div>
              </>
            ) : isFeishu && feishuQrMode ? (
              <>
                {isImageSource(feishuQr?.qr ?? "")
                  ? <div className="remote-qr-box"><img src={feishuQr!.qr} alt="飞书扫码二维码" style={{ display: "block", width: "100%" }} /></div>
                  : <div className="remote-qr-box">{feishuQr?.qr ? <div dangerouslySetInnerHTML={{ __html: feishuQr.qr }} /> : <span className="bind-spinner" />}</div>}
                <div className="bot-bind-state">
                  <span className="bot-bind-state-title"><span className="bind-spinner" />等待飞书扫码授权</span>
                  <span>用手机飞书「扫一扫」扫描二维码并确认授权（飞书会自动创建机器人应用，无需手动去开放平台配置）</span>
                  {feishuQr?.userCode && <span>展示码：{feishuQr.userCode}</span>}
                  <span>授权成功后凭据自动回传并连接；二维码过期会自动刷新</span>
                  <button className="remote-mini-btn" onClick={exitFeishuQrMode}>取消扫码</button>
                </div>
              </>
            ) : (
              <>
                {isTelegram && (
                  <input className="tg-token-input" type="password" placeholder="粘贴 Bot Token：123456:ABC-DEF..." value={tgToken} onChange={(event) => setTgToken(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                )}
                {(isFeishu || isDingtalk || isQq) && (
                  <>
                    <input className="tg-token-input" placeholder={isDingtalk ? "Client ID (AppKey)" : "App ID / AppID"} value={credA} onChange={(event) => setCredA(event.target.value)} />
                    <input className="tg-token-input" type="password" placeholder={isDingtalk ? "Client Secret (AppSecret)" : "App Secret"} value={credB} onChange={(event) => setCredB(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                  </>
                )}
                {isWecomWebhook && (
                  <input className="tg-token-input" type="password" placeholder="粘贴 Webhook URL：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." value={wecomUrl} onChange={(event) => setWecomUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                )}
                {isQq && (
                  <button className="bot-scan-btn" disabled={busy} onClick={() => { setQqQrMode(true); void startQqQrConnect(); }}><QrCode size={14} />扫码连接（手机 QQ 扫码，免输入）</button>
                )}
                {isFeishu && (
                  <button className="bot-scan-btn" disabled={busy} onClick={() => { setFeishuQrMode(true); void startFeishuQrConnect(); }}><QrCode size={14} />扫码连接（手机飞书扫码，自动建应用，免输入）</button>
                )}
                <button className="bot-scan-btn" disabled={busy} onClick={() => void connect()}>{busy ? <><span className="bind-spinner" />连接中…</> : <><QrCode size={14} />{connectLabel}</>}</button>
                {wxStatus && <span className="tg-token-status">{wxStatus}</span>}
              </>
            )}
          </div>
        ) : (
          <div className="bot-bind-panel">
            <div className="bot-bind-state">
              <span className="bot-bind-state-title"><span className="bind-ok">✓</span>{head.title.replace("连接", "")}已连接</span>
              <span>{isWecomWebhook ? "现在自动化任务结果与通知会推送到这个企微群。" : "现在直接在该渠道给机器人发消息即可对话，回复会实时回推。"}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bot-bind-wrap">
      <div className="bot-detail-row bot-bind-card">
        <div><strong>{isWeixin ? "连接微信" : "关联机器人"}</strong><small>{isWeixin ? "用手机微信扫码登录，登录后直接在微信里和机器人聊天，回复实时回推。" : "扫码后自动保存凭据。手机扫一扫，打开链接并确认登录，这台手机即成为该机器人的控制端。"}</small></div>
        {phase !== "bound" && <button className="bot-scan-btn" onClick={() => void start()}><QrCode size={14} />扫码</button>}
      </div>
      {phase !== "idle" && phase !== "bound" && (
        <div className="bot-bind-panel">
          {isImageSource(qr)
            ? <div className="remote-qr-box"><img src={qr} alt="微信登录二维码" style={{ display: "block", width: "100%" }} /></div>
            : <div className="remote-qr-box" dangerouslySetInnerHTML={{ __html: qr }} />}
          <div className="bot-bind-state">
            {phase === "waiting" && <>
              <span className="bot-bind-state-title"><span className="bind-spinner" />{isWeixin ? "等待微信扫码" : "等待扫码"}</span>
              {isWeixin
                ? <>
                  <span>打开手机微信「扫一扫」扫描左侧二维码</span>
                  {wxStatus && <span>{wxStatus}</span>}
                  <button className="remote-mini-btn" onClick={() => { window.clearInterval(timerRef.current); void window.codex.weixinCancelLogin().catch(() => undefined); setPhase("idle"); setQr(""); setWxStatus(""); }}>取消扫码</button>
                </>
                : <>
                  <span>用手机相机或其他 App「扫一扫」扫描左侧二维码</span>
                  <span>打开链接后点「确认登录」，该手机即成为此机器人的控制端</span>
                </>}
            </>}
            {phase === "expired" && <>
              <span className="bot-bind-state-title">二维码已过期</span>
              <button className="remote-mini-btn" onClick={() => void start()}><RefreshCw size={12} />重新扫码</button>
            </>}
          </div>
        </div>
      )}
      {phase === "bound" && (
        <div className="bot-bind-panel">
          <div className="bot-bind-state">
            <span className="bot-bind-state-title"><span className="bind-ok">✓</span>{isWeixin ? "微信已连接" : "绑定成功"}</span>
            <span>{isWeixin ? "现在直接在微信里给这个账号发消息即可对话，回复会实时回推到微信。" : "手机已确认登录，可远程控制该机器人。"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function isImageSource(value: string): boolean {
  if (value.startsWith("data:") || value.startsWith("http")) return true;
  return value.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 64));
}
