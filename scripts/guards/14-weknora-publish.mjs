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

  /* ⑥ 下载源：**镜像优先 + 收集全部候选**（09-28 用户「点安装转一下就没了」+ 要求国内加速）
        ⛔ 旧实现撞到第一个可用源就 break ⇒ 候选恒为 1 个，「逐个退避」形同虚设；且顺序是
        直连优先（对国内用户最慢）。判据锚「收集循环里没有 break」+「镜像排在直连前面」。 */
  (function checkDownloadSources() {
    // ⛔ 别用「两个进度上报点的区间」当窗口 —— 这些字面量在文件里可能先于目标代码出现，
    //    slice 会得到空串（断言恒假/恒真）。直接锚那两行的**代码形态**。
    const loopLine = ipc.match(/for \(const prefix of \[[^\]]*\]\)[^\n]*/)?.[0] ?? "";
    (/GITHUB_MIRROR_PREFIXES/.test(loopLine) && /,\s*""\]/.test(loopLine) ? ok : fail)(
      `【193】下载源探测按「镜像优先 → 直连兜底」排列（国内直连 GitHub 最慢）｜实际：${loopLine.trim().slice(0, 70) || "(未找到循环)"}`
    );
    // 收集循环体内不得有 break（撞到第一个可用源就停 ⇒ 候选恒 1 个，退避形同虚设）
    const pushCtx = ipc.slice(Math.max(0, ipc.indexOf("candidates.push(url)") - 120), ipc.indexOf("candidates.push(url)") + 40);
    (!/break;/.test(pushCtx) ? ok : fail)(
      "【193】候选源收集**不 break**（撞到第一个就停 ⇒ 只有 1 个候选，下载失败没有退路）"
    );
    (/failures\.push/.test(ipc) ? ok : fail)(
      "【193】下载失败汇总每个源的失败原因（只报最后一个会让用户以为没试镜像）"
    );
  })();

  /* ⑦ 错误粘性：状态会被 refresh 重拉，错误必须存住（否则界面上只闪一帧 = 用户什么都没看到） */
  (/if \(error\) lastError = error;/.test(ipc) ? ok : fail)(
    "【193】失败原因粘在 lastError 上（状态被 refresh 重拉时不会把错误冲掉）"
  );
  ((ipc.match(/clearError\(\);/g) ?? []).length >= 4 ? ok : fail)(
    `【193】各操作入口清错误（install/start/stop/uninstall ≥4 处，实测 ${(ipc.match(/clearError\(\);/g) ?? []).length}）`
  );
}
