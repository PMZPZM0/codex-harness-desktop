// 落库 0.0.13 Windows 版（幂等：先滤同 version+channel+platform 再重建）
// 用法：ssh ch-release "node -" < scripts/insert-0.0.13-win.cjs
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/var/www/codex-harness-releases";
const DB = path.join(ROOT, "data/releases.json");
const FILES = path.join(ROOT, "data/files");

const VERSION = "0.0.13";
const PLATFORM = "windows";
const FILENAME = "Codex Harness Desktop Setup 0.0.13.exe";
const STORED = "0.0.13_CodexHarness-Setup-0.0.13.exe";

const CHANGELOG = [
  "【新功能】首次见面引导：新会话第一次对话，Codex 会热情招呼、邀请你给它取个名字，并用聊天语气一口气了解你（称呼/用途/技术栈/喜欢的回复风格/语气/爱好/想长期记住的习惯）；谈完自动记住，之后所有新会话都不再引导，名字长期生效",
  "【新功能】欢迎页「项目地址」选择：输入框左上角可切「使用项目地址」（与右上角选择联动）或「不使用项目地址」——后者每次新建会话自动创建独立临时目录，各会话互不干扰；发送首条消息后该选项自动隐藏",
  "【新功能】渠道语音消息转写：在飞书给机器人发语音，会自动下载并本地转写成文字执行（复用会话绑定与回复机制；需在开发工具页安装 FFmpeg）",
  "【新功能】输入框语音听写：发送键旁新增麦克风按钮，说话时中文实时字幕直接进输入框（不自动发送）；任务运行中发送/暂停合并为一个按钮，输入内容平滑过渡成发送、发出后自动回到暂停",
  "【新功能】音色克隆模型入口（开发工具页按需下载，约 156MB 不进安装包）：导入一段参考音频即可克隆音色朗读任意文本，现有 5 个内置音色不受影响",
  "【修复】设置页在软件渲染或窗口后台时可能一直显示「正在载入…」（开发工具/语音模型卡片因此看不到），已加兜底",
  "【修复】运行中的对话切出去再切回来，正文不再重新播放一次出字",
  "【修复】配置文件的错位孤儿键自动清理；复制内容统一走主进程剪贴板（修复窗口失焦时复制失败）",
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
    mandatory: 0,
    uploaded_by: "admin",
    uploaded_at: Date.now(),
  });
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);
  console.log("inserted", VERSION, PLATFORM, stat.size, sha256.slice(0, 12), "| total releases:", db.releases.length);
}

main();
