const { api } = require("./gh-api.cjs");
const VERSION = "0.0.17";
const CHANGELOG = [
  "【新功能】历史分页懒加载：打开会话只渲染最近 5 个来回，往上滚一页一页续载更早历史，切换会话速度恒定",
  "【新功能】滚回最新自动收回：往上看完历史后回到最新，展开的历史自动收起；切走再切回也是清爽的最新一代",
  "【新功能】消息刻度尺同步：加载新一页时刻度自动补齐，刻度多了自动压缩变短，滚轮一次滑一页",
  "【新功能】统一内置通道：切换供应商后新旧会话都直接可用（不再需要任何会话迁移）",
  "【修复】切供应商后旧会话「点一次提醒一次」：打开会话的对齐改为静默，不再打扰",
  "【修复】「正在载入更早的消息…」常驻：续载请求加超时保护，切换会话不再残留加载提示",
  "【修复】供应商开关：点启用/停用开关时右侧详情同步跟随",
  "【修复】团队主会话归档/删除时，同簇成员会话一并处理",
  "【优化】用户消息点击即上屏（原先要等两段记忆读取）",
  "【优化】wire_api 残留档案读入即归一化（删供应商重配也清不掉的根因）",
].join("\n");

const BODY = [
  "## Codex Harness Desktop v" + VERSION,
  "",
  "### 更新内容",
  CHANGELOG.split("\n").map((l) => "- " + l).join("\n"),
  "",
  "### macOS 安装说明（未签名）",
  "下载对应芯片的 zip 解压后把 App 拖进「应用程序」。首次打开若被 Gatekeeper 拦住：",
  "1. **右键**点 App → 选「打开」（不要双击）",
  "2. 或在终端执行：`xattr -cr \"/Applications/Codex Harness Desktop.app\"`",
  "",
  "### 下载",
  "- Windows：`Codex Harness Desktop Setup " + VERSION + ".exe`",
  "- macOS Apple 芯片（M 系列）：`...-arm64-mac.zip`",
  "- macOS Intel：`...-x64-mac.zip`",
  "",
  "Windows 更新也可直接在应用内检查更新（发布站 www.jvszzp.ltd）。",
].join("\n");

function main() {
  const cmd = process.argv[2];
  if (cmd === "create") {
    const existing = JSON.parse(api("/releases?per_page=20"));
    const hit = existing.find((r) => r.tag_name === "v" + VERSION);
    if (hit) { console.log("已存在 release v" + VERSION + " id=" + hit.id); console.log(JSON.stringify({ id: hit.id, upload_url: hit.upload_url })); return; }
    const res = api("/releases", { method: "POST", body: JSON.stringify({ tag_name: "v" + VERSION, name: "v" + VERSION, body: BODY, draft: false, prerelease: false, target_commitish: "main" }) });
    const r = JSON.parse(res);
    console.log("创建成功 id=" + r.id + " tag=" + r.tag_name);
    require("fs").writeFileSync("D:/Codex Harness Desktop/.e2e-artifacts/release-0.0.17.json", JSON.stringify({ id: r.id, upload_url: r.upload_url, html_url: r.html_url }, null, 2), "utf8");
    console.log("html_url: " + r.html_url);
    return;
  }
  if (cmd === "list") {
    const rs = JSON.parse(api("/releases?per_page=30"));
    for (const r of rs) console.log("  " + r.tag_name + " | id=" + r.id + " | assets=" + (r.assets || []).length + " | " + (((r.assets || []).reduce((a, b) => a + (b.size || 0), 0)) / 1048576 / 1024).toFixed(2) + "GB");
    return;
  }
  if (cmd === "delete-old" || cmd === "delete-all") {
    const keep = cmd === "delete-all" ? [] : ["v" + VERSION];
    const rs = JSON.parse(api("/releases?per_page=50"));
    let n = 0;
    for (const r of rs) {
      if (keep.includes(r.tag_name)) { console.log("  保留 " + r.tag_name); continue; }
      api("/releases/" + r.id, { method: "DELETE" });
      console.log("  已删除 " + r.tag_name + " (id=" + r.id + ", assets=" + (r.assets || []).length + ")");
      n++;
    }
    console.log("  共删除 " + n + " 个 release");
    return;
  }
  console.log("用法: node gh-release.cjs create|list|delete-old");
}
main();
