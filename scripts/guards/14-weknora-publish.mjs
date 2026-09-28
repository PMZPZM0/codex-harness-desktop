/**
 * 预检守卫组：14-weknora-publish —— 知识库后端的**发布链路一致性**。
 *
 * 为什么单独立组：这条链路上有两处「静默失联」点，坏了都不会红、只会在用户手里表现为
 * 「点了安装没反应 / 报未发布」：
 *   · 应用侧的**资产名与 tag 约定**（electron/features/weknora-ipc.ts）必须与 CI
 *     （.github/workflows/build-weknora.yml）**逐字一致** —— 改一边不改另一边，下载 404；
 *   · 发布包必须含 **exe + web/ + config/ + VERSION** —— 缺 config/config.yaml 时
 *     WeKnora 进程会直接退出（ReadInConfig 失败），装上也起不来。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【193】知识库发布链路一致性（应用 ↔ CI）"));

  const ipc = readFileSync(join(ROOT, "electron", "features", "weknora-ipc.ts"), "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "build-weknora.yml"), "utf8");

  /* ① 资产名模板逐字一致（应用拼 URL / CI 产出文件名） */
  const appAsset = "weknora-lite-v${WEKNORA_VERSION}-windows-x64.zip";
  const ciAsset = "weknora-lite-v${VERSION}-windows-x64.zip";
  (ipc.includes(appAsset) ? ok : fail)(
    `【193】应用侧资产名模板在位（${appAsset}）`
  );
  (ci.includes(`asset=${ciAsset}`) ? ok : fail)(
    `【193】CI 产出同名资产（${ciAsset}）—— 不一致 ⇒ 用户点安装必然 404`
  );

  /* ② tag 约定一致（应用拼下载前缀 / CI 创建 Release 的 tag） */
  (ipc.includes("weknora-v${WEKNORA_VERSION}") ? ok : fail)(
    "【193】应用侧下载前缀用 weknora-v<版本> tag"
  );
  (ci.includes("tag=weknora-v${VERSION}") && ci.includes('"weknora-v*"') ? ok : fail)(
    "【193】CI 由 weknora-v* tag 触发并建同名 Release"
  );

  /* ③ 发布包内容自检（缺 config/ 装了也起不来） */
  const required = ["weknora-lite.exe", "web/index.html", "config/config.yaml", "VERSION"];
  (required.every((f) => ci.includes(f)) ? ok : fail)(
    "【193】CI 组装后自检四件套（exe / web/index.html / config/config.yaml / VERSION）"
  );
  // 应用侧启动前也校验 config.yaml（双层保险：发错包 vs 装错包）
  (ipc.includes('"config", "config.yaml"') ? ok : fail)(
    "【193】应用侧启动前也校验 config/config.yaml（双层保险）"
  );

  /* ④ 构建配方关键位（CGO + sqlite_fts5 是 FTS5 检索的前提） */
  (/-tags "sqlite_fts5"/.test(ci) && /CGO_ENABLED: "1"/.test(ci) ? ok : fail)(
    "【193】CI 用 CGO_ENABLED=1 + tags=sqlite_fts5 构建（缺 FTS5 则检索功能不可用）"
  );
  (/go-version-file: weknora-src\/go\.mod/.test(ci) ? ok : fail)(
    "【193】Go 版本跟上游 go.mod（写死会在上游升级时静默用错工具链）"
  );

  /* ⑤ 结构体检：workflow 不许有制表符缩进（YAML 硬性），且关键步骤齐全 */
  const tabLines = ci.split(/\r?\n/).filter((line) => /^\t/.test(line)).length;
  (tabLines === 0 ? ok : fail)(`【193】workflow 无制表符缩进（YAML 要求空格）${tabLines ? `：${tabLines} 行` : ""}`);
  ["actions/setup-go@", "actions/setup-node@", "gh release create", "gh release upload"].every((key) => ci.includes(key)) ? ok : fail(
    "【193】CI 步骤齐全（Go / Node / Release 创建与上传）"
  );
}
