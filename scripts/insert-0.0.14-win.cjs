// 落库 0.0.14 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.14-win.cjs
// ⚠️ 强更新：mandatory = 1（v0.0.13 的自动化工具包缺失是致命问题，所有人必须升上来）
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.14";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.14.exe";
const STORED = "0.0.14_CodexHarness-Setup-0.0.14.exe";

const CHANGELOG = [
  "【重要修复】随包内置浏览器内核：Playwright Chromium 内核与 CloakBrowser 反检测内核现在直接打进安装包，不再依赖联网下载（v0.0.13 因自动化工具包缺失，桌面/浏览器自动化全线不可用）",
  "【新功能】专家中心：侧栏「专家/专家团」进入后按领域分类陈列全部 32 位专家（研发交付/投资交易/内容创作/数据分析/市场增长/产品设计/专项专家），点卡直达一对一会话",
  "【新功能】内置 PPT 专家「呈象」：捆绑 ppt-master 技能包，可直接产出可编辑 PPTX、页面重构、母版美化、加旁白与导出演示视频",
  "【新功能】内置专家「知微」（内容流量预测策略师）+ 技能随应用安装（零拷贝市场注册，引擎原位发现）",
  "【优化】专家全员改用笔名（承枢/观澜/执舵/文枢…），一眼可辨角色；入口卡顺序调整为 子智能体 → 专家中心 → 专家团",
  "【新功能】独立会话弹窗：会话可拖出成独立窗口，主界面自动隐藏该会话，关闭即回主应用",
  "【安全】手机远控与机器人渠道双重配对鉴权（6 位配对码 + 电脑端审批，链接不再夹带凭据）；渲染层入参校验；更新链强制 https + SHA-256 校验",
  "【语音】唤醒词模型（按需下载，读音匹配）、内置音色换成开源官方样本、音色克隆、通话界面静音/时长/跳过本段/字幕回看、试听提速且可停止",
  "【修复】多窗口模型与思考等级不再串味（会话级作用域）；排队消息「立即」语义与展示；机器人档案持久化到主进程（不再因清缓存丢失）；已批准设备打开面板即常驻展示",
  "【修复】运行态判据失效与跨会话污染、关窗不再误杀运行中任务、设置页「正在载入…」兜底、切换会话正文不再重播",
].join("\n");

function main() {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  db.releases = db.releases.filter((r) => !(r.version === VERSION && (r.platform || "windows") === PLATFORM && r.channel === "stable"));
  const filePath = path.join(FILES, STORED);
  const stat = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  db.releases.push({
    id: db.nextId++,
    version: VERSION,
    channel: "stable",
    platform: PLATFORM,
    filename: FILENAME,
    stored_name: STORED,
    size: stat.size,
    sha256,
    changelog: CHANGELOG,
    mandatory: 1,
    uploaded_by: "admin",
    uploaded_at: Date.now(),
  });
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted", VERSION, PLATFORM, "mandatory=1", stat.size, sha256.slice(0, 12), "| total releases:", db.releases.length);
}

main();
