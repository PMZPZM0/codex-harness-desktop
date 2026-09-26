/**
 * 预检守卫组：07-turn-fold
 * 分节：【43】（原 L4094–L7963）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  AUTO_CONTINUE_MAX_ATTEMPTS, C, MOOD_HEADING, ROOT, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, codeOnly, composeMoodInstructions, createHash, createRequire, decayMood, emptyMood, existsSync, fail, homedir, isTruncatedEmptyTurn, join, mainSrc, moodBlock, moodSignature, moodTone, normalizeMood, ok, pathToFileURL, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readVoiceSettingsSrc, readdirSync, relative, spawnSync, statSync, turnOutputStats, walk, warn,
} from "./_ctx.mjs";
import { isQueueAlreadyStartedError } from "../../src/lib/queue-errors.mjs";
import { splitMarkdown, trimInvisibleSpace } from "../../src/lib/markdown-blocks.mjs";

export async function run() {

  /* ══ 【43】原 L4094–L7963 ══ */
  {
{
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mainC = readMainSource();
  const toolchainC = stripC(readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8"));
  const terminalC = stripC(readFileSync(join(ROOT, "electron", "terminal.ts"), "utf8"));
  const remoteC = stripC(readFileSync(join(ROOT, "electron", "remote.ts"), "utf8"));
  const updaterC = stripC(readFileSync(join(ROOT, "electron", "engine-updater.ts"), "utf8"));
  const voiceSettingsC = stripC(readFileSync(join(ROOT, "electron", "voice", "voice-settings.ts"), "utf8"));
  const voiceSectionC = stripC(readVoiceSettingsSrc());
  const hotkeyMatchC = stripC(readFileSync(join(ROOT, "src", "voice", "hotkey-match.ts"), "utf8"));
  const macCfg = readFileSync(join(ROOT, "build", "electron-builder.mac.cjs"), "utf8");
  const prepMac = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  const verifyTools = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  const sliceFn = (src, needle, len) => { const i = src.indexOf(needle); return i < 0 ? "" : src.slice(i, i + len); };

  // ① 麦克风用途声明：macOS 缺这条不是「弹不出授权框」，是**进程被系统直接杀掉**（取麦即闪退）
  /NSMicrophoneUsageDescription/.test(macCfg)
    ? ok("【32】mac Info.plist 声明麦克风用途（缺了语音首次取麦必闪退）")
    : fail("【32】electron-builder.mac.cjs 缺 NSMicrophoneUsageDescription —— mac 上语音通话/听写取麦即被系统杀进程");

  // ② mac 关窗 ≠ 退出：window-all-closed 里若照 Windows 清理服务，点 Dock 重开得到「窗口在、功能全哑」
  {
    const body = sliceFn(mainC, 'app.on("window-all-closed"', 520);
    (/process\.platform === "darwin"\) return;/.test(body) && /cleanupAll\(\)/.test(body) && /app\.quit\(\)/.test(body))
      ? ok("【32】window-all-closed 在 mac 上保留服务（关窗后 Dock 重开仍可用）")
      : fail("【32】window-all-closed 没做 darwin 分叉 —— mac 关窗后重开窗口引擎/服务/调度器全哑");
    // 但要确认清理没被整体删掉：before-quit 仍必须 cleanupAll（否则 mac 永不清理）
    const quitBody = sliceFn(mainC, 'app.on("before-quit"', 420);
    /cleanupAll\(\)/.test(quitBody)
      ? ok("【32】before-quit 仍然 cleanupAll（mac 上服务保活但不泄漏）")
      : fail("【32】before-quit 不再 cleanupAll —— mac 关窗保活后永远不释放引擎/端口");
  }

  // ③ cloudflared（手机配对的公网隧道）：路径必须走内置工具目录 + 平台化文件名，且 mac 包要真的带上
  {
    const fnBody = sliceFn(remoteC, "function resolveCloudflaredBin", 760);
    // 判据必须精确：Windows 分支**本来就该**叫 cloudflared.exe（不能笼统禁止 .exe），
    // 要锁的是「mac 也有对应布局」+「解析基于内置工具目录而不是 process.cwd()」。
    (fnBody && /toolsRoot\(\)/.test(fnBody) && /\["cloudflared", "cloudflared"\]/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】cloudflared 走 toolsRoot + 平台化文件名（不再写死 cwd/…exe）")
      : fail("【32】remote.ts 的 cloudflared 解析仍依赖 process.cwd / 缺 mac 布局 —— mac 上手机配对隧道永不启动");
    /cloudflared-darwin-\$\{arch === "arm64" \? "arm64" : "amd64"\}\.tgz/.test(prepMac)
      ? ok("【32】prepare-mac-tools 现造 cloudflared(darwin) 并补执行位")
      : fail("【32】prepare-mac-tools 不造 cloudflared —— mac 包里没有隧道二进制");
    /path\.join\(root, "cloudflared", "cloudflared"\)/.test(verifyTools)
      ? ok("【32】mac 产物校验断言 cloudflared 存在且有执行位")
      : fail("【32】mac 产物校验没有 cloudflared 断言 —— 缺了要到用户那儿才发现");
  }

  // ④ ffmpeg：渠道语音转码依赖它，mac 布局是 tools/ffmpeg/bin/ffmpeg（无后缀），旧实现只找 .exe + 用 cwd
  {
    const fnBody = sliceFn(mainC, "function resolveFfmpegPath", 800);
    (/process\.platform === "win32" \? \["ffmpeg", "ffmpeg\.exe"\] : \["ffmpeg", "bin", "ffmpeg"\]/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】ffmpeg 路径平台化（mac = tools/ffmpeg/bin/ffmpeg，不依赖 cwd）")
      : fail("【32】resolveFfmpegPath 仍只找 ffmpeg.exe / 依赖 cwd —— mac 上渠道语音转码必失败");
  }

  // ⑤ 系统级探测：mac 上 Docker Desktop 装在 /Applications，CLI 在 /usr/local|/opt/homebrew；PATH 分隔符也不能写死
  {
    const fnBody = sliceFn(mainC, "function runtimeInstalledBySystem", 1400);
    (/\/Applications\/Docker\.app/.test(fnBody) && /opt\/homebrew\/bin\/docker/.test(fnBody))
      ? ok("【32】mac 上探测 Docker Desktop（装了不再显示「未安装」）")
      : fail("【32】darwin 分支没有 docker 探测 —— mac 装了 Docker 也一直显示「未安装」");
    /split\(path\.delimiter\)/.test(fnBody)
      ? ok("【32】docker 的 PATH 探测用 path.delimiter（不再写死「;」）")
      : fail("【32】docker 的 PATH 探测写死「;」 —— POSIX 上永远探不到");
  }

  // ⑥ npm 全局 shim 清理：POSIX 落在 <prefix>/bin/<pkg>，旧清单只有 Windows 的 .cmd/.ps1
  {
    const fnBody = sliceFn(mainC, "function npmShimPaths", 800);
    /path\.join\(globalDir, "bin", pkg\)/.test(fnBody)
      ? ok("【32】npm 全局 shim 清理覆盖 POSIX 的 bin/<pkg>")
      : fail("【32】npmShimPaths 缺 bin/<pkg> —— mac 上卸载 npm 包后 shim 残留指向空目录");
  }

  // ⑦ CODEX_REAL_PWSH：mac 的 pwsh 无 .exe，写死路径会让这个环境变量永不设置
  {
    const fnBody = sliceFn(toolchainC, "export function toolchainEnv", 1400);
    (/const realPwsh = bundledPwsh\(\);/.test(fnBody) && !/pwsh", "pwsh\.exe"/.test(fnBody))
      ? ok("【32】CODEX_REAL_PWSH 走 bundledPwsh()（平台解析）")
      : fail("【32】toolchainEnv 仍写死 pwsh.exe —— mac 上 CODEX_REAL_PWSH 永不设置");
  }

  // ⑧ 引擎更新用 tar：darwin 给绝对路径（GUI 进程 PATH 是 launchd 最小集）
  {
    const fnBody = sliceFn(updaterC, "function tarExecutable", 420);
    /\/usr\/bin\/tar/.test(fnBody)
      ? ok("【32】engine-updater 在 darwin 用 /usr/bin/tar")
      : fail("【32】engine-updater 的 tarExecutable 没有 darwin 分支 —— mac 上靠裸名 tar，PATH 被改过就落空");
  }

  // ⑨ 终端面板：PATH 分隔符 / 路径拼接 / 自绘提示符 三处都得平台化
  {
    (/split\(path\.delimiter\)/.test(terminalC) && /path\.join\(dir, name\)/.test(terminalC) && !/split\(";"\)/.test(terminalC))
      ? ok("【32】终端查找用 path.delimiter + path.join（不再反斜杠拼接 / 写死「;」）")
      : fail("【32】terminal.ts 仍用反斜杠拼接或 split(\";\") —— POSIX 上候选目录解析全错");
    /process\.platform === "win32" \? `PS \$\{this\.cwd\}> ` : `\$\{this\.cwd\} \$ `/.test(terminalC)
      ? ok("【32】自绘提示符平台化（mac 不再显示 PowerShell 风格的「PS …>」）")
      : fail("【32】终端提示符没平台化 —— mac 上显示「PS /Users/x>」");
  }

  // ⑩ 语音快捷键：默认键用 CommandOrControl；匹配与录入/显示都要按平台分叉
  {
    /accelerator: "CommandOrControl\+Shift\+M"/.test(voiceSettingsC)
      ? ok("【32】默认呼叫快捷键 = CommandOrControl+Shift+M（Windows 仍是 Ctrl，mac 是 ⌘）")
      : fail("【32】默认呼叫键写死 Ctrl+… —— mac 上不符合直觉（且不该记成 Super）");
    (/const cmdOrCtrl = parts\.includes\("cmdorctrl"\);/.test(hotkeyMatchC) && /needsCtrl = cmdOrCtrl \? !mac/.test(hotkeyMatchC))
      ? ok("【32】hotkey-match 按平台解析 CommandOrControl（mac → metaKey）")
      : fail("【32】hotkey-match 把 CommandOrControl 一律当 ctrlKey —— mac 上 ⌘⇧M 永远匹配不上");
    (/IS_MAC_UI \? "Command" : "Super"/.test(voiceSectionC) && /showHotkey\(/.test(voiceSectionC))
      ? ok("【32】语音快捷键录入/显示平台化（mac 记 Command、显示 ⌘⇧M）")
      : fail("【32】语音快捷键仍一律记 Super / 原样打印 accelerator —— mac 用户看到「Super+Shift+M」");
  }

  // ⑪ 开发工具卡文案：specs 是按 Windows 写的，mac 上「装 Git 约 90 MB」这类说法会误导
  {
    (/const DARWIN_SPEC_TEXT/.test(mainC) && /specFor\(id, spec\)/.test(mainC))
      ? ok("【32】开发工具卡文案按平台覆盖（git/openssl/docker 在 mac 上不再照搬 Windows 口径）")
      : fail("【32】缺少 DARWIN_SPEC_TEXT/specFor —— mac 上开发工具卡仍在说「装 Git / 约 90 MB」");
  }

  // ⑫ 行为断言：accelerator 原文 → mac 写法（纯函数，与平台探测解耦；mac 上显示什么这里说了算）
  {
    const { macHotkeyLabel } = await import("../../src/lib/hotkey.mjs");
    const rows = [
      ["CommandOrControl+Shift+M", "⌘⇧M"],
      ["Command+Shift+M", "⌘⇧M"],
      ["Super+Space", "⌘Space"],
      ["Option+Space", "⌥Space"],
      ["Ctrl+Shift+F", "⌘⇧F"],
    ];
    const bad = rows.filter(([input, expected]) => macHotkeyLabel(input) !== expected);
    (bad.length === 0 ? ok : fail)(`【32】accelerator → mac 写法（${rows.length} 条${bad.length ? "，错：" + bad.map(([i, e]) => `${i}→${macHotkeyLabel(i)}(期望${e})`).join(",") : ""}）`);
  }

  // ⑬ 「成功绿」必须是真绿：--green 曾被写成 #1e1e1c（近黑），导致全系统 299 处成功态视觉
  //   全部失效成中性色（用户实测「内置插件启用跟禁用一个状态，没有颜色区分」的根因之一）。
  //   判定：两套主题的 --green 其 G 通道必须显著高于 R/B（中性色三通道几乎相等）。
  {
    const cssC = readStyles();
    const greens = [...cssC.matchAll(/--green:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
    const isGreen = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return g - Math.max(r, b) >= 40;   // G 通道至少高出 40 才算绿
    };
    const uses = (cssC.match(/var\(--green\)/g) || []).length;
    (greens.length >= 2 && greens.every(isGreen))
      ? ok(`【32】--green 是真绿（${greens.join(" / ")}；影响 ${uses} 处成功态视觉）`)
      : fail(`【32】--green 回归成中性色（当前：${greens.join(" / ") || "未找到"}）—— ${uses} 处成功态视觉全部失效`);
  }

  // ⑭ 启动加载页（09-17）：实测挂载后还要 1.3~2.1s 才拿到首屏数据，此前无任何反馈。
  //   三条硬约束：① 覆盖层必须活到数据就绪（React 一挂载就消失 = 回到空窗）
  //              ② 样式定义在 index.html（JS 未加载时也要能显示）+ 图标用蓝色原版
  //              ③ 背景跟主题（固定深黑会在亮色主题下黑闪）
  {
    const boot = readFileSync(join(ROOT, "src", "components", "BootSplash.tsx"), "utf8");
    const bootCode = boot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const appBoot = readAppUi();
    (/export function BootSplash/.test(bootCode) && /done\b/.test(bootCode) && /boot-splash-leaving/.test(bootCode))
      ? ok("【32】启动加载页存在且带淡出（BootSplash + boot-splash-leaving）")
      : fail("【32】BootSplash 缺失或没有淡出 —— 启动空窗回归（挂载后有 1.3~2.1s 无反馈）");
    (/<BootSplash/.test(appBoot) && /done=\{bootReady \|\| Boolean\(showLogin\)\}/.test(appBoot))
      ? ok("【32】启动页活到首屏数据就绪才退场（done=bootReady，不是挂载即退）")
      : fail("【32】BootSplash 的 done 没绑首屏数据 —— 挂载即退场，等于没做");
    (/\.boot-splash\s*\{/.test(html) && /data-theme="dark"\]\s*\.boot-splash/.test(html) && /boot-splash-logo/.test(html) && /icon\.png/.test(html))
      ? ok("【32】启动页样式内联在 index.html（含主题分叉 + 蓝图标）")
      : fail("【32】index.html 缺启动页内联样式/主题分叉/蓝图标 —— 首帧会黑闪或用错图标");
    (!/boot-splash-logo">CH</.test(html) && !/>CH<\/div>/.test(html))
      ? ok("【32】启动页不再用 CH 黑块（与侧栏徽标一致改为蓝图标）")
      : fail("【32】启动页仍是 CH 黑块 —— 与侧栏已改的蓝图标不一致");
    (/performance\.now\(\) >= MIN_SHOW_MS/.test(bootCode))
      ? ok("【32】启动过快时跳过启动页（避免一闪而过）")
      : fail("【32】缺少最短显示阈值判定 —— 快机器上会闪一下");
  }

  // ⑮ 设置页「使用帮助」（09-17 用户要求：模型/插件/技能/MCP/专家团/语音/开发工具面向新手）。
  //   痛点：帮助是"加了但挂错页/少挂一页"最容易复发的问题（每页各写一个按钮，删改时容易漏）。
  //   所以断言分两层：内容库 key 齐全 + 页面挂载数量达标 + 弹窗真的在渲染树里。
  {
    const helpC = readFileSync(join(ROOT, "src", "components", "HelpDialog.tsx"), "utf8");
    const appC = readAppUi();
    const voiceC = readVoiceSettingsSrc();
    const HELP_KEYS = ["model", "plugins", "skills", "mcp", "agentteam", "voice", "devtools"];
    const missingKeys = HELP_KEYS.filter((key) => !new RegExp(`\\b${key}:\\s*\\{`).test(helpC));
    (missingKeys.length === 0)
      ? ok(`【32】帮助内容库覆盖 ${HELP_KEYS.length} 个主题（模型/插件/技能/MCP/专家团/语音/开发工具）`)
      : fail(`【32】帮助内容库缺主题：${missingKeys.join(", ")} —— 对应页面点帮助会打不开或空白`);
    // ? 号（09-17 用户：「文字赘述过多，都改成 ? 号，鼠标放上去展示」「帮助展示的位置放的
    // 都不好看」）：各页那个占位的「帮助」按钮已退休、长说明收进标题旁的 ?。所以断言从
    // "帮助按钮数"改成三层：① ? 挂载数 ② 兼作帮助入口的 ? 数 ③ 「赘述回潮」判据。
    const hintCount = (appC.match(/<PageInfo\b/g) || []).length;
    (hintCount >= 15)
      ? ok(`【32】设置页挂了 ${hintCount} 处 ? 号（说明收进 ?，头部恒为一行）`)
      : fail(`【32】? 号只有 ${hintCount} 处 —— 说明又被摊回标题下了（赘述回潮）`);
    const keyedHints = (appC.match(/helpKey="/g) || []).length;
    (keyedHints >= 6)
      ? ok(`【32】${keyedHints} 处 ? 兼作「完整帮助」入口（HelpButton 退休后入口没丢）`)
      : fail(`【32】兼帮助入口的 ? 只有 ${keyedHints} 处 —— 有页面的完整帮助从此打不开`);
    // ⛔ 比"数量够"更强的判据：**每个帮助主题都必须有 ? 入口**。数量达标不代表没有孤儿 ——
    //    「模型」页（标题是 provider-list-head、不是 settings-copy）与「专家和专家团」页
    //    （说明只有一句短话、不在收编名单里）的入口就真被漏掉了：内容库还在，用户点不到。
    //    这正是本条守卫要防的形态（本轮 code review 抓到的两个真问题之一）。
    const orphanKeys = HELP_KEYS.filter((key) => !new RegExp(`helpKey="${key}"`).test(appC + voiceC));
    (orphanKeys.length === 0)
      ? ok(`【32】${HELP_KEYS.length} 个帮助主题都有 ? 入口（无"内容库在、入口丢了"的孤儿）`)
      : fail(`【32】这些主题的帮助入口丢了：${orphanKeys.join(", ")} —— 内容库还在，但用户点不到`);
    // ⛔ 赘述回潮的可证伪判据：settings-copy 区块里不该再有 >40 字的内联段落。
    //    短句（≤40 字）允许内联 —— 它只占一行，硬收进 ? 反而让用户多点一次。
    const longCopies = appC.split(/\r?\n/)
      .filter((line) => line.includes("settings-copy"))
      .map((line) => {
        const m = line.match(/<p>([\s\S]*?)<\/p>/);
        return m ? m[1].replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").length : 0;
      })
      .filter((n) => n > 40);
    (longCopies.length === 0)
      ? ok("【32】设置页说明都已收进 ?（settings-copy 里没有 >40 字的内联段落）")
      : fail(`【32】有 ${longCopies.length} 处说明又摊回标题下（${longCopies.join("/")} 字）—— 应收进 ?`);
    (/<HelpDialog\b/.test(appC))
      ? ok("【32】HelpDialog 挂在渲染树里（弹窗能真正打开）")
      : fail("【32】HelpDialog 没挂到渲染树 —— 点帮助不会有任何反应");
    // ⛔ ? 里的「查看完整帮助」靠 context 拿 setHelpKey：没注入 = 点了没反应，且是静默失效
    (/HelpOpenContext\.Provider/.test(appC) && /value=\{setHelpKey\}/.test(appC))
      ? ok("【32】? 的帮助出口已注入（HelpOpenContext.Provider value=setHelpKey）")
      : fail("【32】HelpOpenContext 没注入 —— ? 里点「查看完整帮助」没有任何反应");
    (/PageInfo[\s\S]{0,220}?helpKey="voice"/.test(voiceC))
      ? ok("【32】语音页 ? 在（在子组件里，最容易漏改的一页）")
      : fail("【32】语音页缺 ? 入口 —— 用户点名的页面之一是它");
    // ? 的气泡必须 portal + fixed：设置内容是滚动容器，absolute 浮层会被裁掉下半截
    const headC = readFileSync(join(ROOT, "src", "components", "SettingsHead.tsx"), "utf8");
    const cssAll = readStyles();
    (/\.page-info-pop[\s\S]{0,220}?position:\s*fixed/.test(cssAll))
      ? ok("【32】? 气泡 fixed 定位（不会被设置页滚动容器裁切）")
      : fail("【32】? 气泡不是 fixed 定位 —— 会被滚动容器裁掉下半截（内容读不全）");
    (/createPortal/.test(headC) && /getBoundingClientRect/.test(headC))
      ? ok("【32】? 气泡走 portal + 实测定位（宽气泡不会溢出屏幕右侧）")
      : fail("【32】? 气泡没走 portal —— 会被祖先容器的 overflow 裁切");
    // 新手帮助必须写清「怎么开始」，不能只有概念说明
    const thin = HELP_KEYS.filter((key) => {
      const at = helpC.indexOf(`${key}: {`);
      if (at < 0) return true;
      const block = helpC.slice(at, helpC.indexOf("\n  },", at));
      return (block.match(/^\s{10}"/gm) || []).length < 3;
    });
    (thin.length === 0)
      ? ok("【32】每个帮助主题都有 ≥3 条操作步骤（不是概念说明）")
      : fail(`【32】这些主题的步骤太少（不足 3 条）：${thin.join(", ")}`);

    // ⑯ 设置总览（09-17 用户要求：标题栏加「设置总览」，让新手快速熟悉整个设置界面）
    //   最容易复发的失效形态：**新增设置页但总览没同步**——新手照总览找不到那页，比没有总览更糟。
    //   所以核心断言是「总览页名集合 ⊇ settingsNav 的展示文案集合」。
    const overviewAt = helpC.indexOf("export const OVERVIEW_GROUPS");
    const overviewBlock = overviewAt < 0 ? "" : helpC.slice(overviewAt, helpC.indexOf("\n];", overviewAt));
    const navBlock = (() => {
      const at = appC.indexOf("const settingsNav");
      return at < 0 ? "" : appC.slice(at, appC.indexOf("\n];", at));
    })();
    const overviewPages = [...overviewBlock.matchAll(/page:\s*"([^"]+)"/g)].map((m) => m[1]);
    const navLabels = [...navBlock.matchAll(/\["[a-z]+",\s*"([^"]+)"/g)].map((m) => m[1]);
    (overviewPages.length > 0)
      ? (() => {
        const missing = navLabels.filter((label) => !overviewPages.includes(label));
        missing.length === 0
          ? ok(`【32】设置总览覆盖导航全部 ${navLabels.length} 页（无遗漏）`)
          : fail(`【32】总览漏了这些设置页：${missing.join("、")} —— 新手照总览找不到它们`);
      })()
      : fail("【32】OVERVIEW_GROUPS 为空 —— 设置总览没有内容");
    (/<HelpDialog[\s\S]{0,400}?onNavigate=/.test(appC) && /settingsNav\.flatMap/.test(appC))
      ? ok("【32】总览页名可点击跳转（页名 → settingsNav 反查页面 key）")
      : fail("【32】总览的 onNavigate 缺失 —— 页名点不动，总览只能看不能用");
    (/className="settings-header-actions"/.test(appC) && /setHelpKey\("overview"\)/.test(appC))
      ? ok("【32】设置标题栏有「设置总览」入口")
      : fail("【32】设置弹窗标题栏缺总览入口 —— 用户看不到这个帮助");
    // 简介里的「共 N 页」若写成固定数字，新增页后会与事实不符；必须是动态计算
    (/共 \$\{OVERVIEW_GROUPS\.reduce/.test(helpC))
      ? ok("【32】总览页数是动态计算的（新增页不会与简介数字打架）")
      : fail("【32】总览简介里的页数写成了固定数字 —— 新增设置页后会误导用户");
  }

  // ⑰ 增强按钮提示气泡（09-17 用户要求：输入内容后在图标上方小气泡，词库 15~20 条）。
  //   ⛔ 触发口径 **09-20 已改**（用户：「增强弹出来频率太高了，一输入文字就出来了，降低一下频率」）：
  //     旧 = ① 每次启动后第一次**输入**必弹 ② 每 5 次发送 ③ 长输入 ≥50 字；气泡 6s；冷却 1min。
  //     新 = ① **第 1 次成功发送后**弹一次 ② 之后每 **10** 次发送 ③ 长输入 ≥**120** 字；气泡 **3s**；冷却 **3min**。
  //     "一输入文字就出来"就是旧 ① 造成的 —— 打字期间一次都不该弹。
  {
    const hints = await import("../../src/lib/enhance-hints.mjs");
    const { ENHANCE_HINTS, pickEnhanceHint, shouldShowHintAfterSends, isLongPrompt, HINT_AUTO_HIDE_MS, HINT_COOLDOWN_MS } = hints;
    (ENHANCE_HINTS.length >= 15 && ENHANCE_HINTS.length <= 25)
      ? ok(`【32】增强提示词库 ${ENHANCE_HINTS.length} 条（用户要求 15~20）`)
      : fail(`【32】提示词库 ${ENHANCE_HINTS.length} 条，超出 15~25 区间`);
    // 长度上限 18：09-20 用户「气泡小一点和文字时间短一点」⇒ 文案必须短，否则在 200px 小气泡里挤成块
    (ENHANCE_HINTS.every((hint) => typeof hint === "string" && hint.trim().length >= 8 && hint.length <= 18))
      ? ok("【32】每条提示都是 8~18 字的完整句子（小气泡收得住）")
      : fail("【32】有提示过短/过长 —— 过短没信息量，过长在 200px 气泡里会挤成块");
    const hintSrcRaw = readFileSync(join(ROOT, "src", "lib", "enhance-hints.mjs"), "utf8");
    const hintSrc = hintSrcRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // ⛔ 旧条件①（「每次启动后第一次输入必弹」）的整套机制必须**彻底移除** —— 用户 09-20 点名
    //   「一输入文字就出来了」。只要 shouldShowHintThisRun / markHintShownThisRun / shownThisRun
    //   还在，就说明它随时可能被重新接回触发链（那正是这次要修的行为）。
    (!/shouldShowHintThisRun|markHintShownThisRun|shownThisRun/.test(hintSrc) && !/localStorage/.test(hintSrc))
      ? ok("【32】旧条件①（启动后首次输入必弹）的机制已彻底移除，也不落盘")
      : fail("【32】残留旧条件①的机制 —— 它会让「一输入文字就弹」复发");
    // 条件②：第 1 次 + 之后每 10 次（第 1 次就是 ① 的替代："首次发送后提醒一次"）
    // ⚠️ 命中集合是 {1,10,20,30…} —— 11 必须是假（它不是"每 10 次的第 1 个"）。
    (shouldShowHintAfterSends(1) === true && shouldShowHintAfterSends(10) === true && shouldShowHintAfterSends(20) === true
      && shouldShowHintAfterSends(11) === false && shouldShowHintAfterSends(5) === false && shouldShowHintAfterSends(0) === false)
      ? ok("【32】条件②：第 1 次 + 之后每 10 次发送（1/10/20 真；11/5/0 假）")
      : fail("【32】条件②节奏判定错误（命中集合应为 {1,10,20,…}）");
    // 条件③：必须是**精确阈值** 120 —— 只测「120 字真、3 字假」测不出阈值被改成 10，
    // 所以补 119/120 的边界（守卫弱点见 memory 09-17）。
    (isLongPrompt("甲".repeat(120)) === true && isLongPrompt("甲".repeat(119)) === false && isLongPrompt("短需求") === false)
      ? ok("【32】条件③：长输入阈值为 120 字（含 119/120 边界）")
      : fail("【32】长输入阈值不是 120（或边界判定错）—— 长需求提醒会失效或误触发");
    (HINT_AUTO_HIDE_MS === 3000)
      ? ok("【32】气泡 3 秒自动消失（09-20 用户要求调短）")
      : fail(`【32】自动消失时间被改动：${HINT_AUTO_HIDE_MS}ms（09-20 口径 = 3000）`);
    (HINT_COOLDOWN_MS === 180000)
      ? ok("【32】气泡冷却 3 分钟（09-20 降频：原 1 分钟）")
      : fail(`【32】冷却时间被改动：${HINT_COOLDOWN_MS}ms（09-20 口径 = 180000）`);
    let dup = 0, last;
    for (let i = 0; i < 300; i++) { const next = pickEnhanceHint(last); if (next === last) dup++; last = next; }
    (dup === 0)
      ? ok("【32】连续两次不会抽到同一条（300 次抽样 0 重复）")
      : fail(`【32】提示会连续重复（300 次里 ${dup} 次）—— 词库小更要避免原地重复`);
    // 结构性守卫：展示条件必须与锚点按钮的渲染条件**是同一表达式**（否则 pending 被白清，气泡永远看不见）。
    // ⛔ 09-23 用户报「运行过程中输入框已输入内容，增强图标不显示」⇒ 原先两侧（按钮 JSX 与
    //   enhanceAnchorVisible）都带着 `&& !activeThreadRunning` 门槛，运行中直接把按钮整块不渲染。
    //   该门槛已**永久移除**：运行中输入框里写的是**下一条消息的草稿**，与在跑的回合无关。
    //   下面两条一起卡：① 两侧都是新形态（且同一表达式）；② 旧门槛一个字都不许回来。
    const appC2 = readAppUi();
    const anchorCond = /const enhanceAnchorVisible = Boolean\(prompt\.trim\(\) \|\| hasEnhanceBackup\);/.test(appC2);
    const btnCond = /\{\(prompt\.trim\(\) \|\| hasEnhanceBackup\) && \(/.test(appC2);
    (anchorCond && btnCond)
      ? ok("【32】气泡展示条件与锚点按钮渲染条件是同一表达式（防 pending 白清）")
      : fail(`【32】enhanceAnchorVisible 或按钮 JSX 条件与约定不一致（锚点=${anchorCond} 按钮=${btnCond}）`);
    const runGateBack = /Boolean\(prompt\.trim\(\) \|\| hasEnhanceBackup\) && !activeThreadRunning/.test(appC2)
      || /\{\(prompt\.trim\(\) \|\| hasEnhanceBackup\) && !activeThreadRunning && \(/.test(appC2);
    (!runGateBack)
      ? ok("【32】增强按钮/气泡不按「回合是否在跑」隐藏（09-23 用户要求：运行中有草稿就必须显示）")
      : fail("【32】运行态门槛回到了展示条件 —— 长任务里打草稿时按钮会凭空消失（09-23 已修，别加回来）");
    // 长输入节流必须与标记**耦合**在同一个表达式里 —— 只查两处文本各自存在，
    // 测不出 `&& !enhanceLongFiredRef.current` 被摘掉（反证发现的守卫弱点）。
    (/const longPromptDue = isLongPrompt\(prompt\) && !enhanceLongFiredRef\.current;/.test(appC2))
      ? ok("【32】长输入提醒按「编辑会话」节流（清空后重置，不会边打字边弹）")
      : fail("【32】长输入缺少节流 —— 每敲一个字都可能弹，会变成骚扰");
    (/Date\.now\(\) - enhanceHintFiredAtRef\.current < HINT_COOLDOWN_MS/.test(appC2))
      ? ok("【32】多条件叠加时有冷却窗口（防连弹）")
      : fail("【32】缺少冷却 —— 三条触发条件叠在一起时会连弹");
    // ⛔ 09-20 降频的核心判据：触发链里**不许再出现**「本次启动首次输入」那一项 ——
    //   用户点名的就是「增强弹出来频率太高了，一输入文字就出来了」。`due` 只能由两项组成：
    //   「发送后 pending」或「长输入」。这条守卫一红就说明"一输入就弹"要复发。
    (/const due = enhanceHintAfterSendRef\.current \|\| longPromptDue;/.test(appC2)
      ? ok("【32】打字期间不弹（due 只含「发送后」与「长输入」两项，旧「启动首次」已摘除）")
      : fail("【32】due 里仍有「本次启动首次」—— 一输入文字就会弹，正是本次要修掉的行为"));
    // 增强结果可撤销：取消令牌 + 还原原文（用户 09-17 明确要求"支持取消增强，返回原输入"）
    // ⛔ 判据必须锚在**成功路径上紧跟请求之后**的校验：只查 `runId !== ...` 文本存在测不出
    //    成功路径那处被删（catch 里还有一处同名判断，会顶成假绿 —— 反证发现的守卫弱点）。
    (/await window\.codex\.enhancePrompt\(raw\);[\s\S]{0,240}?if \(runId !== enhanceRunIdRef\.current\) return;/.test(appC2))
      ? ok("【32】增强中取消会作废在飞请求（结果回来后先验令牌再写输入框）")
      : fail("【32】成功路径没有验取消令牌 —— 用户取消后内容仍会被替换（真 bug）");
    (/cancelPromptEnhance\(\)/.test(appC2) && /setPrompt\(enhanceBackupRef\.current\)/.test(appC2))
      ? ok("【32】增强结果可还原为原文（revert 路径在）")
      : fail("【32】还原原文路径缺失 —— 用户对增强结果不满意就回不去了");
    // 气泡宽度：绝对定位在窄容器里 shrink-to-fit 会压成竖排窄条（截图实测踩到）
    // ⛔ 必须先去注释再判 —— 注释里也提到了这个属性名，直接正则会被注释顶成假绿（本轮踩到）。
    const cssC2 = readStyles();
    const hintBlock = cssC2
      .slice(cssC2.indexOf(".enhance-hint {"), cssC2.indexOf(".enhance-hint:hover"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    (/width:\s*max-content/.test(hintBlock))
      ? ok("【32】气泡有 width:max-content（防被压成竖排窄条）")
      : fail("【32】.enhance-hint 缺 width:max-content —— 绝对定位在 32px 窄容器里会被压成竖排");
    // 气泡尺寸（09-20 用户「展示气泡小一点」）：宽 200px + padding 6/9（原 260px + 8/11）
    (/max-width:\s*200px/.test(hintBlock) && /padding:\s*6px 7px 6px 9px/.test(hintBlock))
      ? ok("【32】气泡已收小（200px 宽 + 6px/9px padding —— 09-20 用户要求）")
      : fail("【32】气泡尺寸回弹（应为 max-width:200px + padding:6px 7px 6px 9px）");
    (/\.enhance-hint-text\s*\{[\s\S]{0,90}?font-size:\s*11\.5px/.test(cssC2))
      ? ok("【32】气泡文字 11.5px（09-20 收小，原 12px）")
      : fail("【32】气泡文字尺寸回弹（应为 11.5px）");
  }

  // ⑰b assistant 消息头的「头像 + 名字」必须真的显示（09-17 用户报「头像我也没看展示出来」）：
  //   历史遗留的 `.codex-turn .assistant-message{grid-template-columns:minmax(0,1fr)}` +
  //   `.avatar{display:none}` 是为"assistant 消息左侧不放图标"的老设计服务的 —— 加了名字之后，
  //   它把整个头像列隐掉，用户只看得到名字。改消息头样式时极容易再踩回去。
  //   ⛔ 判 CSS 前先剥注释：注释里也写着 display:none，不剥会被顶成假绿（本项目老坑）。
  //   ③ 09-17 二次反馈后的**最终形态**：「一轮会话就一个 Codex 名字和 Codex 头像就行，就在会话
  //      上面就行」+「名字和头像没有第一时间出来」→ 头从「每条 agent 消息一份」提到**回合级一份**
  //      （`.turn-head`，TurnView 渲染），且回合建立即渲染（不等首个 token）。
  //      三种失效形态都静默：回合头没了 / 消息里又长出头像（一轮重复多份）/ 回合头退回"等有内容"。
  {
    const cssNC = readStyles().replace(/\/\*[\s\S]*?\*\//g, "");
    const appC3 = readAppUi();
    // 结构判据要**先剥注释**再判：注释里也写着 turn-head-avatar 这类字面量（不剥会假绿）；
    // 而注释还占满了窗口长度（不剥又会假红 —— 09-17 实测「乐观阶段也有回合头」那条：
    // 原始距离 753 > 窗口 700，剥注释后只有 367。窗口是给代码留的，不是给注释留的）。
    const appNC = appC3.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // 头像+名字的最终形态：**回合级一份**（.turn-head），不再是「每条 agent 消息一份」
    const turnHead = appC3.slice(appC3.indexOf("回合标识：一轮会话只有一份"), appC3.indexOf("占位头必须等回合内已有 userMessage"));
    (/className="turn-head-avatar"/.test(turnHead) && /<CodexAvatar size=\{22\} \/>/.test(turnHead))
      ? ok("【32】回合级渲染「头像 + 名字」（.turn-head，一轮只一份）")
      : fail("【32】回合级头没了 —— 用户看不到 Codex 名字头像");
    (/userItems\.length > 0 && \(running \|\| responseItems\.length > 0\)/.test(turnHead))
      ? ok("【32】回合头不依赖首个 token（用户气泡上屏即出现）")
      : fail("【32】回合头的显示条件变了 —— 可能又回到「名字头像没第一时间出来」");
    (!/className="message assistant-message"[\s\S]{0,220}className="avatar agent"/.test(appNC))
      ? ok("【32】agent 消息里不再带头像（一轮不会重复多份）")
      : fail("【32】agent 消息里又长出头像 —— 一轮多段回复会重复多份（用户要求「就一个」）");
    (/\.turn-head\s*\{/.test(cssNC) && /\.turn-head-avatar\s*\{/.test(cssNC) && /\.turn-head-name\s*\{/.test(cssNC))
      ? ok("【32】.turn-head / 头像 / 名字三条样式都在")
      : fail("【32】.turn-head 样式缺 —— 回合头会没尺寸或没对齐");
    // ⛔ 锚的是**条件语义**（running && userItems.length > 0），不锁整行 —— 09-18 给
    // RunningProcessTime 加 finalizing prop 时整行字面量匹配不上，两条守卫当场假红。
    const procCall = appC3.match(/\{running && userItems\.length > 0 && <RunningProcessTime[^>]*\/>/);
    const procIdx = procCall ? appC3.indexOf(procCall[0]) : -1;
    const cardIdx = appC3.indexOf('{running && !hasVisible && userItems.length > 0 && <header className="turn-card-header">');
    (procIdx > 0)
      ? ok("【32】「正在处理 N 秒 + 灰线」不再依赖工具调用（回合内 userMessage 一到就显示）")
      : fail("【32】RunningProcessTime 的条件又被改掉（缺 userItems 会顶到用户消息上方；挂回 isTaskTurn 则纯聊天看不到）");
    (procIdx > 0 && cardIdx > 0 && procIdx < cardIdx)
      ? ok("【32】顺序：正在处理 + 灰线在「生成中」之上（用户 09-17 明确定的顺序）")
      : fail("【32】「生成中」跑到灰线上面了 —— 用户明确否过这个顺序「你这顺序不对吧」");
    (/\{optimisticInput && !optimisticConfirmed && <>[\s\S]{0,700}?turn-head-avatar/.test(appNC))
      ? ok("【32】乐观阶段也渲染回合头（引擎回声前就有头像 + 名字）")
      : fail("【32】乐观阶段没有回合头 —— 头像名字要等引擎回声（正是用户报的「没第一时间出来」）");
    // 「你」（用户）的头部（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）
    (/className="user-head"/.test(appC3) && /<UserAvatar size=\{22\} \/>/.test(appC3))
      ? ok("【32】用户消息也有「名字 + 头像」头（.user-head）")
      : fail("【32】用户消息缺名字 + 头像 —— 用户要求「人也要有名字和头像」");
    (/setUserIdentity\(\{[\s\S]{0,260}?\}, \[username, userAvatar\]\)/.test(appC3))
      ? ok("【32】用户身份灌进外部 store（消息头取得到，不必逐层传 props）")
      : fail("【32】用户身份没灌进 store —— 用户消息头拿不到名字/头像");
    (/\.user-head\s*\{/.test(cssNC) && /\.user-head-name\s*\{/.test(cssNC) && /\.user-avatar\s*\{/.test(cssNC))
      ? ok("【32】.user-head / 名字 / 头像三条样式都在")
      : fail("【32】.user-head 样式缺 —— 名字头像行会没对齐");
    // 头像健壮性（09-17 用户报「Codex 头像又不见了」）：这个症状**在 DOM 上看不出来** ——
    // <img> 加载失败时尺寸/可见性/透明度全正常，就是没有像素。三种来源都要兜住：
    // 坏 base64 / 上传太大写不进 localStorage / 用户传了坏图。判据 = 必须有 onError 回退。
    const codexAv = readFileSync(join(ROOT, "src", "components", "CodexAvatar.tsx"), "utf8");
    const userAvC = readFileSync(join(ROOT, "src", "components", "UserAvatar.tsx"), "utf8");
    const userCenterC = readFileSync(join(ROOT, "src", "components", "UserCenter.tsx"), "utf8");
    (/onError=\{\(\) => setBroken\(true\)\}/.test(codexAv) && /DefaultCodexAvatar size=\{size\}/.test(codexAv))
      ? ok("【32】Codex 头像加载失败回退默认头像（不留空白）")
      : fail("【32】Codex 头像没有 onError 回退 —— 坏图渲染成一片空白，用户只会说「头像不见了」");
    (/onError=\{\(\) => setBroken\(true\)\}/.test(userAvC))
      ? ok("【32】用户头像加载失败回退名字首字")
      : fail("【32】用户头像没有 onError 回退 —— 坏图渲染成一片空白");
    ((userCenterC.match(/fileToAvatarDataUrl\(file\)/g) || []).length === 2)
      ? ok("【32】两处头像上传都走 128×128 压缩（防写不进 localStorage → 重启丢头像）")
      : fail("【32】头像上传没走压缩 —— 大图 base64 静默写不进 localStorage，重启后头像丢失");
    // 默认头像的**第二种**「凭空消失」（09-17 用户二次反馈「运行完成，头像又不见了，运行的时候还有」）：
    // 底色原先用 SVG `<linearGradient id="codex-avatar-bg">` + `url(#codex-avatar-bg)` ——
    // SVG 引用是**文档级**的：同页每个头像实例都带一份同 id defs（回合头 + 乐观头 + 各历史回合的头），
    // 引用只解析到文档里**第一个**；它一旦落在 `content-visibility: auto` 被跳过的子树里
    // （.turn-group / .turn-card 都带这条：视口外回合跳过布局与绘制）或已被卸载，就解析不到
    // paint server → **整块渲染成空白**；而尺寸 / display / visibility / opacity 全都正常，
    // 从 DOM 上根本查不出来（上一轮就是这么误判成"一切正常"的）。
    // 改成 CSS 渐变后每个实例自给自足。⛔ 同样先剥注释再判（注释里就写着 `url(#id)`）。
    const defAv = readFileSync(join(ROOT, "src", "components", "DefaultCodexAvatar.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    (!/linearGradient|radialGradient|url\(#/.test(defAv))
      ? ok("【32】默认头像不带 SVG url(#id) 引用（多实例撞 id 时会整块渲染成空白）")
      : fail("【32】默认头像又用回 SVG 渐变引用了 —— 同页多实例撞 id 时头像会凭空消失");
    (/\.codex-avatar-default\s*\{[\s\S]{0,320}?linear-gradient/.test(cssNC))
      ? ok("【32】.codex-avatar-default 用 CSS 渐变作底色（实例各自独立，引用失效不影响）")
      : fail("【32】.codex-avatar-default 缺 CSS 渐变 —— 默认头像会渲染成一块空白");
    (!/id="codex-avatar/.test(codexAv + defAv + userAvC))
      ? ok("【32】头像组件里没有 id=\"codex-avatar…\"（不存在跨实例引用）")
      : fail("【32】头像组件里出现 id —— 多实例会撞 id，引用可能解析失败（渲染成空白）");
    // 思考强度：底栏按钮 +「宽彩色动态条」弹窗（09-17 用户两次要求：先「改成彩色横向拖动进度条，
    // 每个等级颜色都不一样」，再「弹窗拖动，不是输入框直接一个长条，gpt 那种宽的彩色动态条」）
    const effortPickerC = readFileSync(join(ROOT, "src", "components", "EffortPicker.tsx"), "utf8");
    (/<EffortPicker\b/.test(appC3))
      ? ok("【32】思考强度用「底栏按钮 + 弹窗宽条」渲染")
      : fail("【32】composer 底栏没有 EffortPicker —— 思考强度没做成弹窗拖动条");
    (!/<ComposerMenu icon=\{Zap\} label="思考"/.test(appC3))
      ? ok("【32】旧的「思考」下拉已移除（不会并存两份）")
      : fail("【32】旧的「思考」下拉又回来了 —— 会与拖动条并存两份");
    (!/EffortSlider/.test(appC3) && !existsSync(join(ROOT, "src", "components", "EffortSlider.tsx")))
      ? ok("【32】上一版的底栏细长条已彻底移除（不留死组件）")
      : fail("【32】EffortSlider 还在（组件或引用）—— 用户明确否掉了「输入框直接一个长条」");
    // ⛔ 用户要的是「每个等级颜色都不一样」：色值必须两两不同，不能有重复
    const effortColors = [...effortPickerC.matchAll(/\w+:\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
    (effortColors.length >= 5 && new Set(effortColors).size === effortColors.length)
      ? ok(`【32】每档颜色互不相同（${effortColors.length} 档 / ${new Set(effortColors).size} 种色）`)
      : fail(`【32】档位颜色有重复或不足（${effortColors.length} 档 / ${new Set(effortColors).size} 种色）—— 用户要「每个等级颜色都不一样」`);
    // 拖动中绝不落库：changeEffort 会 upsertProviderModel（IPC + 重写 catalog），
    // 挂在 onChange 上会在拖动经过中间档位时反复触发、还会把选中的档位覆盖回去。
    (/onPointerUp=\{\(\) => commit\(\)\}/.test(effortPickerC) && /onChange=\{\(event\) => setDraft\(Number\(event\.target\.value\)\)\}/.test(effortPickerC))
      ? ok("【32】拖动中只跟手、释放才提交（onChange 不落库）")
      : fail("【32】EffortPicker 的 onChange 直接提交了 —— 拖动经过中间档位会反复 upsert 落库");
    // 弹窗必须 portal + fixed：底栏在滚动容器里，absolute 浮层会被裁掉上半截（设置页气泡踩过同款）
    const popBlock = cssNC.slice(cssNC.indexOf(".effort-picker-pop {"), cssNC.indexOf("@keyframes effort-pop-in"));
    (/createPortal\(/.test(effortPickerC) && /position:\s*fixed/.test(popBlock))
      ? ok("【32】思考强度弹窗用 portal + fixed（不会被底栏容器裁掉）")
      : fail("【32】思考强度弹窗不是 portal + fixed —— 底栏滚动容器会把上半截裁掉");
    // 09-18 滑块新形态（用户定稿）：「⚪点滑动，鼠标放上去再展示；默认一条线；已选的后面
    // 彩色液体流动加灯带；没拉到的地方空着；拉满后一个燃烧特效」。
    // 已选段有「液体流动 + 灯带」：流光（fill::after）+ 外发光。⛔ 外发光必须放 fillwrap ——
    // fill 自身 overflow:hidden 会把 box-shadow 裁掉；渐变必须在 JSX 里按整条轨道铺（fillScale），
    // 否则已选段的颜色与档位位置错位、被压成看不清分段的渐变（两处都实测踩过）。
    // ⛔ 外发光的判据必须圈在 fillwrap 自己的规则里：全文件搜 box-shadow 会命中相邻的
    //    .effort-picker-fill 的 inset 高光，造成假绿（09-18 反证抓到）。
    const fillwrapBlock = cssNC.slice(cssNC.indexOf(".effort-picker-fillwrap {"), cssNC.indexOf(".effort-picker-fill {"));
    // ⛔ 判据要匹配「真的有发光声明」（box-shadow: 0 0 …）而不是裸提 box-shadow ——
    //    fillwrap 的 transition 里也写着 box-shadow 字样，裸查会假绿（09-18 反证抓到）。
    (/@keyframes effort-sheen/.test(cssNC) && /\.effort-picker-fill::after/.test(cssNC) && /box-shadow:\s*0 0 10px/.test(fillwrapBlock) && /backgroundSize:\s*fillScale/.test(effortPickerC))
      ? ok("【32】已选段液体流动 + 灯带（流光/外发光在 wrapper/渐变按整条轨道铺）")
      : fail("【32】已选段缺液体灯带或渐变错位 —— 颜色与档位位置对不上（实测踩过）");
    // ⚪ 默认隐藏：thumb 块 opacity:0 + scale(0.5)，hover/focus-within 才出现
    const thumbBlock = cssNC.slice(cssNC.indexOf(".effort-picker-thumb {"), cssNC.indexOf(".effort-picker-bar:hover .effort-picker-thumb"));
    (/opacity:\s*0/.test(thumbBlock) && /scale\(0\.5\)/.test(thumbBlock) && /\.effort-picker-bar:hover \.effort-picker-thumb/.test(cssNC))
      ? ok("【32】⚪滑块默认隐藏、hover/聚焦才出现（用户定稿「默认一条线」）")
      : fail("【32】⚪滑块常驻显示 —— 用户要的是「默认一条线，鼠标放上去再展示」");
    // 结构齐：轨道（未选=一条线）/ 液体填充 / 前沿亮珠 / 拉满燃烧（burn 类 + 火苗层 + 火焰动画）
    (cssNC.includes(".effort-picker-track {") && cssNC.includes(".effort-picker-fillwrap {") && cssNC.includes(".effort-picker-bead {")
      && /\.effort-picker-bar\.burn/.test(cssNC) && /\.effort-picker-flames/.test(cssNC) && /@keyframes effort-flame/.test(cssNC)
      // ⛔ burn 必须**由 isMax 驱动**（精确到 className 模板与计算式）：只查 CSS 类存在的话，
      //    把 JSX 里的条件摘掉它也照样绿（09-18 反证抓到）。
      && /effort-picker-bar\$\{isMax \? " burn" : ""\}/.test(effortPickerC) && /isMax = draft >= levels\.length - 1/.test(effortPickerC))
      ? ok("【32】滑块结构齐（一条线轨道 / 液体填充 / 亮珠 / 拉满燃烧火焰层）")
      : fail("【32】滑块结构缺件 —— 一条线 / 液体灯带 / 燃烧特效至少缺一个");
    (/\.effort-trigger\s*\{/.test(cssNC) && /\.effort-picker-range/.test(cssNC) && /-webkit-slider-thumb/.test(cssNC))
      ? ok("【32】样式齐（触发按钮 / 原生 range 手柄 / 档位标签）")
      : fail("【32】拖动条样式缺 —— 滑块不会显示");
    // 模型 ID Tab 补全（09-18 用户：「加一个 tab 补全功能……方便新手快速配置」）
    const modelIdC = readFileSync(join(ROOT, "src", "components", "ModelIdInput.tsx"), "utf8");
    (/<ModelIdInput\b/.test(appC3) && /applyModelIdInput/.test(appC3))
      ? ok("【32】模型 ID 输入框接了 Tab 补全（ModelIdInput + 规格自动回填）")
      : fail("【32】模型 ID 没有 Tab 补全 —— 新手只能背模型名（用户点名要）");
    (!/provider-model-options/.test(appC3))
      ? ok("【32】原生 datalist 已移除（换成了能显示参数徽标、支持 Tab 的 ModelIdInput）")
      : fail("【32】datalist 又回来了 —— 没有 Tab 补全也看不到参数徽标");
    (/setModelEditor\(\(editor\) => \{/.test(appC3) && /paramsDirty/.test(appC3))
      ? ok("【32】补全后的参数回填走函数式 setState + 尊重 paramsDirty（手改过不覆盖）")
      : fail("【32】参数回填用过期闭包或无视手改 —— 补全后参数可能没回填/被覆盖");
    // 模型下拉徽标化（09-18 用户「选择样式还可以优化一下，现在不好看」）
    (/function modelBadges\(/.test(appC3) && /badges: modelBadges\(model\)/.test(appC3) && /\.menu-item-badges/.test(cssNC) && /\.menu-item-check/.test(cssNC))
      ? ok("【32】模型下拉每行带「图片/视频/上下文/输出」徽标 + 当前项右侧勾选")
      : fail("【32】模型下拉没有参数徽标 —— 用户嫌「不好看」的那版");
    // 09-18 新形态（用户：「把模型配置里面思考选择删了，每个独立会话选择那个就生效那个」）：
    //   档位**不再是模型条目的属性** —— 模型配置里没有勾选区，菜单恒为全集，
    //   选哪个只落**当前会话**；模型/网关真不支持某档 → 发送失败自动学会 + 降档重发。
    //   三种回潮形态：① 模型配置里又长出档位勾选；② 菜单又按模型声明过滤（用户选不到想选的档）；
    //   ③ 选档又写全局默认（A 会话的选择污染 B 会话）。
    const modelEditorC = appNC.slice(appNC.indexOf("const openModelEditor"), appNC.indexOf("const targetProviderHint"));
    // ⛔ 判据要**精确**：只看模型编辑器弹窗 JSX 那一小段（从 .model-editor-modal 到它的 footer），
    //   并且**块注释与行注释都要剥** —— 全局搜「efforts」会命中别处的档案字段，而注释里
    //   提一句「思考档位」也会被判成回潮（09-18 连踩两次：先假红于行注释，再假红于全局搜）。
    const appCode = appNC.replace(/^\s*\/\/.*$/gm, "");
    const editorStart = appCode.indexOf("model-editor-modal");
    const editorJsx = editorStart < 0 ? "" : appCode.slice(editorStart, appCode.indexOf("</footer>", editorStart));
    (editorJsx.length > 0 ? ok : fail)("模型编辑器弹窗 JSX 可定位（守卫判据有效）");
    (!/思考档位/.test(editorJsx) && !/modelEditor\.draft\.efforts/.test(editorJsx))
      ? ok("【32】模型编辑器里没有档位勾选区（档位不是模型属性）")
      : fail("【32】模型配置里又出现档位勾选 —— 用户明确要求删掉（档位应纯会话级）");
    (!/勾选思考档位/.test(appNC))
      ? ok("【32】没有指向已删除勾选区的过时文案（模型下拉的「更多设置…」）")
      : fail("【32】有文案还让用户去模型配置「勾选思考档位」—— 入口已经不存在了");
    (/levels=\{\[\.\.\.ALL_EFFORTS\]\}/.test(appNC))
      ? ok("【32】思考菜单档位恒为全集（不再按模型声明过滤）")
      : fail("【32】菜单档位又按模型声明过滤了 —— 用户会选不到想选的档（09-18 已删除声明机制）");
    const applyBody = appNC.slice(appNC.indexOf("function applyEffort"), appNC.indexOf("function changeEffort"));
    (/if \(threadRef\.current\?\.id\) saveThreadEffort\(threadRef\.current\.id, value\)/.test(applyBody)
      && /else localStorage\.setItem\("default-effort", value\)/.test(applyBody)
      && /void updateThreadSettings\(\{ effort: value \}\)/.test(applyBody))
      ? ok("【32】选档位只落**当前会话**（有会话写 thread-runtime，无会话才写全局默认）")
      : fail("【32】选档位的作用域被改了 —— 会跨会话互相污染（09-13 修过的老坑）");
    (/if \(isUnsupportedEffortError\(error\?\.message\) && effort\)/.test(appNC)
      && /markEffortUnsupported\(/.test(appNC)
      && /executeEffortFallbackRetry\(\)/.test(appNC))
      ? ok("【32】档位不被支持时自动降档重发（删掉手动声明后的兜底）")
      : fail("【32】没有「档位不支持 → 自动降档重发」的兜底 —— 用户选到不支持的档位只能干瞪眼");
    (/clearEffortUnsupported\(selectedModel\?\.model \?\? modelName\(modelId\), effort\)/.test(appNC))
      ? ok("【32】发送成功即清掉该档位的「不支持」记录（自愈，不永久标灰）")
      : fail("【32】没有自愈：一次失败会把档位永久标灰，用户强制选回成功也抹不掉");
    (/modelId=\{currentModelId\}/.test(appNC)
      && /blockedEffortsOf\(modelId\)/.test(effortPickerC)
      && /effort-tick\$\{on \? " on" : ""\}\$\{blockedSet\.has\(level\) \? " blocked" : ""\}/.test(effortPickerC)
      && /\.effort-tick\.blocked\s*\{/.test(cssNC))
      ? ok("【32】菜单把「该模型不支持」的档位标灰，且**每次打开弹窗重读**（刚降档的立刻可见）")
      : fail("【32】已知不支持的档位没有标记或不是打开时读 —— 用户会反复踩同一档");
    (!/\.(?:codex-turn|process-content) \.assistant-message \.avatar[\s\S]{0,140}?display:\s*none/.test(cssNC))
      ? ok("【32】没有规则把 assistant 头像 display:none 掉")
      : fail("【32】有规则把 assistant 头像 display:none 了 —— 用户只会看到名字");
  }

  // ⑰c 首次启动「环境体检」（09-17 用户：「新用户不知道该装什么，不装 Codex 啥也干不了」）。
  //   最容易复发的四种失效形态（全部有可证伪的静态判据）：
  //   ① 体检项被悄悄改少（用户拍板的是「必备 4 + 常用 3」共 7 项）
  //   ② 弹窗没挂进渲染树 → 缺工具的新用户永远等不到提示（功能等于没做）
  //   ③「一键安装」没接 installRuntime → 按钮是摆设
  //   ④ installableIds 把 model/workspace 也当成可安装项 → 调 installRuntime("model") 必失败
  {
    const envC = readFileSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"), "utf8");
    const appEnv = readAppUi();
    const specCount = (envC.match(/\{ id: "(?:model|workspace|git|rg|pwsh|python|jq|sevenzip)"/g) || []).length;
    // 09-20 用户定稿「工作区不要必选，就保留工具下载」：工作区移出体检 ⇒ 7 项（必备 4 + 常用 3）
    (specCount === 7 && !envC.includes('id: "workspace"'))
      ? ok("【32】环境体检 7 项齐全且无工作区（模型/Git/ripgrep/PowerShell 7 + Python/jq/7-Zip）")
      : fail(`【32】体检项异常（${specCount} 项或含工作区）—— 用户 09-20 定稿：工作区移出、必备 4 + 常用 3`);
    const coreCount = (envC.match(/core: true/g) || []).length;
    (coreCount === 4)
      ? ok("【32】必备项 4 项（模型/Git/ripgrep/PowerShell 7；工作区已按 09-20 口径移出）")
      : fail(`【32】必备项变成 ${coreCount} 项 —— 弹窗触发条件会跟着偏`);
    (/id: "pwsh", fallbackName: "PowerShell 7", core: true/.test(envC))
      ? ok("【32】PowerShell 7 在体检必备组（终端默认 shell，缺失会退回 5.1）")
      : fail("【32】PowerShell 7 不在体检必备组 —— 新用户终端会静默退回 PowerShell 5.1");
    (/spec\.id !== "pwsh" \|\| !isMacPlatform\(\)/.test(appEnv) && /envSpecs\.filter\(\(spec\) => spec\.core\)/.test(appEnv))
      ? ok("【32】pwsh 体检项按平台门控（mac 终端用系统 shell，不把 pwsh 标成必备）")
      : fail("【32】pwsh 体检项没做平台门控 —— mac 用户会被误导去装一个终端用不到的东西");
    (/<EnvCheckDialog/.test(appEnv))
      ? ok("【32】体检弹窗挂在渲染树里（缺工具时真的会弹）")
      : fail("【32】体检弹窗没挂进渲染树 —— 缺工具的新用户永远等不到提示");
    (/await window\.codex\.installRuntime\(id\)/.test(appEnv))
      ? ok("【32】「一键安装」真的调了 installRuntime")
      : fail("【32】一键安装没接 installRuntime —— 按钮是摆设");
    (/const MANUAL_IDS = new Set\(\["model"\]\)/.test(envC))
      ? ok("【32】installableIds 排除了 model（它不是可安装的运行时；workspace 已移出体检）")
      : fail("【32】installableIds 没排除 model —— 一键安装会拿它调 installRuntime 并失败");
    (/ENV_CHECK_OPTOUT_KEY/.test(envC) && /localStorage\.getItem\(ENV_CHECK_OPTOUT_KEY\)/.test(appEnv))
      ? ok("【32】「不再提示」真的被读（勾了就不再弹）")
      : fail("【32】optout 标记没被读 —— 用户勾了「不再提示」还会每次被弹");
    // 后台安装（09-18 用户：「加一个后台安装功能，弹窗要知道缩小，安装完成自动消失」；
    // 起因：Python 下载挂住时弹窗卡死、安装中禁一切关闭，用户只能重启）
    (/setEnvCheckOpen\(false\); \/\/ 后台化/.test(appEnv))
      ? ok("【32】一键安装点下去弹窗立刻收起（安装转后台，右下角角标接管进度）")
      : fail("【32】一键安装还是阻塞式弹窗 —— 下载一挂住整个界面被卡死只能重启");
    (/envInstalling && !envCheckOpen/.test(appEnv) && /env-install-pill/.test(appEnv))
      ? ok("【32】后台安装角标在渲染树里（进度实时显示、点开回弹窗、装完自动消失）")
      : fail("【32】后台安装角标没挂进渲染树 —— 收起后安装进度不可见");
    (/setEnvCheckOpen\(true\); \/\/ 有失败/.test(appEnv))
      ? ok("【32】安装有失败时自动展开回弹窗（角标报不了哪项失败、也没法重试）")
      : fail("【32】安装失败后弹窗没有展开回来 —— 用户不知道哪项没装上");
    (!/安装期间禁用一切关闭动作/.test(envC) && /关闭 ≠ 取消/.test(envC))
      ? ok("【32】安装中允许关闭弹窗（关闭 = 转后台，不再卡死界面）")
      : fail("【32】体检弹窗又改成安装中禁关 —— 下载挂住时只能重启");
  }

  // ⑰e 用户头像类型链（09-18）：UserCenter 的回调把 avatarType 放宽成 string，会逼 App 侧用
  //   `as UserAvatarSpec["type"]` 硬转回来 —— cast 一多，`string` 类型的脏值就静默进了 setUserIdentity。
  //   两种写法都"能编译"，所以只能靠守卫钉住「源头不收窄就别想绿」；反证：把签名改回 string → 变红。
  {
    const userCenter = readFileSync(join(ROOT, "src", "components", "UserCenter.tsx"), "utf8");
    const appAvatar = readAppUi();
    (/onProfileChange\?: \(p: \{ avatarType: UserProfile\["avatarType"\]; avatar: string \}\) => void;/.test(userCenter))
      ? ok("【33】UserCenter 回调保留 avatarType 联合类型（不放宽成 string）")
      : fail("【33】UserCenter 回调又把 avatarType 放宽成 string —— App 侧会被迫用 as 硬转");
    (!/as UserAvatarSpec/.test(appAvatar) && /useState<UserAvatarSpec \| null>/.test(appAvatar))
      ? ok("【33】App 侧头像 state 直接用 UserAvatarSpec（无 as 硬转）")
      : fail("【33】App 侧又出现 as UserAvatarSpec 硬转 —— 类型洞回来了");
  }

  // ⑰f 开发工具的**双平台覆盖**（09-18 用户问「开发工具有没有考虑 Windows 和 mac 两种版本」时查出来的两处静默失效）：
  //   ① 新工具只加进 Windows 安装表 → mac 上点安装时脚本对未知 id 什么都不做、**退出 0**（界面显示"装好了"）；
  //   ② install-automation.cjs（随包内置能力的「修复安装」，build/copy-mac-tools.cjs 明确拷进 mac 包）
  //      只认 Windows 的 python.exe / 7z.exe → mac 上必然报「缺少 python 与 7z」，把平台缺口说成缺依赖。
  //   反证：Windows 表里塞一个假 id → ①红；删掉 darwin 解压分支 → ②红。
  {
    const installer = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
    const automation = readFileSync(join(ROOT, "scripts", "install-automation.cjs"), "utf8");
    const idsIn = (block) => [...new Set([...block.matchAll(/want\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
    const winStart = installer.indexOf("async function main()");
    const macStart = installer.indexOf("async function mainMac()");
    // ⛔ 锚点必须在，否则切片退化成空串 → 两边都"空" → 下面的比较**假绿**（函数一改名就静默失效）
    if (winStart < 0 || macStart < 0 || macStart < winStart) {
      fail("【34】install-runtimes.cjs 里找不到 main() / mainMac() 这两个平台入口 —— 双平台一致性检查已失效（改名请同步本守卫）");
    }
    const winIds = idsIn(installer.slice(winStart, macStart));
    const macIds = idsIn(installer.slice(macStart, installer.indexOf("if (IS_MAC) mainMac()")));
    // darwin 上无意义 / 系统自带的工具（与 main.ts 的 DARWIN_HIDDEN 同源），允许只出现在 Windows 表
    const WIN_ONLY_OK = ["mingw"];
    const onlyWin = winIds.filter((id) => !macIds.includes(id) && !WIN_ONLY_OK.includes(id));
    const onlyMac = macIds.filter((id) => !winIds.includes(id));
    (!onlyWin.length && !onlyMac.length)
      ? ok(`【34】开发工具安装表双平台一致（各 ${macIds.length} 项；仅 mingw 为 Windows 独有且在 mac 隐藏）`)
      : fail(`【34】安装表两平台不一致 —— 只在 Windows: [${onlyWin}] / 只在 mac: [${onlyMac}]（另一平台点安装会静默装不上）`);
    (/require\.main === module/.test(automation))
      ? ok("【34】install-automation 主流程只在直接执行时跑（require 无副作用，可被探针复用）")
      : fail("【34】install-automation 缺 require.main 守卫 —— 被 require 时会真的去解压");
    // ⛔ 行为断言，不是文本匹配（第一版只查文本里有没有 "/usr/bin/ditto" 字样，把 `darwin`
    //    改成任意字符串它照样绿 —— 反证 F 当场抓到）。这里 require 真模块跑 pickExtractor。
    try {
      const req = createRequire(import.meta.url);
      const { pickExtractor } = req(join(ROOT, "scripts", "install-automation.cjs"));
      // 按 basename 造探针，避免和 toolsRoot 布局耦合
      const has = (...names) => (p) => names.includes(join(p).split(/[\\/]/).pop());
      const kind = (platform, names) => {
        const picked = pickExtractor(platform, has(...names));
        return picked ? picked.kind : null;
      };
      const darwinOk = kind("darwin", ["ditto", "python.exe", "7z.exe"]) === "ditto"
        && kind("darwin", ["python3", "python.exe", "7z.exe"]) === "python3"
        && kind("darwin", ["unzip", "python.exe", "7z.exe"]) === "unzip"
        // 老 bug 的反证：darwin 只有 Windows 那两个解压器时必须判定"无解压器"，而不是选中 .exe
        && kind("darwin", ["python.exe", "7z.exe"]) === null;
      const winOk = kind("win32", ["python.exe", "7z.exe"]) === "python"
        && kind("win32", ["7z.exe"]) === "7z"
        && kind("win32", []) === null;
      (darwinOk && winOk)
        ? ok("【34】解压器选择行为正确（mac：ditto→python3→unzip，且不再选中 Windows .exe；Windows 行为不变）")
        : fail(`【34】解压器选择行为不对 —— mac 链=${darwinOk} win 链=${winOk}（mac 点「修复安装」会失败或选错工具）`);
    } catch (error) {
      fail(`【34】pickExtractor 行为断言跑不起来：${String(error?.message ?? error).split("\n")[0]}`);
    }
  }

  // ⑰g 「插件」页的刷新入口唯一化（09-18 用户：「插件市场有两个刷新按键…保留上面的，里面不要」）。
  //   原先标题行一颗（页面资源：技能/钩子/已装插件/记忆/任务/MCP）+ 市场工具栏一颗（列表，当前筛选），
  //   两个同款 🔄 挨着放 → 用户分不清。合并成标题行那一颗，两处数据一起刷。
  //   ⛔ 失效形态是静默的：合并时漏掉 refreshMarketPlugins → 市场列表再也刷不动，而界面无任何报错。
  {
    const appSrc = readAppUi();
    const start = appSrc.indexOf('className="settings-section stack plugin-center"');
    // 结束 = 该 section 自身的收尾。
    //   ⛔ 原来用「下一个 `settingsPage === "skills"`」当结束标记 —— 09-21 plugins 块搬进
    //   src/features/settings-plugins/ 独立组件后，两者在 readAppUi() 的拼接串里**不再相邻**
    //   （App.tsx 在前、features 在后），indexOf 返回 -1 ⇒ 切出空串 ⇒ 假红「(section 没切出来)」。
    const end = appSrc.indexOf("</section>", start);
    const pluginSection = start >= 0 && end > start ? appSrc.slice(start, end) : "";
    const refreshButtons = (pluginSection.match(/title="刷新[^"]*"/g) || []);
    (pluginSection && refreshButtons.length === 1 && !/title="刷新插件市场"/.test(appSrc))
      ? ok("【35】插件页只有一个刷新入口（市场工具栏那颗已去掉，不再是两个同款 🔄）")
      : fail(`【35】插件页刷新入口数 = ${refreshButtons.length}（应为 1）：${refreshButtons.join(" / ") || "(section 没切出来)"}`);
    (/async function refreshPluginsPage\(\)[\s\S]{0,240}?refreshSettingsResources\(\)[\s\S]{0,140}?refreshMarketPlugins\(/.test(appSrc))
      ? ok("【35】那一个刷新确实两处都刷（页面资源 + 当前筛选的市场列表）")
      : fail("【35】refreshPluginsPage 没同时刷市场列表 —— 合并后市场再也刷不动，且界面不报错");
  }

  // ⑰h 渲染层「展示用路径」不许写死反斜杠（09-18 发版前的 mac 适配审计抓到的：技能中心说明把用户
  //   数据目录拼成 `…\codex-home\skills`，mac 上会显示成 `/Users/…\codex-home\skills` 这种四不像）。
  //   判据只能是源码级：本机是 Windows，渲染层的 mac 分支跑不到真机；注释先剥离（说明性文字里会出现反例）。
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const targets = walk(join(ROOT, "src"), [".ts", ".tsx"]);
    const offenders = [];
    for (const entry of targets) {
      strip(readFileSync(entry.path, "utf8")).split(/\r?\n/).forEach((line, i) => {
        // ⛔ 1~2 个反斜杠都算：`\\codex-home`（源码里的转义形态，渲染出 `\codex-home`）与
        //    `\codex-home`（模板串里会被 JS 当转义吃掉 → 分隔符直接消失）都是错的。
        if (/\\{1,2}(codex-home|skills|sessions|plugins|commands|logs|pw-browsers|cloak-cache)/.test(line)) {
          offenders.push(`${relative(ROOT, entry.path)}:${i + 1}`);
        }
      });
    }
    (!offenders.length)
      ? ok(`【36】渲染层没有写死的反斜杠展示路径（扫 ${targets.length} 个 ts/tsx，注释已剥离）`)
      : fail(`【36】渲染层出现写死反斜杠的展示路径：${offenders.slice(0, 4).join("、")} —— mac 上会显示成 /a\\b\\c`);
    const appPath = readAppUi();
    (/function displayPath\(base: string, \.\.\.parts: string\[\]\): string \{/.test(appPath)
      && /displayPath\(userDataPath, "codex-home", "skills"\)/.test(appPath))
      ? ok("【36】展示路径走 displayPath()（按平台选分隔符）")
      : fail("【36】displayPath() 缺失或技能中心说明没走它 —— 分隔符又会被写死");
  }

  // ⑰i 并发安装不再假失败 + 体检批量安装逐项容错（09-18 用户反馈「安装失败：Error invoking remote method
  //   'runtime:install': Error: 该工具正在安装」）。触发链：首次启动 Git 后台自愈安装占住 git，
  //   体检「一键安装」里 git 排第一 → 旧实现直接抛错 → **整批中断**（三项一个都没装、弹窗不关）。
  //   三处必须同时在位，缺一处就回到旧症状（且都是静默的：界面只显示一句"安装失败"）。
  {
    const mainSrc = readMainSource();
    const appSrc = readAppUi();
    const envSrc = readFileSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"), "utf8");
    (/const inFlight = runtimeInstalls\.get\(id\);[\s\S]{0,300}?await inFlight;[\s\S]{0,120}?joined: true/.test(mainSrc)
      && !/throw new Error\("该工具正在安装"\)/.test(mainSrc))
      ? ok("【37】同工具并发安装改为「等它跑完」（不再抛「该工具正在安装」）")
      : fail("【37】runtime:install 又会在并发时抛错 —— 用户点「一键安装」会撞上「该工具正在安装」并整批中断");
    (/for \(const id of ids\) \{\s*try \{[\s\S]{0,400}?failed\.push\(/.test(appSrc)
      && /failed\.length === ids\.length/.test(appSrc))
      ? ok("【37】体检批量安装逐项容错（一项失败不再中断其余，并区分全败/部分完成）")
      : fail("【37】installEnvMissing 又变回「循环外一个 try」—— 任何一项失败会让整批中断、清单原样不动");
    (/!item\.ok && !item\.installing && !MANUAL_IDS\.has\(item\.id\)/.test(envSrc))
      ? ok("【37】正在安装的项不算进「一键安装」（避免自己撞自己的并发守卫）")
      : fail("【37】installableIds 没排除 installing —— 后台自愈安装中的项仍会被塞进批量安装");
  }

  // ⑰j 微信流式：**受平台配额约束的追加 + 「对方正在输入」**（09-18 恢复）。
  //   背景：09-12 以「context_token 一次一发」为由整体撤掉了微信流式，但那个结论经复核是**误判**
  //   （同一 token 可复用；真因是请求体字段不全导致静默丢弃）。真正的硬约束是**配额**：
  //   iLink 每用户消息 24h 内最多 10 条独立消息 ⇒ 追加必须限量，否则撞爆配额后连收尾正文都发不出去。
  //   三处必须同时在位：① sink 提供 append/finalizeAppend（否则退回"只有汇总"）
  //   ② 微信预算 maxFlushes ≤ 6（留余量给收尾）③ typing 接线（过程可见的主通道，不占配额）。
  {
    const mainSrc = readMainSource();
    const gwSrc = readFileSync(join(ROOT, "electron", "weixin-gateway.ts"), "utf8");
    const streamSrc = readFileSync(join(ROOT, "electron", "bot-stream.ts"), "utf8");
    const budgetMatch = mainSrc.match(/WEIXIN_STREAM_BUDGET: BotStreamBudget = \{ maxFlushes: (\d+)/);
    (budgetMatch && Number(budgetMatch[1]) >= 1 && Number(budgetMatch[1]) <= 6)
      ? ok(`【38】微信追加预算 ${budgetMatch[1]} 次（+收尾 1 条 ≤ iLink 的 10 条/24h 配额）`)
      : fail(`【38】微信追加预算 = ${budgetMatch ? budgetMatch[1] : "(未找到)"} —— 必须是 1~6（含收尾要在 10 条配额内，且留余量）`);
    (/append: \(delta, clientId\) => \{/.test(mainSrc) && /sendChunk\(sendable, \{ clientId, state: 1 \}\)/.test(mainSrc)
      && /finalizeAppend: \(tail, clientId\) => \{/.test(mainSrc) && /send: \(full\) => weixinGateway!\.sendText\(from, plainTextForChannel\(full\)\)/.test(mainSrc))
      ? ok("【38】微信 sink 提供 append/finalizeAppend（state=1 追加 / state=2 收尾），发送统一走排版转换")
      : fail("【38】微信 sink 又只剩 send —— 运行过程不会同步，用户只能看到最终汇总");
    (/new BotStreamSession\(plan\.sink, readBotStreamSettingsSync\(botStreamFile\), plan\.budget\)/.test(mainSrc))
      ? ok("【38】预算真的传给了流式会话（不是摆设常量）")
      : fail("【38】BotStreamSession 没拿到 plan.budget —— 预算不生效，长任务会撞爆配额");
    (/ilink\/bot\/getconfig/.test(gwSrc) && /ilink\/bot\/sendtyping/.test(gwSrc) && /typing_ticket/.test(gwSrc) && /ilink_user_id: to/.test(gwSrc))
      ? ok("【38】网关按协议实现了 getconfig → sendtyping（typing_ticket + ilink_user_id）")
      : fail("【38】网关缺「对方正在输入」接口实现（getconfig/sendtyping）—— 长任务期间用户看不到任何进度");
    (/if \(event\.method === "turn\/started"\)/.test(mainSrc) && /startWeixinTyping\(streamThreadId, plan\.typingFrom\)/.test(mainSrc)
      && /if \(event\.method === "turn\/completed"\) stopWeixinTyping\(/.test(mainSrc))
      ? ok("【38】typing 随回合起停（turn/started 起、turn/completed 停）")
      : fail("【38】typing 没接回合生命周期 —— 会出现「一直在输入」不消失");
    (/(minChars|maxFlushes|flushIntervalMs)/.test(streamSrc) && /this\.budget\.maxFlushes/.test(streamSrc) && /this\.budget\.minChars/.test(streamSrc))
      ? ok("【38】流式会话真的按预算节流（maxFlushes / minChars / flushIntervalMs 都参与判断）")
      : fail("【38】BotStreamBudget 定义了却没参与判断 —— 预算形同虚设");
    (/private newMessageId\(\)/.test(streamSrc) && /this\.sink\.append\(pending, this\.newMessageId\(\)\)/.test(streamSrc)
      && /this\.newMessageId\(\)/.test(streamSrc.split("finalizeAppend(")[1] ?? ""))
      ? ok("【38】每条消息新 client_id（服务端按 id 去重：同一 id 连发只有首条落地，后续含收尾被静默丢弃）")
      : fail("【38】流式追加/收尾复用同一个 client_id —— 服务端去重后正文丢失（09-12 与 09-18 两次实测同款症状）");
    (/sendmessage ok state=/.test(gwSrc))
      ? ok("【38】sendmessage 成功也留痕（静默去重只能靠日志条数与实收对账定性）")
      : fail("【38】sendmessage 只记失败不记成功 —— 服务端静默去重时无从排查");
    // 微信纯文本排版（09-18 用户：「为啥不能跟汇总一样的格式同步过来」——iLink 不渲染 Markdown，
    // 表格/标题原样过去就是竖线堆）。直跑 channel-text.ts 真实现做行为断言（node type-stripping）。
    let wt = null;
    try {
      const wtUrl = pathToFileURL(join(ROOT, "electron", "channel-text.ts")).href;
      const wtProbe = spawnSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        `import { plainTextForChannel as f } from ${JSON.stringify(wtUrl)}; console.log(JSON.stringify({` +
        ` table: f("🔥 最劲爆\\n\\n| 方向 | 新闻 |\\n|---|---|\\n| 国内大模型 | 智谱 GLM 十万卡 |\\n| 融资 | Emulate 7 亿 |"),` +
        ` head: f("## 行动向"), bold: f("**GPT-5.6** 的自我隐瞒"), link: f("[OpenAI](https://x.com/a) 公告"), bullet: f("- Figure 发 Helix"), hr: f("上文\\n---\\n下文") }));`,
      ], { encoding: "utf8" });
      wt = JSON.parse(wtProbe.stdout.trim().split("\n").at(-1));
    } catch { /* 下面统一判红 */ }
    (wt ? ok : fail)("channel-text.ts 可被 Node type-stripping 直跑（排版守卫跑的是真实现）");
    if (wt) {
      (wt.table.includes("【方向】新闻") && wt.table.includes("【国内大模型】智谱 GLM 十万卡") && wt.table.includes("【融资】Emulate 7 亿") && !wt.table.includes("|"))
        ? ok("【38】表格 → 【首列】其余列（分隔行丢弃），微信里不再是竖线堆")
        : fail(`【38】表格排版转换不对：${JSON.stringify(wt.table)}`);
      (wt.head === "【行动向】" && wt.bold === "GPT-5.6 的自我隐瞒" && wt.link === "OpenAI 公告")
        ? ok("【38】标题 → 【】、粗体去符号、链接去 URL 留文字")
        : fail(`【38】标题/粗体/链接转换不对：${JSON.stringify(wt)}`);
      (wt.bullet === "• Figure 发 Helix" && wt.hr === "上文\n下文")
        ? ok("【38】列表转 • 、水平线丢弃")
        : fail(`【38】列表/水平线转换不对：${JSON.stringify(wt)}`);
      // ⛔ 三个发送点（流式追加 / 收尾补发 / 一次性）各自必须带 plainTextForChannel——
      //    只查 import 或单个锚点会被「摘掉一处用法」的死代码骗绿（反证实测）。
      (/sendChunk = \(text: string, opts: \{ clientId\?: string; state\?: number \}\) =>\s*weixinGateway!\.sendText\(from, plainTextForChannel\(text\), opts\)/.test(mainSrc)
        && /plainTextForChannel\(rest\) \|\| "（已完成）"/.test(mainSrc)
        && /send: \(full\) => weixinGateway!\.sendText\(from, plainTextForChannel\(full\)\)/.test(mainSrc)
        && /carry \+= delta/.test(mainSrc) && /lastIndexOf\("\\n"\)/.test(mainSrc))
        ? ok("【38】微信发送前统一走排版转换（三个发送点全带；流式攒到完整行再发，分片不切坏表格）")
        : fail("【38】微信 sink 没接排版转换/没做整行缓冲 —— Markdown 原样竖线堆会继续发到手机上");
      // 渠道通用（09-18 用户：「其他机器人渠道消息是这个一样的效果不」）：Telegram 无 parse_mode、
      // 飞书 msg_type=text、钉钉 msgtype=text、QQ msg_type=0 —— 全是纯文本，必须同走转换。
      (/telegramStreamSink|const text = plainTextForChannel\(full\)/.test(mainSrc)
        && (mainSrc.split("telegramStreamSink")[1] ?? "").split("function botStreamPlanFor")[0].split("plainTextForChannel").length - 1 >= 3
        && /send: \(full\) => telegramGateway\.sendText\(chatId, plainTextForChannel\(full\)\)/.test(mainSrc))
        ? ok("【38】Telegram 三个发送点也走排版转换（Telegram 无 parse_mode，表格/粗体同样会裸奔）")
        : fail("【38】Telegram 没接排版转换 —— 用户会看到 `**粗体**` 与竖线表格");
      (/const text = plainTextForChannel\(content\);/.test(mainSrc)
        && /await feishuGateway\.sendMessage\(chatId, text\)/.test(mainSrc)
        && /await dingtalkGateway\.sendMessage\(chatId, text\)/.test(mainSrc)
        && /await qqGateway\.sendMessage\(chatId, text, ctx\)/.test(mainSrc))
        ? ok("【38】飞书/钉钉/QQ 回复漏斗也走排版转换（三渠道都是纯文本消息类型）")
        : fail("【38】飞书/钉钉/QQ 回复没走排版转换 —— 表格在这些渠道同样是竖线堆");
      // 三渠道流式（09-18 用户：「接上流式（按各渠道限制做）」）：不能编辑消息 ⇒ 追加语义 + 按频控设预算
      (/function feishuStreamSink\(/.test(mainSrc) && /function dingtalkStreamSink\(/.test(mainSrc) && /function qqStreamSink\(/.test(mainSrc)
        && /FEISHU_STREAM_BUDGET: BotStreamBudget = \{ maxFlushes: 4/.test(mainSrc)
        && /DINGTALK_STREAM_BUDGET: BotStreamBudget = \{ maxFlushes: 3/.test(mainSrc)
        && /QQ_STREAM_BUDGET: BotStreamBudget = \{ maxFlushes: 3/.test(mainSrc))
        ? ok("【38】飞书/钉钉/QQ 都有追加式流式 sink + 按频控设的预算（钉钉 webhook 20 条/分、QQ 被动回复 ≤5 次）")
        : fail("【38】三渠道流式 sink/预算缺失 —— 这几家仍只发最终汇总");
      (/channelBotBindings\[channel\]\?\.threadId !== threadId/.test(mainSrc)
        && /const chatId = channelThreadChat\.get\(threadId\)/.test(mainSrc)
        && /\^\(tg\|fs\|dd\|qq\|wecom\):/.test(mainSrc))
        ? ok("【38】流式计划按渠道分发（chatId 登记 + 微信分支排除 fs:/dd:/qq: 前缀，不截胡）")
        : fail("【38】三渠道流式分发有问题 —— 渠道前缀不排除时飞书/钉钉/QQ 会被微信分支截胡");
    }
  }

  // ⑰k 探针协议回落 + 图片模态自愈（09-18 用户反馈两张图：升级用户对火山 Coding Plan 类网关
  //   测 deepseek-v4.1-flash 探针报 404「does not support the coding plan feature」（连接失败），
  //   而会话带图发送报 InvalidParameter「Model do not support image input」——
  //   前者 = 探针只试单协议把"能用"误报成失败；后者 = 模型标了视觉但接入点不支持图片）。
  {
    const mainProbe = readMainSource();
    const appProbe = readAppUi();
    const hookProbe = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");
    (/requestedWire === "chat" \? \["chat"\] : \["responses", "chat"\]/.test(mainProbe))
      ? ok("【39】探针 responses 被拒时自动回落 chat（显式 responses 也回落——单协议误报连接失败）")
      : fail("【39】探针又只试单协议 —— 火山 Coding Plan 类网关会把能用的模型误报成连接失败");
    (/coding plan\/i\.test\(body\)/.test(mainProbe) && /白话：供应商表示这个模型不在其 Coding Plan/.test(mainProbe))
      ? ok("【39】coding-plan 404 带白话提示（告知换通用接入点/换模型，不再只有供应商原话）")
      : fail("【39】coding-plan 404 没有白话提示 —— 用户看到 404 无从下手");
    (/wireMismatch: wireUsed !== requestedWire/.test(mainProbe) && /wireMismatch/.test(hookProbe))
      ? ok("【39】实际连通协议与配置不同时如实标注（wireMismatch → 探针结果提示）")
      : fail("【39】探针协议差异没有上报/展示 —— 连接成功与发送报错会对不上");
    (/void healImageModalityIfUnsupported\(params\.turn\.error\?\.message\)/.test(appProbe)
      && /async function healImageModalityIfUnsupported/.test(appProbe)
      && /inputTypes: \(m\.inputTypes \?\? \[\]\)\.filter\(\(t\) => t !== \"image\"\)/.test(appProbe))
      ? ok("【39】回合报「不支持图片输入」时自动摘掉该模型的 image 模态（幂等自愈）")
      : fail("【39】图片模态自愈缺失/没接回合失败 —— 升级用户的带图回合永远 InvalidParameter");
    // ⛔ 自愈是**后台便利动作**，不许打断用户正在跑的回合（09-18 用户实测「切到另一个会话，
    //    原来在跑的那个立马就断」）：保存模型 → applyCustomModel → server.restart()，而引擎重启
    //    会打断**所有**在跑回合（main.ts 注释原话「重启会打断所有在跑回合」）。
    //    必须在写配置**之前**判 runningThreadIdsRef，否则守卫拦不住真调用。
    (/if \(runningThreadIdsRef\.current\.size > 0\)/.test(appProbe)
      && /已跳过图片模态自动修正/.test(appProbe))
      ? ok("【39】有回合在跑时不自愈（绝不因后台改配置重启引擎、打断别人的回合）")
      : fail("【39】图片自愈会在有回合在跑时照样重启引擎 —— 用户别的会话正在跑的任务会被打断");
    // 图片**正常发送**（09-18 用户：「不管支不支持识图，就可以发正常的图片……就正常发图就行」）：
    // ⛔ 已删掉「按模型 inputTypes 预判 → 把图吞掉、往消息正文塞一段面向用户的说明文字」的降级分支。
    //    两条理由：① 判据是本地元数据，模型其实支持视觉只是漏勾「图片」时图被白吞；
    //    ② 那段文字是写给用户看的（"请告知用户配置视觉插件…"），却被拼进用户消息正文，
    //       模型照抄出来等于在气泡里跟用户讲道理（用户截图实证）。
    //    新契约：图片一律按 localImage 发；真不支持时靠**引擎报错自愈**（上一条断言守着）。
    // ⛔ 断言锚定「活代码」而不是文本存在：条件改成 `if (false && …)` 死代码时字符串还在
    //    （09-18 反证实测抓到过这种假绿）。
    (!/if \(!activeModelSupportsImage\(\)/.test(appProbe) && !/const activeModelSupportsImage/.test(appProbe)
      && !/未配置视觉插件|如需识图请告知用户配置视觉插件/.test(appProbe)
      && /type: "localImage", path/.test(appProbe))
      ? ok("【39】图片一律正常发送（预判吞图与面向用户的注入文案已删除，兜底只留引擎报错自愈）")
      : fail("【39】图片又被预判吞掉了 —— 用户要的是「正常发图」，不是按 inputTypes 猜了再吞");
    // 粘贴入口用函数体切片断言（前 700 字符内不得再出现模态拦截）
    const insertBody = appProbe.split("function insertComposerImages")[1]?.slice(0, 700) ?? "";
    (insertBody.length > 0 && !insertBody.includes("activeModelSupportsImage"))
      ? ok("【39】粘贴入口不按模态硬拦（贴了就该进编辑框，发不发得出去由引擎说了算）")
      : fail("【39】粘贴入口又有硬拦截 —— 用户贴图被拒");
  }

  // ⑰l 旧家 rollout 迁移（09-18 用户：「更新新版本…用户旧会话要能接着用」「复制ID，接力会话也不行」）：
  //   09-10 前的老版本 CODEX_HOME 指在 ~/.codex；切到 userData/codex-home 后老会话三处全失联
  //   （侧栏兜底扫描 / 复制 ID 引用 buildThreadPreview / thread/resume 都只认新家）。
  //   修法 = 启动时把旧家 rollout **拷贝**（只拷不删——~/.codex 可能仍被官方 CLI 用）进新家，
  //   按文件名判重天然幂等。真机验收：隔离 profile 起应用，13 个旧家 rollout 迁入后
  //   侧栏 16 行可见、previewConversation 读旧会话 9 条消息、二次启动幂等零重复。
  {
    const mainMig = readMainSource();
    const fnStart = mainMig.indexOf("async function migrateLegacyRolloutHome");
    /* ⛔ 09-24 修：原实现用 `indexOf("app.whenReady()", fnStart)` 当**收尾哨兵**，而
       migrateLegacyRolloutHome 已随 P2-9 搬进 electron/main/11-maintenance.ts —— 该文件之后
       再无 app.whenReady() ⇒ indexOf 返回 −1 ⇒ slice(fnStart, −1) 一路切到聚合面末尾，
       把其它模块的 rmSync/unlinkSync 全算进函数体 ⇒ **假红**（评估报告 §2.5 加宽聚合面后暴露）。
       改为「下一个行首顶格 `}`」定界 + 长度护栏，不依赖任何哨兵。 */
    const fnClose = fnStart >= 0 ? mainMig.indexOf("\n}", fnStart) : -1;
    const fnBody = fnStart >= 0 && fnClose > fnStart && fnClose - fnStart < 20000
      ? mainMig.slice(fnStart, fnClose)
      : "";
    // ⛔ 用完整签名锚定（带 (): Promise<void> 收尾）：函数被改名成 …Disabled 之类的前缀碰撞骗不过
    (fnStart >= 0 && /async function migrateLegacyRolloutHome\(\): Promise<void>/.test(mainMig) && /copyFile/.test(fnBody))
      ? ok("【40】旧家 ~/.codex rollout 迁移存在（copyFile 进 codex-home，老会话升级后接着用）")
      : fail("【40】旧家 rollout 迁移缺失 —— 老版本升级后老会话三处全失联（侧栏/引用/resume）");
    (fnBody.length > 0 && !/rmSync|unlinkSync/.test(fnBody))
      ? ok("【40】迁移只拷不删（~/.codex 可能仍被官方 Codex CLI 使用，绝不动旧家文件）")
      : fail("【40】迁移里出现删除调用 —— 会破坏用户旧家的官方 Codex CLI 数据");
    (mainMig.indexOf("await migrateLegacyRolloutHome();") >= 0
      && mainMig.indexOf("await migrateLegacyRolloutHome();") < mainMig.indexOf("await server.start();"))
      ? ok("【40】迁移挂在 server.start() 之前的启动链上（侧栏首次 thread/list 就能看到老会话）")
      : fail("【40】迁移没接在 server.start() 之前的启动链上 —— 时机错了等于没迁");
  }

  // ⑰d 引导弹窗的「出场时机」（09-17 用户明确定规则：「只在进入主界面的时候才弹配置引导和
  //   工具安装检测自动安装；如果已经配置模型，就不引导模型配置，直接做开发工具检测安装」）。
  //   三种失效形态都**静默**（不报错，只是该弹的不弹 / 不该弹的弹了）：
  //   ① 登录页期间弹 → 打断登录（那是用户看到的第一屏）
  //   ② 已配模型还引导 → 每次启动都被"教"一遍怎么配模型
  //   ③ 体检被模型引导永久挡住 → 没配模型的用户关掉引导后永远看不到体检（直到重启）
  {
    const appEnv = readAppUi();
    // 按注释锚点切出两个 effect 的块：在全文里裸正则容易误命中别处的同名字符串
    const guideStart = appEnv.indexOf("模型配置引导（09-17 用户要求）");
    const envStart = appEnv.indexOf("体检项（必备：模型");
    const envEnd = appEnv.indexOf("设置弹窗「骨架先行」");
    const guideBlock = guideStart >= 0 && envStart > guideStart ? appEnv.slice(guideStart, envStart) : "";
    const envBlock = envStart >= 0 && envEnd > envStart ? appEnv.slice(envStart, envEnd) : "";
    (guideBlock && /if \(showLogin\) return;/.test(guideBlock))
      ? ok("【32】模型引导在登录页不弹（只在主界面弹）")
      : fail("【32】模型引导没有登录页判断 —— 登录时会被引导打断");
    (/if \(!customModel\) setShowModelGuide\(true\)/.test(guideBlock))
      ? ok("【32】已配模型时不弹模型引导（直接走工具检测）")
      : fail("【32】模型引导的判据变了 —— 已配好模型的用户会被再引导一遍");
    (envBlock && /\[threadsLoading, showLogin, showModelGuide, customModel, workspace(?:, [A-Za-z]+)*\]/.test(envBlock))
      ? ok("【32】体检依赖含 showModelGuide —— 模型引导关掉后体检会补上（允许追加依赖，不许删它）")
      : fail("【32】体检 effect 依赖里没有 showModelGuide —— 没配模型时关掉引导后体检永远不弹");
    (/setEnvCheckOpen\(false\);[\s\S]{0,60}?setShowModelGuide\(false\);[\s\S]{0,60}?setShowLogin\(true\);/.test(appEnv))
      ? ok("【32】登出时两个引导弹窗一起收起（重登不重现）")
      : fail("【32】登出没收起引导弹窗 —— 重新登录后旧弹窗会突然冒出来");
  }

  // ⑱ src/lib/*.mjs 是**纯 JS**（node 直接 import 执行），不得出现 TS 语法。
  //    ⛔ 这条守卫的由来：`export type X = …` / `(a: string): void` 这类标注会让 rolldown 直接
  //    PARSE_ERROR 构建失败，而我在 09-17 的 enhance-hints.mjs 与 codex-identity.mjs 上**各踩一次**
  //    （第二次是因为第一次的教训只写进了记忆、没变成守卫）。类型一律放同目录 .d.mts。
  {
    const libDir = join(ROOT, "src", "lib");
    const mjsFiles = readdirSync(libDir).filter((f) => f.endsWith(".mjs"));
    const offenders = [];
    for (const file of mjsFiles) {
      const code = readFileSync(join(libDir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const hits = [];
      if (/export\s+type\s/.test(code)) hits.push("export type");
      // 参数/变量类型标注。⛔ 前缀要覆盖 const/let/var —— 只写 `^|,|(` 会漏掉 `const y: number`
      // （反证时发现的漏检）。
      if (/(?:^|[,(]\s*|\b(?:const|let|var)\s+)\w+\s*:\s*(?:string|number|boolean|void|unknown|any)\b/m.test(code)) hits.push("类型标注");
      if (/\)\s*:\s*(?:string|number|boolean|void|unknown|any|\w+\[\])\s*\{/.test(code)) hits.push("返回类型标注");
      if (/\bas\s+\{/.test(code)) hits.push("as 断言");
      // 泛型也是 TS 专有：new Set<() => void>() 会被 JS 当成比较运算
      // ⛔ 不能写 `[^>]*` —— 箭头函数的 `=>` 里就有 `>`，正则会提前截断（反证时发现的漏检）。
      if (/new\s+\w+\s*</.test(code)) hits.push("泛型语法");
      if (hits.length) offenders.push(`${file}(${hits.join("/")})`);
    }
    (offenders.length === 0)
      ? ok(`【32】src/lib 下 ${mjsFiles.length} 个 .mjs 均为纯 JS（无 TS 语法，类型在 .d.mts）`)
      : fail(`【32】这些 .mjs 含 TS 语法会直接构建失败：${offenders.join("、")} —— 类型请移到同目录 .d.mts`);
  }

  // ── ⑲【43】永久删除必须连磁盘 rollout 一起清（09-18 用户实测「我删除了，重启又恢复了」）──
  //    根因：引擎的 `thread/delete` 只把线程从**索引**里摘掉，磁盘上的 rollout 文件原样留着；
  //    而 thread/list 的 rollout 兜底扫描把「索引里没有、磁盘上有」的会话当权威源合回侧栏
  //    ⇒ 删掉的会话重启后又冒出来。用户机实测：索引 11 条 / 磁盘 18 个，其中 12 条是
  //    「已从索引删除但文件还在」，侧栏那 7 个分组名与它们的 cwd 一一对应。
  //    三层守卫：①行为（墓碑真排除，且**不传时不排除**）②接线（删除路径 / 列表 / 启动）③打包（内联产物）。
  {
    console.log(C.bold("\n【43】永久删除的磁盘收尾（删了就不能重启复活）"));
    const req = createRequire(import.meta.url);
    const st = req(join(ROOT, "dist-electron", "session-tools.js"));
    const pool = req(join(ROOT, "dist-electron", "rollout-pool.js"));
    const mainTs = readMainSource();
    const workerSrc = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
    const workerGen = readFileSync(join(ROOT, "electron", "rollout-worker-source.ts"), "utf8");

    // ① 行为：墓碑（小写 id）必须把索引侧与兜底侧的同名会话都排掉
    const indexed = [{ id: "KEEP-1", name: "留着", updatedAt: 2 }, { id: "GONE-1", name: "删掉了", updatedAt: 3 }];
    const fallback = [{ id: "GONE-1", name: "删掉了（磁盘独有）", updatedAt: 4 }, { id: "GHOST-2", name: "兜底留着", updatedAt: 1 }];
    const withTomb = st.mergeThreadList(indexed, fallback, false, 100, new Set(["gone-1"]));
    (!withTomb.some((entry) => String(entry.id).toLowerCase() === "gone-1") ? ok : fail)("【43】mergeThreadList：墓碑把已删会话从合并结果里排掉（索引与兜底两侧同 id）");
    (withTomb.length === 2 ? ok : fail)(`【43】mergeThreadList：其它会话不受影响（期望 2 条，实得 ${withTomb.length}）`);
    const withoutTomb = st.mergeThreadList(indexed, fallback, false, 100);
    (withoutTomb.length === 3 ? ok : fail)(`【43】mergeThreadList：不传墓碑时一条都不排（防实现退化成「无条件过滤」的假绿，期望 3 条，实得 ${withoutTomb.length}）`);
    const caseFold = st.mergeThreadList([{ id: "AbC-9", updatedAt: 1 }], [], false, 100, new Set(["abc-9"]));
    (caseFold.length === 0 ? ok : fail)("【43】mergeThreadList：墓碑匹配大小写不敏感（引擎 id 大小写未必与墓碑一致）");

    // ② 接线：删除路径（请求 + 引擎事件）、列表合并、启动载入，缺一不可
    (mainTs.includes('const purgeTarget = method === "thread/delete"') ? ok : fail)("【43】thread/delete 请求路径取出待清理的线程 id");
    (mainTs.includes("if (purgeTarget) await purgeDeletedThread(purgeTarget);") ? ok : fail)("【43】thread/delete 请求路径真的清了磁盘 rollout 并记墓碑");
    (mainTs.includes('if (event.method === "thread/deleted") void purgeDeletedThread(goneId)') ? ok : fail)("【43】引擎侧 thread/deleted 事件路径也走清理（不经渲染层的删除）");
    (mainTs.includes("mergeThreadList(indexed, fallback, archiveFilter, Number((params as any)?.limit ?? 100), deletedThreadIds)") ? ok : fail)("【43】thread/list 合并时传入墓碑集合（否则兜底扫描依旧把删掉的会话捞回来）");
    (mainTs.includes("await loadDeletedThreads();") ? ok : fail)("【43】启动时先载入墓碑（靠懒加载会让首屏出现幽灵会话）");
    (mainTs.includes("deletedThreadIds.has(String(entry.id") ? ok : fail)("【43】手机端会话列表同样按墓碑过滤（那条链路直接打引擎、不过合并逻辑）");

    // ③ 打包：worker 的清理能力必须进内联产物（生成物落后 = 打包后清理是空操作）
    (workerSrc.includes('msg.op === "purge"') && workerSrc.includes("function purgeRolloutFiles(") ? ok : fail)("【43】worker 源码有 purge op 及其实现");
    (workerGen.includes('msg.op === "purge"') && workerGen.includes("purgeRolloutFiles") ? ok : fail)("【43】内联产物 rollout-worker-source.ts 含 purge（落后于 .cjs 就重新生成）");
    (typeof pool.purgeRolloutFilesAsync === "function" ? ok : fail)("【43】rollout-pool 暴露 purgeRolloutFilesAsync");

    // ④ 语义：引擎对「索引里已无这条线程」的删除会报错（failed to read session metadata…），
    //    而这类会话正是用户二次删除的幽灵 —— 本地残留已清、墓碑已记，必须按成功返回，
    //    否则渲染层会弹「删除任务失败」，用户以为没删掉又会反复点。
    //    断言钉住「条件 + 匹配串」两部分，只查标识符会被 `if (false)` 架空。
    (/if \(purgeTarget && \/failed to delete thread\|failed to read session metadata\|no rollout found/.test(mainTs) ? ok : fail)("【43】幽灵会话的删除报错按成功处理（不然用户二次删除会看到「删除失败」）");
    (mainTs.includes("localCleanupOnly") ? ok : fail)("【43】成功返回带上 localCleanupOnly 标记（便于将来排查「日志说成功、引擎侧没删」）");

    // ⑤ 墓碑不能是**单向死锁**（code review 抓到的真缺口）：导入会话备份时
    //    `applySessionsBackup` 原样复用备份里的 thread id，不清墓碑的话
    //    「删除 → 再从备份导入」之后这条会话永远不显示，用户也查不出原因。
    (/async function forgetDeletedThreads\(ids: string\[\]\)/.test(mainTs) && mainTs.includes("deletedThreadIds.delete(id)") ? ok : fail)("【43】墓碑可被摘除（forgetDeletedThreads 实现存在）");
    (mainTs.includes("await forgetDeletedThreads(summary.threads.filter((entry: { status: string }) => entry.status === \"ok\")") ? ok : fail)("【43】导入备份写入成功即摘墓碑（只清 status===\"ok\"，duplicate/conflict 保留墓碑）");
  }

  // ── ⑳【44】回合结束时必须说清「为什么停」（09-18 用户实测「跑长任务老是中途自动停止」）──
  //    引擎把原因写在 `turn.error`（`codexErrorInfo` 分类枚举）与 `status === "interrupted"` 上，
  //    真机实测被中断的回合是 `{status:"interrupted", error:null}` —— 旧实现 `turn.error ? "处理出错" : …`
  //    既把所有错误压成四个字，又让被中断的回合显示成「耗时 3s」（用户只能理解成"它自己停了"）。
  //    守卫三层：①纯函数行为（直跑 src/lib/turn-stop-reason.mjs）②界面接线 ③旧写法必须消失。
  {
    console.log(C.bold("\n【44】回合结束原因（为什么停 / 能不能接着跑）"));
    const { describeTurnStop, turnHeadline, isAwaitingTurnClose } = await import("../../src/lib/turn-stop-reason.mjs");
    const appSrc = readAppUi();
    const cssSrc = readStyles();
    const libSrc = readFileSync(join(ROOT, "src", "lib", "turn-stop-reason.mjs"), "utf8");

    // ① 行为：被中断（真机实测形态）必须看得出来
    const interrupted = describeTurnStop({ status: "interrupted", error: null, durationMs: 3001 });
    (interrupted.label === "已停止" ? ok : fail)(`【44】status=interrupted 且 error=null → 「已停止」（旧实现落进「耗时 Xs」分支；实得「${interrupted.label}」）`);
    (interrupted.detail.includes("接着发一条消息") ? ok : fail)("【44】被中断时给出「怎么继续」的说明");
    // ② 行为：错误分类要落到中文标签，且保留引擎原文
    const ctx = describeTurnStop({ status: "failed", error: { message: "context window exceeded", codexErrorInfo: "contextWindowExceeded" } });
    (ctx.label === "上下文超限" ? ok : fail)(`【44】codexErrorInfo=contextWindowExceeded → 「上下文超限」（实得「${ctx.label}」）`);
    (ctx.detail.includes("context window exceeded") && ctx.detail.includes("新会话") ? ok : fail)("【44】上下文超限：既带引擎原文也带处置建议");
    (describeTurnStop({ status: "completed", error: { message: "m", codexErrorInfo: "sandboxError" } }).label === "沙箱拒绝" ? ok : fail)("【44】sandboxError → 「沙箱拒绝」（命令被策略拒的场景）");
    (describeTurnStop({ status: "completed", error: { message: "m", codexErrorInfo: "rateLimitExceeded" } }).label === "被限流" ? ok : fail)("【44】rateLimitExceeded → 「被限流」");
    (describeTurnStop({ status: "completed", error: { message: "上游炸了", codexErrorInfo: "someFutureCode" } }).label === "处理出错" ? ok : fail)("【44】未知分类回落「处理出错」（引擎新增分类不能变成空白）");
    // ③ 行为：正常完成 / 运行中**不得**出现提示（防误报）
    (describeTurnStop({ status: "completed", durationMs: 1200 }).label === "" ? ok : fail)("【44】正常完成的回合不出提示条（否则每条消息下面都挂一块）");
    (describeTurnStop({ status: "inProgress" }).kind === "running" ? ok : fail)("【44】运行中的回合按 running 处理（不显示结束原因）");
    // ④ 行为：引擎给的「继续指令」要取出来（misalignment.steer.message）
    const steer = describeTurnStop({ status: "failed", error: { message: "x", codexErrorInfo: "misalignmentPolicyViolation", misalignment: { steer: { message: "继续执行剩余步骤" } } } });
    (steer.continueText === "继续执行剩余步骤" ? ok : fail)("【44】misalignment.steer.message 被提取（引擎说「确认继续就把这条作为下一回合输入」）");
    // ⑤ 标题合成：分类 + 耗时
    (turnHeadline({ status: "interrupted", error: null }, "3s") === "已停止 · 耗时 3s" ? ok : fail)("【44】标题合成「已停止 · 耗时 3s」");
    (turnHeadline({ status: "completed" }, "") === "已处理" ? ok : fail)("【44】正常完成回落「已处理」");
    // ⑥ 接线 + 旧写法必须消失（这是"修好了"的关键锚，别只查新符号存在）
    (appSrc.includes("describeTurnStop(turn)") ? ok : fail)("【44】界面调用 describeTurnStop");
    (appSrc.includes("turn-stop-notice") && appSrc.includes("stopReason.label &&") ? ok : fail)("【44】非正常结束渲染提示条（含原因与建议）");
    (!/turn\.error \? "处理出错"/.test(appSrc) ? ok : fail)("【44】旧的「有 error 就写处理出错」写法已消失（否则被中断的回合还是看不出原因）");
    (!/turn\.error \? "出错"/.test(appSrc) ? ok : fail)("【44】回合状态词不再只写「出错」");
    (cssSrc.includes(".turn-stop-notice") && cssSrc.includes(".turn-stop-notice.stop-interrupted") ? ok : fail)("【44】提示条样式存在（被中断用中性色，不冒充错误）");
    (libSrc.length > 800 ? ok : fail)("【44】原因表在纯函数模块里（可直跑断言，不是散在 JSX 里的字面量）");

    // ⑦ 「正文已完整，等待模型收尾」（09-18 用户实测「怎么回复完了还没结束」：gpt-5.6-sol
    //    正文落盘后 28 秒零事件才 task_complete —— 引擎干等上游的流结束信号，不是 bug，
    //    但界面还说「正在生成回复」就是误导）。
    (isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】正文完成且无在跑 item → 收尾等待状态");
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "inProgress", text: "" }] }) ? ok : fail)("【44】正文还在流式输出 → 不算收尾等待（防误报）");
    (isAwaitingTurnClose({ status: "inProgress", items: [{ type: "commandExecution", status: "completed" }, { type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】前面有已完成工具不影响判定（只看最后的有正文消息）");
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "completed", text: "答案" }, { type: "commandExecution", status: "inProgress" }] }) ? ok : fail)("【44】还有在跑的 item → 不算收尾等待");
    (!isAwaitingTurnClose({ status: "completed", items: [{ type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】回合已结束 → 不算收尾等待");
    // 09-18 收严：在跑的 item 要**扫全量**，不能只看到正文为止 —— 否则「正文已完成 +
    // 后面还有一条在跑的命令」会同时显示「正在执行命令」和「正文已完整，等待模型收尾」。
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "commandExecution", status: "inProgress" }, { type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】在跑的 item 哪怕排在正文之前也不算收尾等待（防状态行自相矛盾）");
    // 界面接线：① 收尾提示**只在一处**说（09-18 用户实测「这段文字会出现在『正在处理』后面，
    //    跟消息下面重复了」—— 两边同时报同一句就是同屏重复）② 状态行兜底**复用同一判据**
    //    （不许在组件里再抄一份，两份会漂移）。锚用**结构正则**不锁整行字面量
    //    （09-18 教训：给组件加 prop 就会让整行锚假红）。
    const timerIdx = appSrc.indexOf("function RunningProcessTime");
    const timerFn = timerIdx >= 0 ? appSrc.slice(timerIdx, appSrc.indexOf("\n}", timerIdx) + 2) : "";
    (timerFn && !/等待模型收尾/.test(timerFn) ? ok : fail)("【44】收尾提示只在底部状态行说一次（计时条不再重复同一句）");
    (/const turnFinalizing = Boolean\([^)]*isAwaitingTurnClose\(/.test(appSrc) ? ok : fail)("【44】收敛为一个布尔判据（状态行与短语共用，不各写一份）");
    (/turnFinalizing \? "正文已完整，等待模型收尾"/.test(appSrc) ? ok : fail)("【44】状态行在收尾等待时如实说（不再写「正在生成回复」）");
    // ⛔ 反向守卫：判据**不许**写成 `runActivity === "某中文文案"` —— 文案一改就静默失效，
    //   界面会悄悄退回「正在生成回复」，而预检照样全绿（09-18 审查抓出的隐患）。
    //   ⛔ 必须先去掉注释再判：注释里解释这条隐患时也会出现同样的写法，直接正则会假红（本轮踩到）。
    const appNoCmt = appSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    (!/runActivity\s*===\s*"/.test(appNoCmt) ? ok : fail)("【44】不用展示文案做状态判据（否则改文案 = 判据静默失效）");
    // 收尾态的底部短语只能用**专属池**：过通用池会抽到「正在把改动收拢干净」这类干活句。
    const exactIdx = appSrc.indexOf("function pickRunPhraseExact");
    const exactWin = exactIdx >= 0 ? appSrc.slice(exactIdx, exactIdx + 260) : "";
    (exactWin && /RUN_PHRASES_BY_ACTIVITY\[activity\]/.test(exactWin) && !/\.\.\.RUN_PHRASES\b/.test(exactWin) ? ok : fail)("【44】收尾态专属句不过通用池（pickRunPhraseExact 只取专属池）");
    (/setRunPhrase\(turnFinalizing \? pickRunPhraseExact\(/.test(appSrc) ? ok : fail)("【44】收尾状态跨进/跨出各换一次句（只在跨界时换，不在「思考→命令」之间乱换）");
  }

  // ⑰n 语法高亮结果缓存（09-18 用户：「切换运行会话会有一些卡顿延迟」）
  //   根因：切换会话时消息列表卸载再挂载，每段代码重新高亮 —— CDP CPU profile 实证
  //   `createElement`（库内部的递归建元素函数）单函数自耗 **2251ms**；逐会话实测切换耗时
  //   ≈ 目标会话 DOM 规模 × 0.15ms（r=0.974）：666 元素 6ms / 8001 元素 703ms /
  //   13554 元素 1951ms / 23162 元素 **3651ms**。
  //   修法=给库的 renderer prop 接一层按内容寻址的 LRU（纯计算优化、零外观变化）。
  //   守卫三层：①纯函数行为（直跑 src/lib/code-highlight-cache.mjs）②三处接线 ③流式不接。
  {
    console.log(C.bold("\n【45】语法高亮结果缓存（切会话不重复高亮）"));
    const { highlightCacheKey, createHighlightCache } = await import("../../src/lib/code-highlight-cache.mjs");
    const appSrc45 = readAppUi();

    // ① 键必须覆盖所有影响高亮产物的输入 —— 漏一个字段就会串键（不同代码命中同一份元素树 = 高亮错乱）
    const base = { language: "ts", code: "const a = 1;", theme: "one-dark", lineNumbers: true, wrapLongLines: false };
    const k0 = highlightCacheKey(base);
    (k0 === highlightCacheKey({ ...base }) ? ok : fail)("【45】同样的输入 → 同样的键（缓存才能命中）");
    (k0 !== highlightCacheKey({ ...base, code: "const a = 2;" }) ? ok : fail)("【45】代码不同 → 键不同（否则会用错元素树）");
    (k0 !== highlightCacheKey({ ...base, language: "python" }) ? ok : fail)("【45】语言不同 → 键不同");
    (k0 !== highlightCacheKey({ ...base, theme: "dracula" }) ? ok : fail)("【45】主题不同 → 键不同（否则切主题后颜色不跟着变）");
    (k0 !== highlightCacheKey({ ...base, lineNumbers: false }) ? ok : fail)("【45】行号开关不同 → 键不同");
    (k0 !== highlightCacheKey({ ...base, wrapLongLines: true }) ? ok : fail)("【45】换行开关不同 → 键不同");
    // 串键防护：分隔符必须不可出现在正常输入里（用 \u0000 而不是空格/竖线）
    (highlightCacheKey({ language: "a", code: "b" }) !== highlightCacheKey({ language: "a b", code: "" }) ? ok : fail)("【45】拼接不产生歧义（分隔符不可被输入伪造出同键）");

    // ② LRU 行为：容量上限、淘汰最旧、get 提升热度、命中/未命中计数
    const c = createHighlightCache({ maxEntries: 3, minCodeChars: 10, maxCodeChars: 100 });
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    (c.size === 3 ? ok : fail)("【45】容量上限生效（3 条）");
    (c.get("a") === 1 ? ok : fail)("【45】能取回已缓存内容");
    c.set("d", 4); // 超容量：最旧的应是 b（a 刚被 get 提到最新）
    (c.get("b") === undefined && c.get("a") === 1 ? ok : fail)("【45】淘汰的是最久未用的那条（get 过的不会被先淘汰）");
    (c.size === 3 ? ok : fail)("【45】淘汰后仍不超容量");
    const st = c.stats();
    (st.hits >= 2 && st.misses >= 1 ? ok : fail)(`【45】命中/未命中计数可用（实得 hits=${st.hits} misses=${st.misses}）`);
    // 字符总量上限（防"很多大块"把内存吃满）；淘汰时总量必须同步扣减，否则会提前把缓存清空
    const c2 = createHighlightCache({ maxEntries: 99, maxTotalChars: 30, minCodeChars: 1, maxCodeChars: 999 });
    c2.set("x".repeat(20), 1); c2.set("y".repeat(20), 2);
    (c2.size === 1 && c2.stats().totalChars === 20 ? ok : fail)(`【45】总字符上限生效且总量同步扣减（实得 size=${c2.size} totalChars=${c2.stats().totalChars}）`);
    // 覆盖校验：把同一个 key 再 set 一次不得重复计账（否则总量虚高、缓存被提前清空）
    c2.set("y".repeat(20), 3);
    (c2.stats().totalChars === 20 ? ok : fail)("【45】重复 set 同一键不重复计账");
    // 长度窗口：太短不缓存（本来不贵）、超单块上限不缓存
    (!c.shouldCache("x".repeat(5)) ? ok : fail)("【45】过短的代码块不缓存（收益低、只增开销）");
    (c.shouldCache("x".repeat(50)) ? ok : fail)("【45】正常长度的代码块缓存");
    (!c.shouldCache("x".repeat(500)) ? ok : fail)("【45】超单块上限的代码块不缓存");
    // ⛔ 默认上限必须覆盖真机出现过的大块（13346 元素的那个会话里最长块 66838 字）——
    //    第一版把单块上限设成 60000，恰好吃不到缓存，那个会话每次切换照样高亮 ~1.4 秒。
    {
      const d = createHighlightCache();
      (d.shouldCache("x".repeat(66838)) ? ok : fail)(`【45】默认单块上限覆盖真机出现过的 66838 字大块（当前 maxCodeChars=${d.stats().maxCodeChars}）`);
      (d.stats().maxTotalChars >= 600000 ? ok : fail)("【45】默认总量上限不缩水（防很多大块把内存吃满，同时别把预算设到吃不到缓存）");
    }

    // ③ 接线：三处 SyntaxHighlighter 必须都能接 renderer；流式追字期间不许接
    const rendererUses = (appSrc45.match(/renderer=\{/g) ?? []).length;
    (rendererUses >= 3 ? ok : fail)(`【45】三处高亮都接上了缓存 renderer（实得 ${rendererUses} 处）`);
    (/function makeCachedHighlightRenderer\(cacheKey: string\)/.test(appSrc45) && /createHighlightElement\(\{ node, stylesheet, useInlineStyles/.test(appSrc45)
      ? ok : fail)("【45】缓存 renderer 复用库自身的 createElement（不是自己重写高亮逻辑）");
    // ⛔ 流式追字时 text 每帧都变，key 每帧 miss —— 必须返回 undefined 走默认实现
    (/if \(revealing \|\| virtualizable \|\| !HIGHLIGHT_CACHE\.shouldCache\(text\)\) return undefined;/.test(appSrc45)
      ? ok : fail)("【45】逐字追字期间不接缓存（否则每帧 miss，白付哈希/淘汰开销）");
    // ⛔ MdCode 的提前 return（!className / mermaid）之后**不得再出现任何 hook 调用**，
    //    否则 hooks 顺序错乱（React 会直接报错）。
    //    ⚠️ 判据必须是「return 之后那段里没有 hook」，不能写成「存在某个 hook 在 return 之前」——
    //    后者因为 useCodeSettings() 一直在函数开头而**恒真**（本条守卫第一版就是这样，
    //    反证时把 hooks 挪到 return 之后它照样绿，等于没有守卫）。
    const mdIdx = appSrc45.indexOf("const MdCode = memo(function MdCode");
    const mdBody = mdIdx >= 0 ? appSrc45.slice(mdIdx, appSrc45.indexOf("\n});", mdIdx)) : "";
    const retIdx = mdBody.search(/if \(!className\) return/);
    const afterReturn = retIdx > 0 ? mdBody.slice(retIdx) : "";
    (/useMemo\(|useState\(|useRef\(|useEffect\(|useCallback\(|useCodeSettings\(/.test(afterReturn) ? fail : ok)("【45】MdCode 的提前 return 之后没有 hook 调用（hooks 顺序不能变）");
    // ⛔ 流式追字期间不许写缓存：流式每帧一个 never-again 的新 key，照单写入会把其它会话
    //    攒下的条目按 LRU 挤掉（那些会话切回来又变慢）。判据 =「在上次文本上追加」。
    (/const appended = prevCodeRef\.current\.length > 0 && code\.length > prevCodeRef\.current\.length && code\.startsWith\(prevCodeRef\.current\);/.test(appSrc45)
      && /useMemo\(\(\) => \(!appended && HIGHLIGHT_CACHE\.shouldCache\(code\)/.test(appSrc45)
      ? ok : fail)("【45】流式追字期间不写缓存（防中间态挤掉其它会话的缓存条目）");
  }

  // ⑰o 懒高亮 + 图片项折叠 + 用户附件行位置（09-18 用户三条连报）
  {
    console.log(C.bold("\n【46】懒高亮 / 图片项折叠 / 附件行位置"));
    const appSrc46 = readAppUi();
    const foldSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8");
    const { deservesLazyHighlight, plainCodeStyles, LAZY_HIGHLIGHT_MIN_CHARS } = await import("../../src/lib/lazy-highlight.mjs");
    const { attachChipName } = await import("../../src/lib/attach-chip-name.mjs");

    // ① 懒高亮阈值（纯函数直跑）
    (LAZY_HIGHLIGHT_MIN_CHARS >= 1000 ? ok : fail)(`【46】懒加载只针对"大块"（阈值 ${LAZY_HIGHLIGHT_MIN_CHARS} 字符）`);
    (deservesLazyHighlight("x".repeat(LAZY_HIGHLIGHT_MIN_CHARS)) && !deservesLazyHighlight("x".repeat(LAZY_HIGHLIGHT_MIN_CHARS - 1)) ? ok : fail)("【46】阈值边界正确（等于阈值懒加载、差一个字符不懒加载）");
    (!deservesLazyHighlight(undefined) && !deservesLazyHighlight(null) ? ok : fail)("【46】空值不崩（undefined/null 当小块）");
    // ② 兜底样式必须取自与高亮一致的键（否则未高亮时背景/文字色不同 = 白底闪一下）
    {
      const theme = { 'pre[class*="language-"]': { background: "bg" }, 'code[class*="language-"]': { color: "fg" } };
      const s = plainCodeStyles(theme);
      (s.pre.background === "bg" && s.code.color === "fg" ? ok : fail)("【46】未高亮兜底用主题的 pre/code 基样式（背景与文字色和高亮后一致，不闪白）");
      (JSON.stringify(plainCodeStyles(null)) === JSON.stringify({ pre: {}, code: {} }) ? ok : fail)("【46】主题缺失时兜底为空对象（不崩）");
    }
    // ③ 接线：三处代码块都要接 + 共享单个 observer + 不支持时降级
    const lazySites = (appSrc46.match(/useNearViewport\(/g) ?? []).length;
    (lazySites >= 4 ? ok : fail)(`【46】三处代码块都接上懒高亮（useNearViewport 出现 ${lazySites} 次 = 定义 1 + 接线 3）`);
    (/let sharedHighlightObserver/.test(appSrc46) && /new IntersectionObserver\(/.test(appSrc46) && /rootMargin: "1200px 0px"/.test(appSrc46)
      ? ok : fail)("【46】共享单个 IntersectionObserver 且带预载 rootMargin（几百个代码块不各建一个）");
    (/typeof IntersectionObserver !== "function"\) return null/.test(appSrc46) ? ok : fail)("【46】环境不支持 IntersectionObserver 时降级直接高亮（不空白）");
    // ④ 图片项：查看 → foldable，生成 → 仍常驻
    (/if \(item\.type === "plan" \|\| item\.type === "imageGeneration"\) return "keepVisible";/.test(foldSrc) ? ok : fail)("【46】plan 与生成图仍常驻外露");
    (!/item\.type === "plan" \|\| item\.type === "imageView"/.test(foldSrc) ? ok : fail)("【46】imageView（查看图片）不再 keepVisible（不再一张一个大图铺满消息区）");
    (/case "imageView": return \{ key: "image-view", label: "查看图片" \};/.test(foldSrc) ? ok : fail)("【46】imageView 有独立分组标签");
    (/case "imageView":[\s\S]{0,140}group: "read"/.test(foldSrc) ? ok : fail)("【46】imageView 摘要归 read 组（显示「查看 xxx」而非「处理多个步骤」）");
    // ⑤ 用户附件：**内联在正文文字流里**，形态与输入框逐字一致（用户三次纠正后的定稿）
    {
      // ⛔ 定稿契约（09-18 用户：「谁让你单独一行靠右了，我要的是像输入框那样，内联在里面」）：
      //    附件 chip 必须与输入框共用 `.composer-image-chip-inline`，且**不许**再有"气泡下方独立附件行"。
      //    曾有两版被否决的实现（单独一行右对齐 / 方形缩略图），守卫要防它们复活。
      const css46 = readStyles();
      (appSrc46.includes("const inlineAttachItems") ? ok : fail)("【46】附件以 inlineAttachItems 组装（供内联渲染）");
      (!/\{attachRow\}/.test(appSrc46) && !/const attachRow =/.test(appSrc46)
        ? ok : fail)("【46】已删除气泡下方的独立附件行（附件不再另起一行）");
      (!/\.msg-refs\.user-attach-row \{/.test(css46) && !/\.msg-refs \.user-attach-chip \{/.test(css46)
        ? ok : fail)("【46】被否决的两版附件行样式已清除（不留复活入口）");
      (!/refImageFiles|refPlainFiles/.test(appSrc46) ? ok : fail)("【46】附件不做图片/文件左右分区（用户要的是统一内联）");
      // 内联 chip 必须在正文 <p class="user-message-text"> 之内（不是它的兄弟节点）
      const bodyIdx = appSrc46.indexOf("const inlineAttachItems");
      const listIdx = bodyIdx > 0 ? appSrc46.indexOf("{inlineAttachItems.map(", bodyIdx) : -1;
      const pOpen = listIdx > 0 ? appSrc46.lastIndexOf('<p className="user-message-text">', listIdx) : -1;
      const pClose = listIdx > 0 ? appSrc46.indexOf("</p>", listIdx) : -1;
      (listIdx > 0 && pOpen > 0 && pClose > listIdx && pClose - listIdx < 2000
        ? ok : fail)("【46】附件 chip 内联在正文段落内（文字 + chip 同一文字流）");
      // 与输入框**字面同一个类名** —— 这是"发送前看到的样子 == 发送后显示的样子"的保证
      // （09-18 起抽成模块级组件 `MessageAttachChip`，所以判据落在**组件定义**上）
      const chipDef = (() => {
        const i = appSrc46.indexOf("function MessageAttachChip(");
        if (i < 0) return "";
        // ⛔ 终点不能写死 "\n}\n"：CRLF 文件里 `}` 前是 \r ⇒ 永远匹配不到 ⇒ 切片一路吞到
        //    聚合串尾，把**后续文件**里的 user-attach-chip/ref-image-card 误收进来（09-24 实测：
        //    主仓库 readdir 顺序把 CRLF 文件排前 ⇒ 假红；副本靠顺序运气绿）。终点改 CRLF 兼容。
        const m = /\r?\n\}\r?\n/.exec(appSrc46.slice(i));
        return m ? appSrc46.slice(i, i + m.index + m[0].length) : "";
      })();
      (chipDef.includes('className={`composer-image-chip-inline message-attach-chip') && !/user-attach-chip|ref-image-card/.test(chipDef)
        ? ok : fail)("【46】内联附件复用输入框的 composer-image-chip-inline（不自造 chip 样式）");
      // 文件与图片都要能内联（文件用 FileText 图标 + 文件名）
      (chipDef.includes("FileText") && chipDef.includes("composer-image-chip-name")
        ? ok : fail)("【46】文件与图片都内联（文件用 FileText 图标 + 文件名）");
      // 去重：已在文本占位符里渲染过的图片不重复出现（否则同一张图显示两份）
      (chipDef.length > 0 && /inlineImageSet\.has\(path\)/.test(appSrc46)
        ? ok : fail)("【46】内联附件对占位符已渲染的图片去重（不出现两份）");
      // ⛔ 附件名必须是"像文件名"的字符串：data URL 直接取 basename 会得到 base64 尾巴
      //    （实测 `basename("data:image/png;base64,iVBOR…")` → `q842iQAAAABJRU5ErkJggg==`）。
      //    09-18 代码审查抓到的真缺陷，用纯函数钉死。
      {
        const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
        const dataName = attachChipName({ type: "image", image_url: DATA }, DATA);
        (/^(data:|=|.*base64)/.test(dataName) || dataName.length > 12
          ? fail : ok)(`【46】data URL 图片的名字不是 base64 尾巴（实得「${dataName}」）`);
        (attachChipName({ type: "localImage", path: "C:\\a\\b\\真图.png" }, "C:\\a\\b\\真图.png") === "真图.png"
          ? ok : fail)("【46】有本地路径时用其文件名");
        (attachChipName({ type: "localImage", path: "/tmp/x/y.jpg" }, "/tmp/x/y.jpg") === "y.jpg"
          ? ok : fail)("【46】posix 路径同样取末段");
        (attachChipName({ type: "image", image_url: "https://cdn.example.com/a/pic.png?v=2#x" }, "https://cdn.example.com/a/pic.png?v=2#x") === "pic.png"
          ? ok : fail)("【46】http 图片名剥掉 query/hash");
        (attachChipName({}, "") === "图片" && attachChipName(null, null) === "图片"
          ? ok : fail)("【46】无来源时兜底为「图片」（不崩、不空）");
        // ⛔ part.path 本身就是 data URL 的分支（真机验收抓到的 bug：lastSegment 先剥了前缀，
        //    之后的 startsWith("data:") 永远为假 → 名字显示成 base64 尾巴）
        (attachChipName({ type: "image", path: DATA }, DATA) === "粘贴的图片"
          ? ok : fail)("【46】part.path 是 data URL 时也识别成「粘贴的图片」（先拦 data: 再取末段）");
        // 结构守卫：extraImages 的命名必须走纯函数，不许回退成裸 basename
        (!/const name = basename\(String\(part\?\.path \?\? src\)\)/.test(appSrc46) && /attachChipName\(part, src\)/.test(appSrc46)
          ? ok : fail)("【46】粘贴图片的名字经 attachChipName 归一（不许直接 basename(src)）");
        // 文本占位符那支也必须走同一个纯函数：local path 结果相同，但 data URL 占位符
        // 若走裸 basename 又会露出 base64 尾巴 —— 两处口径必须一致（09-18 守卫抓出的不一致）
        (/name=\{attachChipName\(\{ path: seg\.path \}, seg\.path\)\}/.test(appSrc46) && !/name=\{basename\(seg\.path\) \|\| seg\.path\}/.test(appSrc46)
          ? ok : fail)("【46】文本占位符图片的名字也走 attachChipName（两支口径一致）");
      }
    }

    console.log(C.bold("\n【47】内联图片：点击大预览 + 悬停自适应小预览"));
    const { imageDisplaySrc, localImageUrl, LOCAL_IMAGE_SCHEME } = await import("../../src/lib/image-src.mjs");
    {
      // ① 纯函数：src 归一化必须**认得出 data URL**，否则会被拼成本地协议 URL（灯箱/preview 全打不开）
      const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
      (imageDisplaySrc(DATA) === DATA ? ok : fail)(`【47】data URL 原样透传（实得 ${String(imageDisplaySrc(DATA)).slice(0, 42)}…）`);
      (imageDisplaySrc("https://x.com/a.png") === "https://x.com/a.png" ? ok : fail)("【47】http(s) 原样透传");
      (imageDisplaySrc("blob:http://x/1") === "blob:http://x/1" ? ok : fail)("【47】blob 原样透传");
      (imageDisplaySrc("harness-image://local?path=x") === "harness-image://local?path=x" ? ok : fail)("【47】已是协议 URL 的不重复包装");
      (imageDisplaySrc("") === "" && imageDisplaySrc(null) === "" ? ok : fail)("【47】空值返回空串（不崩）");
      // 本地路径 → 协议 URL，且**必须双重编码**（单编码会让反斜杠在协议层丢失 → 透明占位图）
      const win = "C:\\dir\\a b.png";
      const want = LOCAL_IMAGE_SCHEME + encodeURIComponent(encodeURIComponent(win));
      (localImageUrl(win) === want ? ok : fail)("【47】本地路径双重编码（改单编码会让图片变透明占位）");
      (/%25/.test(localImageUrl(win)) ? ok : fail)("【47】确实编了两层（URL 里出现 %25）");
      (imageDisplaySrc(win).startsWith(LOCAL_IMAGE_SCHEME) ? ok : fail)("【47】本地路径走自定义协议");
      // ⛔ 灯箱的「在文件夹中显示」必须靠 resolveImagePath 的真返回值决定：它对 data URL / http
      //    返回 null（那两个来源没有本机文件可定位）。断言这段结构，防"给 data URL 也挂一个
      //    指向假路径的按钮"。曾写过一个 isLocalImageSource 纯函数，但它没有任何调用点
      //    （resolveImagePath 已天然处理）→ 属死代码，已删（不再为无人使用的函数写断言）。
      (/const local = resolveImagePath\(path\);/.test(appSrc46) && /return local\s*\r?\n?\s*\? <button title="在文件夹中显示"/.test(appSrc46)
        ? ok : fail)("【47】灯箱「在文件夹中显示」以 resolveImagePath 的真返回值为准（data/http 不挂）");
      // ② 结构守卫：三个显示位点都必须用 imageDisplaySrc，且**不许**再出现旧的 http-only 三元
      // ⛔ 用 codeOnly 剥掉注释：注释里解释这个隐患时会写出同款字符串（本仓库就这么写的），
      //    按原文匹配会把它算成一处残留 → 假红（09-18 实测，见 codeOnly 的说明）。
      const badTernary = codeOnly(appSrc46).split(/\r?\n/).filter((l) => /startsWith\("http"\) \? [^\n]*: imageUrl\(/.test(l)).length;
      (badTernary === 0 ? ok : fail)(`【47】没有残留「只看 http、其余当本地路径」的旧写法（实得 ${badTernary} 处，已排除注释）`);
      const displaySites = (appSrc46.match(/imageDisplaySrc\(/g) || []).length;
      (displaySites >= 3 ? ok : fail)(`【47】消息图片 / 灯箱 / 悬停预览都走 imageDisplaySrc（${displaySites} 处，含定义 1）`);
      (/function imageUrl\(path: string\) \{\s*\r?\n\s*\/\/[^\n]*\r?\n\s*return localImageUrl\(path\);/.test(appSrc46)
        ? ok : fail)("【47】imageUrl 转发到纯函数（行为不变、可离线断言）");
      // ③ 组件必须是模块级的（内联箭头函数会每次 render 换身份 → 图片子树重挂、预览闪烁）
      (/^function MessageAttachChip\(/m.test(appSrc46) ? ok : fail)("【47】内联附件 chip 是模块级组件（不在 render 里现造）");
      (/<MessageAttachChip/.test(appSrc46) ? ok : fail)("【47】正文占位符图片与附件列表都复用它");
      (/className="message-attach-preview"/.test(appSrc46) ? ok : fail)("【47】图片 chip 里带悬停预览浮层");
      // ④ CSS：默认隐藏 + hover/focus 显示 + 两方向都限上限（自适应宽高比）+ 不挡自己的 hover
      const css47 = readStyles();
      (/\.message-attach-preview \{[\s\S]{0,420}?opacity: 0;[\s\S]{0,200}?visibility: hidden;/.test(css47)
        ? ok : fail)("【47】预览默认隐藏（不占位、不挡视线）");
      (/\.message-attach-chip:hover \.message-attach-preview,[\s\S]{0,120}?\.message-attach-chip:focus-visible \.message-attach-preview \{/.test(css47)
        ? ok : fail)("【47】hover 与键盘 focus 都能唤出预览");
      (/\.message-attach-preview img \{[\s\S]{0,300}?max-width:[^;]+;[\s\S]{0,160}?max-height: 240px;/.test(css47)
        ? ok : fail)("【47】预览只给上限（宽高 auto ⇒ 自适应原始宽高比，不用按比例写分支）");
      (/\.message-attach-preview \{[\s\S]{0,520}?pointer-events: none;/.test(css47)
        ? ok : fail)("【47】预览不接收鼠标（否则会挡掉 chip 自身的 hover/click）");
      (/\.message-attach-chip \{\s*\r?\n\s*position: relative;/.test(css47) ? ok : fail)("【47】chip 是定位上下文（浮层锚在它上方）");
      (/\.message-attach-chip\.is-image \{\s*\r?\n\s*cursor: zoom-in;/.test(css47) ? ok : fail)("【47】图片 chip 用 zoom-in 光标提示可点开大图");
      // ⑤ 浮层不能被祖先裁掉：气泡链路上不许有 overflow 裁剪
      const clipAncestors = [".message-body", ".user-message .message-body", ".user-message-text"]
        .filter((sel) => {
          const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*overflow: (hidden|clip)", "");
          return re.test(css47);
        });
      (clipAncestors.length === 0 ? ok : fail)(`【47】气泡链路没有 overflow 裁剪（否则预览会被切掉）：${clipAncestors.join(", ") || "无"}`);
      // ⑥ 上方空间不足要能翻到下方 —— 聊天区滚动容器有 overflow 裁剪，靠近顶部的消息
      //    若硬往上弹会被切掉上半截（真机实测预览 top=-101，等于看不见）
      (/setPreviewBelow\(/.test(appSrc46) && /preview-below/.test(appSrc46)
        ? ok : fail)("【47】预览带方向判定（空间不足翻到下方）");
      (/onMouseEnter=\{\(event\) => decideDirection\(event\.currentTarget\)\}/.test(appSrc46)
        ? ok : fail)("【47】悬停时按实际几何决定方向（不是写死一个方向）");
      (/\.message-attach-chip\.preview-below \.message-attach-preview \{[\s\S]{0,200}?top: calc\(100% \+ 8px\);[\s\S]{0,80}?bottom: auto;/.test(css47)
        ? ok : fail)("【47】CSS 有「翻到下方」的对应变体（top 定位、bottom 复位）");
      // ⑦ 决定方向要取"最近裁剪容器"的上沿，不能拿视口/0 当界。
      // ⛔ 必须锚**那一行的实际表达式**：先前写成「文件里存在 getBoundingClientRect().top」
      //    是假绿（同函数里 `el.getBoundingClientRect().top` 就满足它，反证 ⑬ 因此没变红）。
      (/const limitTop = \(box \?\? document\.documentElement\)\.getBoundingClientRect\(\)\.top;/.test(appSrc46)
        ? ok : fail)("【47】方向判定以最近裁剪容器为界（不是 window 顶部 / 写死 0）");
      // ⑧ 指针点击后必须释放焦点：否则「点开大图 → Esc 关闭」后小预览会自己再冒出来
      //    （:focus-visible 命中；Esc 属键盘操作会把 Chromium 切到键盘焦点渲染模式）。
      //    判据要锚住 `detail > 0` 的条件与 blur() 调用，键盘激活（detail===0）必须保留焦点。
      (/if \(event\.detail > 0\) event\.currentTarget\.blur\(\);/.test(appSrc46)
        ? ok : fail)("【47】指针点击后释放焦点（Esc 关大图后小预览不会再冒出来）");
      (!/onClick=\{\(\) => \(image \? onOpenImage/.test(appSrc46)
        ? ok : fail)("【47】onClick 不再是一句话箭头函数（要拿 event 判断是否指针触发）");
    }

    console.log(C.bold("\n【48】输入框附件统一内联 chip + 粘贴长文本转 .txt + 文本编辑窗口"));
    {
      const att = await import("../../src/lib/composer-attachments.mjs");
      const {
        attachmentToken, imageToken, fileToken, splitAttachmentSegments,
        promptImagePaths, promptFilePaths, stripAttachmentTokens,
        PASTED_TEXT_TO_FILE_THRESHOLD, shouldSavePastedTextAsFile,
      } = att;
      const css48 = readStyles();
      const mainSrc = readMainSource();
      const preloadSrc = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
      const dtsSrc = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");
      const IMGP = "C:\\a\\b\\图.png";
      const TXTP = "D:\\work\\笔记 v2.txt";

      // ── ① token 格式：图片那份**必须与历史逐字节一致**（老消息里存着它）
      (imageToken(IMGP) === `[图片:${encodeURIComponent(IMGP)}]` ? ok : fail)("【48】图片 token 格式与历史一致（老消息仍能解析出图）");
      (fileToken(TXTP) === `[文件:${encodeURIComponent(TXTP)}]` ? ok : fail)("【48】文件 token 形如 [文件:path]");
      (attachmentToken("file", TXTP) === fileToken(TXTP) && attachmentToken("image", IMGP) === imageToken(IMGP) ? ok : fail)("【48】两种类型走同一个 attachmentToken");
      let threw = false;
      try { attachmentToken("video", "x"); } catch { threw = true; }
      (threw ? ok : fail)("【48】未知类型直接抛错（不静默产出坏 token）");

      // ── ② 消息渲染层只认图片：`[文件:…]` 必须**原样算文本**，不能被吞掉
      //    （吞掉 = 用户正文里凭空少一段，且没人报错）
      const mixed = `开头 ${imageToken(IMGP)} 中间 ${fileToken(TXTP)} 结尾`;
      const imgOnly = splitAttachmentSegments(mixed, { kinds: ["image"] });
      (imgOnly.some((s) => s.kind === "image") ? ok : fail)("【48】只认图片时仍能解析出图片段");
      (imgOnly.every((s) => s.kind !== "file") && imgOnly.map((s) => (s.kind === "text" ? s.text : "IMG")).join("").includes(fileToken(TXTP))
        ? ok : fail)("【48】`[文件:…]` 对消息渲染层原样保留为文本（不被吞掉）");
      const both = splitAttachmentSegments(mixed);
      (both.filter((s) => s.kind !== "text").map((s) => s.kind).join(",") === "image,file" ? ok : fail)("【48】两种都认时按出现顺序解析（image,file）");

      // ── ③ 路径提取与去重
      (promptFilePaths(`${fileToken(TXTP)} 和 ${fileToken(TXTP)}`).join("|") === TXTP ? ok : fail)("【48】文件路径去重且保序");
      (promptImagePaths(mixed).join("|") === IMGP ? ok : fail)("【48】图片路径提取与历史行为一致");

      // ── ④ 剥离：只剥文件时图片 token 必须留着（图片要靠它在正文里定位渲染）
      const stripped = stripAttachmentTokens(mixed, ["file"]);
      (stripped.includes(imageToken(IMGP)) && !stripped.includes(fileToken(TXTP)) ? ok : fail)("【48】只剥文件 token，图片 token 原样保留");
      (!stripAttachmentTokens(mixed, ["image"]).includes(imageToken(IMGP)) ? ok : fail)("【48】可只剥图片 token（历史行为）");
      (stripAttachmentTokens(`${fileToken(TXTP)}\n\n\n\n尾`, ["file"]) === "尾" ? ok : fail)("【48】剥完清理多余空行（不留一串空行）");

      // ── ⑤ 长文本转文件：阈值与判据
      (PASTED_TEXT_TO_FILE_THRESHOLD === 200 ? ok : fail)(`【48】阈值是 200 字（实得 ${PASTED_TEXT_TO_FILE_THRESHOLD}）`);
      (shouldSavePastedTextAsFile("x".repeat(201)) && !shouldSavePastedTextAsFile("x".repeat(200)) ? ok : fail)("【48】正好 200 字不转、201 字转（边界）");
      (!shouldSavePastedTextAsFile("   \n\t  ") && !shouldSavePastedTextAsFile("") && !shouldSavePastedTextAsFile(null) ? ok : fail)("【48】空白/空值不转文件（不生成空文件）");
      // ⛔ 必须带"**超过阈值的**空白串"这一例：只测短空白串时，按原文长度判定也能通过
      //    （7 个字本来就不到 200）——那样的断言区分不出 trim 有没有生效（09-18 反证 ④ 实测）。
      (!shouldSavePastedTextAsFile(" ".repeat(PASTED_TEXT_TO_FILE_THRESHOLD + 50)) ? ok : fail)("【48】超阈值的纯空白也不转文件（复制一大段空行不该生成文件）");
      (shouldSavePastedTextAsFile(`${"x".repeat(201)}   \n\n`) ? ok : fail)("【48】按 trim 后长度判定（尾随空白不改变结论）");

      // ── ⑥ 输入框：删掉上方 strip、文件状态改为"从文本派生"
      // ⛔ 匹配前必须剥注释：我在 App.tsx 里留了「原先那条 .attachment-strip 已删除」的说明，
      //    按原文匹配会把这行注释算成"strip 还在"（同一个坑第三次踩到，见 codeOnly 注释）。
      const appCode48 = codeOnly(appSrc46);
      (!/attachment-strip/.test(appCode48) ? ok : fail)("【48】输入框上方那条附件 strip 已删除（用户要求文件也进输入框）");
      (!/setFiles\(/.test(appCode48) ? ok : fail)("【48】composer 的 files 状态已移除（文件只以 [文件:path] 存在于文本）");
      (/const attachedFiles = useMemo\(\(\) => promptFilePaths\(prompt\), \[prompt\]\)/.test(appSrc46) ? ok : fail)("【48】文件列表由 prompt 文本派生（不会与文本不同步）");
      (!/\.attachment-strip|\.file-attachment/.test(css48) ? ok : fail)("【48】strip 的 CSS 已清除（不留复活入口）");
      (/if \(seg\.kind !== "text"\) \{ root\.appendChild\(makeChip\(seg\.kind, seg\.path\)\); continue; \}/.test(appSrc46)
        ? ok : fail)("【48】编辑器重建 DOM 时图片/文件都生成 chip");
      (/const kind = el\.getAttribute\("data-attach-kind"\);/.test(appSrc46) && /el\.getAttribute\("data-attach-path"\)/.test(appSrc46)
        ? ok : fail)("【48】序列化靠统一的 data-attach-kind/path 还原占位符（不再用 data-image-path）");
      (!/getAttribute\("data-image-path"\)/.test(appSrc46) ? ok : fail)("【48】旧的 data-image-path 引用已清干净（不留两套属性各认一半）");
      // 插入/删除 token 只允许一条路径：composer 走 insertComposerAttachments（插 chip），
      // 旧的「直接往文本框拼 token」两个函数已无调用点，09-18 已删 —— 别让它们回来。
      (!/export function insertImageToken|export function removeImageToken/.test(readFileSync(join(ROOT, "src", "lib", "prompt-images.ts"), "utf8"))
        ? ok : fail)("【48】已删除两个历史死代码（insertImageToken / removeImageToken 无调用点）");
      // 删 chip 要只吃掉"插入时补的那一个空格"：把两侧全吃或全不吃都会让正文少/多一个空格
      {
        const { removeAttachmentToken: rm } = await import("../../src/lib/composer-attachments.mjs");
        (rm(`看 readme ${fileToken(TXTP)} 很好`, "file", TXTP) === "看 readme 很好" ? ok : fail)("【48】删 chip 保留分词空格（不把两侧空格一起吃掉）");
        (rm(`前${fileToken(TXTP)}后`, "file", TXTP) === "前 后" ? ok : fail)("【48】删 chip 若两侧无空格则补一个（不把两个词粘成一个）");
      }

      // ── ⑦ 发送管线：文件 token → 既有 [附件文件] 段（模型侧协议不变），且从正文剥离
      (/const inlineFilePaths = promptFilePaths\(messageText\);/.test(appSrc46) ? ok : fail)("【48】发送前提取文件 token");
      (/if \(inlineFilePaths\.length\) messageText = stripAttachmentTokens\(messageText, \["file"\]\);/.test(appSrc46)
        ? ok : fail)("【48】文件 token 从正文剥离（不把 [文件:path] 当正文发给模型）");
      (appSrc46.includes("[附件文件]") && /inlineFilePaths\.map\(\(path\) => `- \$\{path\}`\)/.test(appSrc46)
        ? ok : fail)("【48】仍拼成 [附件文件] 段（引擎与渲染层解析的协议没变）");

      // ── ⑧ 粘贴长文本 → txt：三件套齐全 + 安全校验
      for (const [label, ch] of [["save", "pasted-text:save"], ["read", "pasted-text:read"], ["update", "pasted-text:update"]]) {
        (mainSrc.includes(`"${ch}"`) && preloadSrc.includes(`"${ch}"`) ? ok : fail)(`【48】${label} 通道 main + preload 都有（${ch}）`);
      }
      (/savePastedText\(text: string\): Promise<string \| null>;/.test(dtsSrc) && /readPastedText\(path: string\)/.test(dtsSrc) && /updatePastedText\(path: string, content: string\)/.test(dtsSrc)
        ? ok : fail)("【48】三个通道的类型声明齐全（渲染层才拿得到类型）");
      (/function isInsidePastedTextDir\(target: string\)/.test(mainSrc) && /只允许编辑应用自己保存的粘贴文本/.test(mainSrc)
        ? ok : fail)("【48】读/写做了目录内校验（否则等于给渲染层任意文件读写）");
      (/crypto\.createHash\("sha1"\)\.update\(content, "utf8"\)\.digest\("hex"\)\.slice\(0, 8\)/.test(mainSrc)
        ? ok : fail)("【48】文件名按内容哈希（同一段文本粘两次得到同一个文件）");
      (!/codex-harness-\$\{Date\.now\(\)\}\.txt/.test(mainSrc) ? ok : fail)("【48】不用时间戳命名（否则同一内容会堆出无限副本）");
      (/shouldSavePastedTextAsFile\(plain\)\) \{ onPasteLongText\(plain\); return; \}/.test(appSrc46)
        ? ok : fail)("【48】编辑器在「插入纯文本」之前先判长文本（否则超长文本照旧内联铺满输入框）");

      // ── ⑨ 文本编辑窗口：先问主进程再决定，且关窗即存
      (/const info = await window\.codex\.readPastedText\(target\);/.test(appSrc46) && /if \(info\?\.editable\) \{ setPastedText\(\{ path: target, name: basename\(target\) \}\); return; \}/.test(appSrc46)
        ? ok : fail)("【48】chip 点击先问主进程「是否可编辑」，再回退普通文件预览（不靠路径猜）");
      (!/pasted-text(?:\\\\|\/)/.test(appSrc46.replace(/pastedTextDir/g, "")) ? ok : fail)("【48】渲染层不靠路径前缀识别粘贴文本");
      // ⛔ 允许 `export ` 前缀：搬进 src/features/** 后声明行会变成 `export function …`，
      //    锚死 `^function` 会在搬家时假红（判据要盯"是不是模块级组件"，不盯有没有 export）。
      (/^(?:export\s+)?function PastedTextEditor\(/m.test(appSrc46) ? ok : fail)("【48】编辑器是模块级组件（内联箭头函数会每次 render 重挂）");
      (/if \(state\.editable && dirty\) \{ await save\(contentNow, \{ silent: true \}\); showToastEverywhere/.test(appSrc46)
        ? ok : fail)("【48】关窗自动保存（编辑的是应用自己的临时文本，丢改动比多存一次更糟；表格视图下取回写后的全文 contentNow）");
      (/\.pasted-text-body \{[\s\S]{0,420}?min-height: 0;/.test(css48)
        ? ok : fail)("【48】编辑区 min-height:0（flex 子项不收缩的话 textarea 会顶破面板）");
      (/\.pasted-text-modal \{[\s\S]{0,320}?z-index: 91;/.test(css48) ? ok : fail)("【48】文本窗口层级高于图片灯箱（不会被盖住）");

      // ── ⑩ 输入框自适应高度：有下限（够写）+ 有上限（不顶掉正文）+ 到顶内部滚动
      const editorCss = (css48.match(/\.composer-editor \{[\s\S]*?\n\}/) || [""])[0];
      (/min-height: \d+px/.test(editorCss) ? ok : fail)("【48】输入框有最小高度");
      (/max-height: min\([^)]+\)/.test(editorCss) ? ok : fail)("【48】输入框有高度上限");
      (/overflow-y: auto/.test(editorCss) ? ok : fail)("【48】到达上限后内部滚动（不会把上方正文顶出视野）");
    }
  }
}

// ── 49. 运行计时不能被「切会话重挂载」清零（09-18 用户：「切出去再切回来时间就重置了」） ──
{
  const { createRunClock } = await import("../../src/lib/run-clock.mjs");
  const T0 = 1_700_000_000_000;
  const clock = createRunClock({ maxEntries: 3 });

  // ① 行为断言：起点幂等 + 跨挂载接着走（重挂载 = 拿同一个起点再问一次）
  clock.elapsedSeconds("turn-a", T0);
  (clock.elapsedSeconds("turn-a", T0 + 8000) === 8 ? ok : fail)("【49】同一回合的计时接着走（8 秒后就是 8 秒，不从 0 重数）");
  (clock.elapsedSeconds("turn-a", T0 + 125000) === 125 ? ok : fail)("【49】跨分钟后仍接着走（125 秒，不回到个位数）");
  // 不同回合必须各自独立（否则两个会话的计时会互相串）
  (clock.elapsedSeconds("turn-b", T0 + 3000) === 0 ? ok : fail)("【49】不同回合各自独立计时（不共用起点）");
  // 时钟回拨/负值：不得显示成「正在处理 -5 秒」
  (clock.elapsedSeconds("turn-a", T0 - 5000) === 0 ? ok : fail)("【49】时钟回拨时夹到 0（不出现负数计时）");
  // 回合结束后清理：下一轮同 id（理论上不复用，但语义要自洽）从 0 开始
  clock.forget("turn-a");
  (clock.elapsedSeconds("turn-a", T0 + 999000) === 0 ? ok : fail)("【49】回合结束清理起点（下一轮不再复用老起点）");
  // 容量上限：溢出淘汰最久未用，防止「只跑不停的会话」把表撑大
  const cap = createRunClock({ maxEntries: 2 });
  cap.elapsedSeconds("a", T0); cap.elapsedSeconds("b", T0); cap.elapsedSeconds("c", T0);
  (cap.size === 2 && !cap.has("a") && cap.has("b") && cap.has("c") ? ok : fail)("【49】起点表有容量上限（超出淘汰最久未用，不无限增长）");
  // ⛔ 上一条**区分不出「有没有 LRU 提热度」**（插入顺序就是 a,b,c 时，淘汰 a 是无提热度也成立的结果）。
  //    真机意义很大：长期在跑的回合每秒都在取起点，若命中不提升热度，它会被后续新回合挤出表 →
  //    切回来又归零（本 bug 原地复活）。这条专测它。
  const lru = createRunClock({ maxEntries: 2 });
  lru.elapsedSeconds("x", T0); lru.elapsedSeconds("y", T0);
  lru.elapsedSeconds("x", T0 + 1000);   // 命中 x → 提到最新
  lru.elapsedSeconds("z", T0 + 2000);   // 超容量 → 该淘汰 y（不是 x）
  (lru.has("x") && !lru.has("y") && lru.has("z") ? ok : fail)("【49】正在跑的回合不会被新回合挤掉（取起点会提升热度）");
  // 没有 id 也不能崩（退化成「不记忆」，只保证当次正确）
  (typeof createRunClock().elapsedSeconds(null, T0) === "number" ? ok : fail)("【49】缺少回合 id 时不崩（退化为不记忆）");

  // ② 结构守卫：起点必须来自 RUN_CLOCK，不许退回组件内部状态（那正是本 bug 的成因）
  const appCode49 = codeOnly(readAppUi());
  (!/const startedRef = useRef\(Date\.now\(\)\)/.test(appCode49) ? ok : fail)("【49】计时起点不再存在组件内部（useRef(Date.now()) 已清除）");
  (/RUN_CLOCK\.elapsedSeconds\(turnId, now\)/.test(appCode49) ? ok : fail)("【49】计时条从按回合记忆的起点表取值");
  (/<RunningProcessTime turnId=\{turn\.id\} \/>/.test(appCode49) ? ok : fail)("【49】计时条拿到回合 id（否则记忆表无从索引）");
  (/if \(!running\) RUN_CLOCK\.forget\(turn\.id\);/.test(appCode49) ? ok : fail)("【49】回合结束时清掉起点（表不随历史回合堆积）");
  // 必须盯住"不是在 effect 的 cleanup 里清"：卸载时清理 = 切会话就把记忆丢了 = 本 bug 原地复活
  (!/return \(\) => \{[^}]*RUN_CLOCK\.forget/.test(appCode49) ? ok : fail)("【49】不是「卸载时清理」（切会话正要靠这条记忆跨过卸载）");
}

// ── 50. 附件段解析：文件名含方括号不得泄漏协议标记（09-18 用户截图实证） ──
{
  // user-refs.ts 是 TS，预检（纯 node ESM）不能直接 import ⇒ **从源码里取出真实正则**再跑。
  // 这样测的是仓库里那个正则本身，而不是抄一份到断言里（抄一份就会漂移，且抄错也照样绿）。
  const refsSrc = readFileSync(join(ROOT, "src", "lib", "user-refs.ts"), "utf8");
  const grabRe = (name) => {
    const m = refsSrc.match(new RegExp(`const ${name} = clean\\.match\\((/.*?/)\\);`));
    if (!m) return null;
    const body = m[1];
    const lastSlash = body.lastIndexOf("/");
    try {
      return new RegExp(body.slice(1, lastSlash), body.slice(lastSlash + 1));
    } catch {
      return null;
    }
  };
  const fileSeg = grabRe("fileMatch");
  const skillSeg = grabRe("skillMatch");
  const ctxSeg = grabRe("ctxMatch");
  (fileSeg && skillSeg && ctxSeg ? ok : fail)("【50】能从 user-refs.ts 取出三处段解析正则（取不到说明写法变了，下面的断言会失效）");

  if (fileSeg) {
    const parseAttach = (text) => {
      const files = [];
      const m = text.match(fileSeg);
      let clean = text;
      if (m) {
        for (const line of m[1].split(/\r?\n/)) {
          const mm = line.match(/^-\s+(.+)$/);
          if (mm) files.push(mm[1].trim());
        }
        clean = text.replace(m[0], "");
      }
      return { files, clean: clean.replace(/\n{3,}/g, "\n\n").trim() };
    };
    const leak = (raw) => {
      const r = parseAttach(raw);
      return { leaked: /\[附件结束\]|\[附件文件\]/.test(r.clean), ...r };
    };

    // ⛔ 用户截图的原始场景：文件名含方括号 → 旧正则在行中间就把段截断，
    //    残留 ".png" 与 "[附件结束]" 被当成用户正文显示。
    const b = leak("看下图片\n\n[附件文件]\n- D:\\素材\\_a_曦_2026年9月6日_初评图片_1.jpg\n- D:\\素材\\22 钛光金 [最终版].png\n[附件结束]\n");
    (b.leaked ? fail : ok)("【50】文件名含方括号不再泄漏协议标记（用户截图场景）");
    (b.files.length === 2 && b.files[1] === "D:\\素材\\22 钛光金 [最终版].png" ? ok : fail)(`【50】含方括号的文件名完整解析（实得 ${b.files.length} 个：${b.files.join(" | ")}）`);

    const c = leak("看下图片\n\n[附件文件]\n- D:\\素材\\图[1].jpg\n- D:\\素材\\b.png\n[附件结束]\n");
    (c.leaked || c.files.length !== 2 ? fail : ok)("【50】路径里的方括号目录（素材[1]）同样不破坏解析");

    // ⛔ CRLF 回归防线：本轮把结束标记改成「整行」后，\n 写死会让 CRLF 消息里最后一行的 \r
    //    留在行尾 → 行正则失配 → **文件数变 0**（我第一版就是这样，靠这条断言才没漏出去）。
    const d = leak("看下图片\r\n\r\n[附件文件]\r\n- D:\\素材\\22 钛光金 [最终版].png\r\n[附件结束]\r\n");
    (!d.leaked && d.files.length === 1 ? ok : fail)(`【50】CRLF 行尾的消息也能解析出文件（实得 ${d.files.length} 个）`);

    const e = leak("看下图片\n\n[附件文件]\n- D:\\素材\\a.png\n");
    (!e.leaked && e.files.length === 1 ? ok : fail)("【50】没有结束标记的残缺段仍能解析出已列出的文件");

    const f = leak("看下图片\n\n[附件文件]\n- D:\\素材\\b [2].png\n[附件结束]\n\n后面这句是我的正文");
    (!f.leaked && f.clean.includes("后面这句是我的正文") ? ok : fail)("【50】段后的用户正文完整保留（不误吞）");
  }

  // 结构守卫：三处都必须要求「整行」结束标记（`\r?\n\[`），不许再有裸 `\[[^\]]+\]` 分支
  // ⛔ 取「整行」时记得带上行尾的 `;`：写成 `.*$\)` 会因为末尾还剩一个 `;` 而匹配失败
  //    （`.*` 回溯到 `)` 后 `$` 不是行尾）→ 列表恒空 → 后两条断言假红（本轮实测）。
  const segRegExes = (refsSrc.match(/^.*const (?:fileMatch|skillMatch|ctxMatch) = clean\.match\(\/.*$/gm) || []);
  (segRegExes.length === 3 ? ok : fail)(`【50】三处段解析正则都在（实得 ${segRegExes.length} 处）`);
  const looseEnd = segRegExes.filter((l) => /\(\?:\\\[\[\^\\\]\]\+\\\]\|\$\)/.test(l)).length;
  (looseEnd === 0 ? ok : fail)(`【50】三处段解析都不再用「行中任意方括号」当结束标记（实得 ${looseEnd} 处旧写法）`);
  const lineAnchored = segRegExes.filter((l) => /\(\?:\\r\?\\n\\\[/.test(l)).length;
  (lineAnchored === 3 ? ok : fail)(`【50】三处结束标记都要求整行 + 兼容 CRLF（实得 ${lineAnchored}/3）`);

  // ── 停止后：过程保持展开 + 标记落在最新内容之后 ──
  const appSrc50 = readAppUi();
  const appCode50 = codeOnly(appSrc50);
  const css50 = readStyles();
  (/\{userStopped && \(/.test(appCode50) ? ok : fail)("【50】有「用户已停止」标记");
  // 判据：interruptedAt 只由本机 interrupt() 写入，用它区分"用户点的停止"
  (/const userStopped = Boolean\(interruptedAt\)/.test(appCode50) ? ok : fail)("【50】用 interruptedAt 区分「用户点的停止」（语音/手机端/引擎中止不算）");
  (/!running && !stoppedWithoutReply && !userStopped && stopReason\.label/.test(appCode50) ? ok : fail)("【50】用户点的停止不再同时弹顶部通用中断提示（避免同屏两处说停止）");
  (/keepProcessOpen=\{userStopped\}/.test(appCode50) ? ok : fail)("【50】停止的回合把过程组摊开（keepProcessOpen 接上了）");
  // ⛔ 必须数「≥2 处」：TurnFoldStream 有两条完成态渲染分支（planCompletedFold 分段 / 通用 segments），
  //    只改一处的话另一条路径照样折着 —— 而"只查存在一处"的写法对这种情况恒绿（反证时实测到）。
  {
    const n = (appCode50.match(/defaultOpen=\{keepProcessOpen\}/g) || []).length;
    (n >= 2 ? ok : fail)(`【50】两条完成态渲染分支都用了 defaultOpen（实得 ${n} 处，需 ≥2）`);
  }
  (/\{stoppedWithoutReply &&/.test(appCode50) ? ok : fail)("【50】「未开始回复就停止」的既有提示保留（零产出场景仍要说清）");
  // ⛔ 防重复文案：标记里不许再报耗时（过程组标题已经写了「已停止 · 耗时 X」）
  {
    const at = appCode50.indexOf("{userStopped && (");
    const marker = at >= 0 ? appCode50.slice(at, appCode50.indexOf("{turnFinished && finalAgent", at)) : "";
    (!/elapsedSeconds|已处理\s*\$\{|耗时/.test(marker) ? ok : fail)("【50】停止标记不重复耗时（耗时由过程组标题负责，同一屏只说一次）");
    // 顺序：内容 → 标记 → 操作栏
    const foldIdx = appCode50.indexOf("<TurnFoldStream items={foldItems}");
    const noticeIdx = appCode50.indexOf("{userStopped && (");
    const footerIdx = appCode50.indexOf("{turnFinished && finalAgent");
    (foldIdx > 0 && noticeIdx > foldIdx && footerIdx > noticeIdx ? ok : fail)("【50】标记落在「最新内容之后、操作栏之前」（用户明确要求的位置）");
  }
  (/\.turn-user-stopped \{[\s\S]{0,400}?display: flex;/.test(css50) ? ok : fail)("【50】停止标记有样式（不是裸文本）");
}

// ── 51. 钉顶稳定性（09-18 用户：「切换会话切回来钉顶就没了」「短回复没铺满也自动取消钉顶」） ──
{
  const appSrc51 = readAppUi();
  const appCode51 = codeOnly(appSrc51);

  // ① 「thread?.id 一变就清留白」的 passive effect 必须不存在 ——
  //    它与 useLayoutEffect 里的 pinSentMessage 抢同一份留白（layout 先跑、passive 后跑），
  //    结果「刚撑起来就被清成 0」→ 锚点滚不到落点 → 切回来钉顶掉下来。
  (!/useEffect\(\(\) => \{\r?\n\s*clearAnchorPad\(\);\r?\n\s*\}, \[thread\?\.id, clearAnchorPad\]\)/.test(appCode51)
    ? ok : fail)("【51】没有「thread.id 一变就清留白」的 passive effect（它会覆盖 layout effect 刚撑好的留白）");

  // ② 归属变化必须被当作 first（切回来要重算留白 + 立即落位）
  (/const ownerChanged = Boolean\(owner\) && pinThreadIdRef\.current !== owner;/.test(appCode51)
    ? ok : fail)("【51】归属变化被当作 first 处理（切回来会重算留白并立即落位）");
  (/const first = pinnedAnchorKeyRef\.current !== key \|\| returned \|\| ownerChanged;/.test(appCode51)
    ? ok : fail)("【51】first 判据包含归属变化");

  // ③ 归属只能被真实 id 写入（空值不许覆盖）——
  //    乐观阶段传进来的 thread?.id 还是 null，旧写法会把归属写成 null → 跟随的入口条件
  //    `pinThreadIdRef.current === myThreadId` 恒不成立 → 钉顶期间一次都不跟随。
  (/const owner = threadId \|\| pinThreadIdRef\.current \|\| null;/.test(appCode51)
    ? ok : fail)("【51】归属不被空 threadId 覆盖（否则长消息发送后自动跟随失效）");
  (!/pinThreadIdRef\.current = threadId \?\? null;/.test(appCode51)
    ? ok : fail)("【51】没有残留「归属 = threadId ?? null」的旧写法");

  // ④ ⛔ 09-20 用户定稿「运行中的话就钉顶，运行完成就不要钉」：**回合结束即脱钉** ——
  //    解除锚定（anchorTopRef=false）+ 留白归零 + 贴底回到内容末尾（下方不留空白）。
  //    旧口径（09-18「钉顶仍生效就保留」）的代价是完成后下方残留一大片空白（09-20 中午截图），
  //    已按用户新口径废弃 —— 留白量 N 与「滚到底时内容底部到视口底部的距离」严格 1:1，
  //    留着 N 就有 N 的空白，用户选了「不要空白」。
  (/if \(params\.threadId === threadRef\.current\?\.id\) \{[\s\S]{0,200}?anchorTopRef\.current = false;/.test(appCode51)
    ? ok : fail)("【51】回合结束即脱钉（09-20 用户定稿：运行中钉顶、运行完成不钉）");
  (!/&& !anchorTopRef\.current\) clearAnchorPad\(\);/.test(appCode51)
    ? ok : fail)("【51】没有残留「只在钉顶已失效时清留白」的旧口径（那会在完成后留下大片空白）");

  // ⑤ 自动跟随三要素（09-20 用户回头确认「最新消息自动跟随还在不，这个没丢吧」）——
  //    跟随只在**运行中（钉顶期）**生效，回合结束脱钉后自然停止，所以它必须与钉顶口径同存亡。
  (/const FOLLOW_STEP_PX = 48;/.test(appCode51) ? ok : fail)(
    "【51】自动跟随步长常量在（48px：攒约两行再整体跟一次，逐帧跟会与换行重排抢）"
  );
  (/const pinMine = anchorTopRef\.current && \(pinThreadIdRef\.current === null \|\| pinThreadIdRef\.current === myThreadId\);/.test(appCode51)
    ? ok : fail)("【51】跟随入口接受「归属未知 = 自己」（否则刚发送那一小段完全不跟随）");
  (/if \(followDist > -FOLLOW_STEP_PX\) \{/.test(appCode51) ? ok : fail)(
    "【51】跟随入口 = followDist > -48（交棒前 bodyDist / 交棒后全量 dist，短回复不被推）");
  (/scrollToOffsetInstant\(scroller, scroller\.scrollTop \+ followDist\);/.test(appCode51) ? ok : fail)(
    "【51】跟随补滚动量 = followDist（把内容底补到视口底，不整体推）");

  // ⑧ 钉顶交棒只看**正文**（09-26 用户定稿：思考板块撑满一屏不许取消钉顶）——
  //    旧判据用全量内容底，思考卡一流式就把 overflow 撑正 → 提前交棒（钉顶没了）；
  //    思考折叠后 pin-fix 又把消息拉回落点（又钉上去）= 用户看到的来回翻。
  //    判据锚**接线**：helper 存在 + 两个消费方（交棒 / 跟随）都改用它，缺一边 = 半死状态。
  (/const bodyBottomOf = useCallback\(\(el: HTMLElement\) => \{/.test(appCode51) ? ok : fail)(
    "【51】bodyBottomOf（正文底 = 内容底 − 展开中的思考卡高）在 pin-scroll-anchor 定义"
  );
  (/const overflow = bodyBottomOf\(el\) - el\.scrollTop - el\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】pinSentMessage 交棒判据用正文底（思考板块不取消钉顶，09-26）"
  );
  (/const bodyDist = bodyBottomOf\(scroller\) - scroller\.scrollTop - scroller\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】钉顶跟随分支的判据与交棒同源（都走 bodyBottomOf，缺一边 = 半死状态）"
  );
  (!/const overflow = contentBottomOf\(el\) - el\.scrollTop - el\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】交棒判据不许退回全量内容底（那就是「思考一输出钉顶就没」本身）"
  );
  (/setAwayFromBottom\(!anchorTopRef\.current && dist >/.test(appCode51) ? ok : fail)(
    "【51】钉顶期间「回到底部」按钮不得出现（它的 onClick 会解除钉顶 = 思考从侧门取消钉顶）"
  );

  // ⑤ 侧栏会话行带 data-thread-id：验收脚本按 id 切换才可靠
  //    （按标题找会因列表重排/标题变化而"找不到会话行" → 观测无效，本轮就是这么白跑一轮的）
  (/data-thread-id=\{entry\.id\}/.test(appCode51) ? ok : fail)("【51】会话行带 data-thread-id（验收按 id 切换，不靠标题）");

  // ⑥ 「归属未知」不得被当成「属于别的会话」——这是「长内容发送后不自动跟随」的**真根因**：
  //    乐观阶段归属还是 null，旧判据 `pinThreadIdRef.current !== thread?.id` 把它当外人 ⇒
  //    跳过 pinSentMessage ⇒ 归属永远补不上 ⇒ 跟随入口恒不成立（真机实测 top 恒为 0、
  //    内容底部停在视口外 34px 且一动不动）。
  (/const pinOwnerUnknown = anchorTopRef\.current && pinThreadIdRef\.current === null;/.test(appCode51)
    ? ok : fail)("【51】归属未知不算休眠（否则钉顶归属永远补不上、跟随永不启动）");
  (/const pinDormant = anchorTopRef\.current && !pinOwnerUnknown && pinThreadIdRef\.current !== thread\?\.id;/.test(appCode51)
    ? ok : fail)("【51】pinDormant 判据排除「归属未知」");
  // ⑦ 跟随入口同样把 null 当自己（多一层保险）
  (/const pinMine = anchorTopRef\.current && \(pinThreadIdRef\.current === null \|\| pinThreadIdRef\.current === myThreadId\);/.test(appCode51)
    ? ok : fail)("【51】跟随入口接受「归属未知 = 自己」（anchorTopRef 只在本会话发送时置真）");
}

// ── 52. 重启闸门：非崩溃的引擎重启不得打断用户正在跑的任务（09-19 用户：「又莫名其妙断了」） ──
{
  const srv = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const main = readMainSource();
  const pre = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
  const appSrc52 = readAppUi();
  const viteEnv = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");

  // ① 闸门本体：restart 默认不在忙时真重启
  (/async restart\(opts: \{ reason\?: string; force\?: boolean \} = \{\}\)/.test(srv)
    ? ok : fail)("【52】restart 接受 reason/force 参数（可区分「谁触发的」与「必须立刻」）");
  (/if \(busy && !opts\.force\) \{/.test(srv) ? ok : fail)("【52】忙时默认推迟（不打断在跑的任务）");
  (/this\.deferredRestart = \{ reason \};/.test(srv) ? ok : fail)("【52】推迟的请求被记下来（等空闲补做）");
  (/async flushDeferredRestart\(\)/.test(srv) ? ok : fail)("【52】有空闲后补做推迟重启的入口");
  (/setBusyGate\(fn: \(\) => number\)/.test(srv)
    ? ok : fail)("【52】可注入「有几个回合在跑」的判定（返回数量，不返回布尔 —— 台账要能看出真实计数）");
  (/activeTurnCount\(\) \{/.test(srv) ? ok : fail)("【52】对外暴露活跃回合数（验收探针 + 台账共用）");

  // ② 两条"必须立刻"的路径 —— 漏了这两处 force，闸门会变成"永远不重启"（比打断更糟）
  (/restart\(\{ force: true, reason: "engine-exited" \}\)/.test(srv)
    ? ok : fail)("【52】引擎已退出时 force 重启（否则等不到空闲 = 永不恢复）");
  (/restart\(\{ force: true, reason: "heartbeat-timeout" \}\)/.test(srv)
    ? ok : fail)("【52】心跳卡死时 force 重启（卡死时不会有 turn/completed，等下去等于不恢复）");

  // ③ 主进程接线：用引擎侧真实记账做判定（不依赖渲染层上报）
  (/server\.setBusyGate\(\(\) => engineActiveTurnIds\.size\)/.test(main)
    ? ok : fail)("【52】主进程注入真实记账（engineActiveTurnIds）作为判定");
  (/if \(engineActiveTurnIds\.size === 0\) void server\.flushDeferredRestart\(\)/.test(main)
    ? ok : fail)("【52】最后一个回合结束时补做推迟的重启（否则配置永不生效）");
  // ⛔ 记账必须是 Map（turnId → threadId）：用裸 Set 时「A 会话跑完」会把 B 会话的记录一起清掉
  //    → 闸门误判为空闲 → 直接打断 B（比不修还糟）。这条是 09-19 设计审计抓出来的。
  (/const engineActiveTurnIds = new Map<string, string>\(\);/.test(main)
    ? ok : fail)("【52】记账用 Map 而不是 Set（否则一个会话结束会误清掉别的会话）");
  // ⛔ 记账必须宽容：只认 `params.turn.id` 会漏掉 `turnId` 形态的引擎版本 → 记账恒空 →
  //    闸门形同虚设（09-19 首轮验收就是 busy=false 假成立，靠 activeTurns 探针才发现）。
  (/params\?\.turn\?\.id \?\? params\?\.turnId \?\? params\?\.id/.test(main)
    ? ok : fail)("【52】回合 id 三种形态都收（否则闸门拿不到真实计数）");
  (/METHOD === "thread\/status\/changed"/.test(main) && /st === "idle" \|\| st === "notLoaded"/.test(main)
    ? ok : fail)("【52】线程变空闲时释放**该线程**的记账（引擎侧权威信号，防记账泄漏卡死闸门）");
  (/ipcMain\.handle\("engine:active-turns"/.test(main) && /engineActiveTurns: \(\) => __ipc\("engine:active-turns",/.test(pre)
    ? ok : fail)("【52】有「活跃回合数」探针（验收必须确认前置成立，否则测的是「不忙时当然不推迟」）");

  // ④ 安装目录漂移自愈（09-19 用户：「还有没有绝对路径的，通通查出来解决掉」）
  (/const envPathStale = Boolean\(expectedFirst\)/.test(main)
    ? ok : fail)("【52】config.toml 的 PATH 会与当前安装目录比对（搬家后自愈）");
  (/envPathStale \|\| instructionsOutdated/.test(main) ? ok : fail)("【52】PATH 漂移被纳入自愈触发条件");

  // ④ 台账 + 通知（诊断"是谁打断的" + 告诉用户"改动待生效"）
  (/ipcMain\.handle\("engine:restart-log"/.test(main) ? ok : fail)("【52】有重启台账 IPC（下次再断能查到是谁触发的）");
  (/engineRestartLog: \(\) => __ipc\("engine:restart-log",/.test(pre) ? ok : fail)("【52】preload 暴露台账");
  (/engineRestartLog\(\): Promise</.test(viteEnv) ? ok : fail)("【52】台账有类型声明（IPC 三件套同步）");
  (/onEngineRestartDeferred:/.test(pre) && /onEngineRestartDeferred\(listener/.test(viteEnv)
    ? ok : fail)("【52】重启被推迟/补做的通知通道三件套齐全");
  (/onEngineRestartDeferred\?\.\(\(event\) => \{/.test(appSrc52) && /改动已保存，将在当前任务结束后生效/.test(appSrc52)
    ? ok : fail)("【52】渲染层明确提示「改动已保存、任务结束后生效」（否则用户以为没保存成功）");

  // ⑤ 钉顶：留白收缩后的**可达性守卫** + 排队消息的钉顶意图（09-19 用户实测「钉顶也没有」）
  const appSrc53 = readAppUi();
  // ⛔ 真机打点复现：留白收缩过头后，落点变成"滚不到的地方"，scrollTop 被 maxScroll 钳死，
  //    pin-fix 每次都滚到同一个被钳住的位置、err 一路变大（21→59→100→253），消息停在半屏。
  //    ⇒ 收缩必须检查「要滚到的位置是否超过 maxScroll」，超了就把缺口还给留白。
  (/if \(want > max \+ 1\) \{/.test(appSrc53) ? ok : fail)("【53】留白收缩后检查落点是否可达（否则被 maxScroll 钳死）");
  (/anchorPadAppliedRef\.current = restore;/.test(appSrc53) && /dbg\("pad-restore"/.test(appSrc53)
    ? ok : fail)("【53】落点不可达时把缺口**还给留白**（不是只打点）");
  // ⛔ 运行中发的消息走 thread/queue/add，随后的「回合结束自动启动 / 立即」两条释放路径
  //    原先都不建立钉顶意图 → 那条消息落进内容流（实测 pad≈0、消息停在半屏）。
  const queueArmCalls = (appSrc53.match(/armPinForReleasedQueue\(/g) || []).length;
  (queueArmCalls >= 4 ? ok : fail)(`【53】排队释放的三条路径都建立钉顶意图（定义+3 处调用，实测 ${queueArmCalls}）`);
  (/"auto-start"/.test(appSrc53) && /"steer"/.test(appSrc53) && /"queue-start"/.test(appSrc53)
    ? ok : fail)("【53】自动启动 / 立即插队 / 立即开新回合 都覆盖");
  // 只对**正在看的**会话建立意图：给后台会话设了会抢走视口
  (/threadId !== threadRef\.current\?\.id\) return;/.test(appSrc53)
    ? ok : fail)("【53】只对当前可见会话建立钉顶意图（后台会话不抢视口）");
  // ⛔ 释放失败必须**撤回**意图（代码审查抓出的缺口）：否则意图悬空，钉顶会去钉列表里
  //    最后那个回合组的消息 ⇒ 视口莫名跳到旧消息，比"没钉顶"更糟。
  const disarmCalls = (appSrc53.match(/disarmPinIntent\(/g) || []).length;
  (disarmCalls >= 4 ? ok : fail)(`【53】释放失败时撤回钉顶意图（定义+3 处调用，实测 ${disarmCalls}）`);
  (/dbg\("queue-arm-cancelled"/.test(appSrc53) ? ok : fail)("【53】撤回有打点（下次能看出是「建立后撤回」还是「压根没建立」）");

  // ⑤b 用户手动停止 ⇒ 排队消息不得被自动发送；**排队本身原地不动**（留在输入框上方那张卡里）。
  //     口径来源：用户 09-23 先要求「不应被自动发送，应保留」，随后**更正**：「不是停留到输入框里面，
  //     是停留在输入框上面；要是排队好几个消息怎么办，要保持排队消息、停留在输入框上面」
  //     ⇒ 第一版做的「把排队消息从引擎队列摘走并拼进输入框」是**错的**（多条会糊成一条草稿），已删除。
  //     ⛔ 唯一拦截点 = `turn/completed` 的「自动启动下一条排队消息」。真机实测：被**中断**的回合结束时
  //     引擎**不会**自己释放队列（排队卡里那条 12.5s 后仍在、且没被当用户消息发出）⇒ 不需要动队列。
  {
    const stopAt = appSrc53.indexOf("async function interrupt()");
    const stopBody = stopAt >= 0 ? appSrc53.slice(stopAt, stopAt + 4000) : "";
    const flagSet = stopBody.indexOf("manualStopRef.current.set(");
    // ⛔ 判据取「第一个**真实** await」而不是字符串 "await "：注释正文里也会出现这个词，
    //    用它当位标会把注释当成代码（第一版就这么假红了一次）。
    const firstAwait = stopBody.indexOf('await window.codex.request("turn/interrupt"');
    (flagSet >= 0 && firstAwait >= 0 && flagSet < firstAwait ? ok : fail)(
      "【115】「手动停止」旗标在**第一个 await（turn/interrupt）之前**同步写入（回合结束事件可能先于 interrupt 回包到达）"
    );
    // ⛔ 负面断言：interrupt() 里**不许**再出现「摘队列 / 写回输入框」——那是被用户否掉的口径。
    (!/thread\/queue\/delete/.test(stopBody) && !/setPrompt\(/.test(stopBody) && !/pullQueuedToComposer/.test(stopBody)
      ? ok : fail)(
      "【115】停止时**不动排队消息**（不摘引擎队列、不写回输入框）——排队卡原地保留，用户自己决定立即/编辑/删除"
    );
    (/"manual-stop-no-autostart"/.test(appSrc53) && /if \(wasManualStop\) \{/.test(appSrc53) ? ok : fail)(
      "【115】turn/completed 的「自动启动排队消息」被手动停止短路（这是**唯一**拦截点）"
    );
    // 拦手动停止，但**不能把自动启动整段删掉**：正常回合结束仍必须照旧释放队列
    (/if \(wasManualStop\) \{[\s\S]{0,260}\} else \{/.test(appSrc53) && /"auto-start"/.test(appSrc53) ? ok : fail)(
      "【115】短路只加在手动停止这一支：正常回合结束照旧自动启动（`else` 分支 + `auto-start` 意图仍在）"
    );
    // ⛔ 09-24 用户反馈（截图）：「排队消息出去，正常的，为啥报这个错」——
    //   实测事实：上一回合结束后约 9ms 引擎就**自己启动**排队消息并清空队列 ⇒ 宿主这次
    //   `thread/queue/start` 落在其后，引擎回 `queued submission not found: <id>`。消息其实正常发出，
    //   报错纯属噪声。这类「已经被启动 / 已不在队列」的失败必须按**成功**处理（不弹 toast、
    //   **保留**钉顶意图），判据集中在 lib/queue-errors.mjs（三处入口共用，别各写一份正则）。
    const queueErrLib = existsSync(join(ROOT, "src", "lib", "queue-errors.mjs"))
      ? readFileSync(join(ROOT, "src", "lib", "queue-errors.mjs"), "utf8") : "";
    (/queued submission not found/.test(queueErrLib) ? ok : fail)(
      "【115】队列「伪失败」判据库在（lib/queue-errors.mjs 认 queued submission not found / queue is empty）"
    );
    const queueErrUses = (appSrc53.match(/isQueueAlreadyStartedError\(/g) || []).length;
    (queueErrUses >= 3 ? ok : fail)(
      `【115】三处 queue/start 的失败分支都过「已被引擎启动」判据（自动启动 / 自动续接 / 立即；实测 ${queueErrUses} 处）`
    );
    (!/showToast\("队列启动失败", error\.message\)/.test(appSrc53) ? ok : fail)(
      "【115】不许再把「已被引擎启动」当失败弹原始错误（原实现直接 showToast(error.message)）"
    );
    // ⛔ 判据**跑真代码**的真值表（不是字符串断言）：宽了会把真失败吞掉，窄了噪声又回来。
    (isQueueAlreadyStartedError("Error: queued submission not found: 01a0d2cd-a4b1-7771-a00f-abbb0e6594f0")
      && isQueueAlreadyStartedError("queue is empty")
      && isQueueAlreadyStartedError("no such queued submission")
      && !isQueueAlreadyStartedError("no active turn to steer")
      && !isQueueAlreadyStartedError("thread not found")
      && !isQueueAlreadyStartedError("")
      && !isQueueAlreadyStartedError(undefined) ? ok : fail)(
      "【115】「已启动」判据真值表：命中 queued submission not found / queue is empty，放行 no active turn / thread not found / 空值"
    );
    (/isTruncatedEmptyTurn\(localTurn \?\? params\.turn\) && !wasManualStop/.test(appSrc53) ? ok : fail)(
      "【115】手动停止的回合不做「截断空转自动续接」（否则停止后 2.5s 会再自动发一条并启动新回合）"
    );
    (/manualStopTurnId && manualStopTurnId === String\(params\.turn\?\.id \?\? ""\)/.test(appSrc53) ? ok : fail)(
      "【115】手动停止按 turnId 精确比对（只对这一次生效，别的回合正常结束照旧自动启动）"
    );
    // 旧方案不许复活：整个应用代码里不应再有「把排队消息摘回输入框」的实现
    (!/pullQueuedToComposer/.test(appSrc53) ? ok : fail)(
      "【115】旧的「摘回输入框」方案已彻底移除（多条排队会糊成一条草稿，用户 09-23 明确否掉）"
    );
  }

  // ⑥ contextWindow 单一真相源（09-19 用户实测：custom-model.json 该模型写 1M、custom-models.json
  //    同一供应商顶层写 128000 —— 两个字段表达同一件事却由两个来源写，每次新建供应商都会留下一对打架的数字）
  const mainWin = readMainSource();
  const withModelsAt = mainWin.indexOf("function withModels(");
  const withModelsBody = withModelsAt >= 0 ? mainWin.slice(withModelsAt, withModelsAt + 1600) : "";
  (/const effectiveWindow = result\.model/.test(withModelsBody) ? ok : fail)(
    "【54】供应商顶层 contextWindow 在唯一写入点归一为「生效模型自己的值」（否则两处数字打架）"
  );
  (/contextWindow: effectiveWindow/.test(withModelsBody) ? ok : fail)("【54】归一结果真的写回顶层（不是只算了个变量）");
  ((mainWin.match(/contextWindow: effectiveWindow/g) || []).length === 1
    ? ok : fail)("【54】归一只有一个 owner（写在 withModels 里，不散在各调用点）");
  // 模型编辑器必须说清「哪个才是生效上限」，否则用户看到一个数字、文件里另一个
  (/才是\*\*生效上限\*\*/.test(appSrc53) ? ok : fail)("【54】模型编辑器标明「本模型的值才是生效上限」（顶层只是默认值）");

  // ⑦ 会话绝对独立（09-19 用户：「不准再因为切换会话、别的独立弹窗关闭影响正在运行的会话，
  //    每个会话都是绝对独立运行状态……除了用户停止，不许再断」）
  //    三条硬约束：① 渲染层**不许**用快照熄灭运行态；② 引擎侧 idle 必须核实后再熄灭；
  //    ③ 主进程 `turn/start` 有"该会话仍有活动回合就拒绝"的兜底（引擎侧事实，不依赖渲染层状态）。
  const appSrc55 = readAppUi();
  const srvSrc55 = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const mainSrc55 = readMainSource();
  (!/else markThreadStopped\(id\);/.test(appSrc55) ? ok : fail)(
    "【55】渲染层不再用「快照里没有 running 回合」熄灭运行态（否则切会话会把在跑的会话判死）"
  );
  (!/else markThreadStopped\(params\.threadId\);/.test(appSrc55) ? ok : fail)(
    "【55】thread/status/changed 的 idle 不再无条件熄灭运行态"
  );
  (/else if \(statusType === "idle"\)[\s\S]{0,400}engineActiveTurns\(\)/.test(appSrc55) ? ok : fail)(
    "【55】idle 改为与引擎侧记账核实后再熄灭"
  );
  (/method0 === "turn\/aborted"/.test(appSrc55) ? ok : fail)(
    "【55】渲染层处理 turn/aborted|failed|interrupted（否则被中断的回合转圈永远挂着）"
  );
  (/if \(method === "turn\/start"\)[\s\S]{0,700}\[\.\.\.engineActiveTurnIds\.values\(\)\]\.includes\(guardThreadId\)/.test(mainSrc55)
    ? ok : fail)("【55】主进程兜底：该会话仍有活动回合时拒绝 turn/start（成对引擎侧事实，防打断）");
  (/setEngineSpawnHook\(/.test(srvSrc55) && /this\.onEngineSpawned\?\.\(\)/.test(srvSrc55) ? ok : fail)(
    "【55】引擎进程重建即回调（主进程据此作废失效回合记账）"
  );
  (/server\.setEngineSpawnHook\(\(\) => \{[\s\S]{0,400}engineActiveTurnIds\.clear\(\)/.test(mainSrc55) ? ok : fail)(
    "【55】主进程在引擎重建时清记账（否则闸门/安全网永久卡住：改配置永不生效、消息发不出去）"
  );

  // ⑧ 会话「项目地址」改动必须真落到侧栏（09-19 用户实测：「在已创建会话上改了地址，只是对话框上面
  //    显示改了，左侧栏没有变化，新增的项目地址也不出现 —— 这个切换项目地址功能这样看就是假的」）
  const appSrc56 = readAppUi();
  (/setThreads\(\(current\) => current\.map\(\(entry\) => entry\.id === target\.id \? \{ \.\.\.entry, cwd: value \}/.test(appSrc56)
    ? ok : fail)("【56】改项目地址会同步列表条目（侧栏项目分组是按 entry.cwd 派的，不同步=侧栏不变）");
  (/thread-cwd-override-v1/.test(appSrc56) && /rememberThreadCwd\(/.test(appSrc56) ? ok : fail)(
    "【56】改过的地址落本地覆盖（引擎 thread/list 回包的 cwd 是创建时那个，不覆盖下一次刷新就顶回去）"
  );
  ((appSrc56.match(/withCwdOverride\(entry\)/g) || []).length >= 2 ? ok : fail)(
    "【56】每条会话列表刷新路径都贴本地覆盖（漏一条就等于改了个寂寞）"
  );
  (/projectAutoExpandRef/.test(appSrc56) ? ok : fail)(
    "【56】启动首次拿到项目分组时自动展开当前会话所在项目（用户实测「要手动展开」）"
  );
  (/setWorkspace\(effectiveCwd\(id, result\.cwd\)\)/.test(appSrc56) ? ok : fail)(
    "【56】打开会话时顶栏显示的是覆盖后的地址（与侧栏保持一致）"
  );
  // ⑨ 语气自适应（09-19 用户要求「agent 有状态、语气跟着变」）：
  //    底线 = **每个会话绝对独立**（09-19 铁律）——状态按会话各自一份，注入走会话自己的 instructions。
  const appSrc57 = readAppUi();
  // ⛔ 判据必须落在**代码**上：注释掉调用仍需报红（否则「// bumpMood(...)」照样匹配正则 = 假绿）。
  //    这里只剔「整行 // 注释」，**不用 codeOnly**——它会把成对的 /* */ 也剥掉，
  //    App.tsx 里只要有一处不配对就会吞掉后面的代码，让下面的守卫变成假红。
  const appSrc57Code = appSrc57.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
  (/"agent-mood-" \+ threadId/.test(appSrc57Code) ? ok : fail)(
    "【57】状态键按会话拼（含 threadId）—— 全局单份会让 A 会话的心情改到 B 会话的语气"
  );
  (!/localStorage\.setItem\("agent-mood"/.test(appSrc57Code) ? ok : fail)(
    "【57】不存在不带 threadId 的全局状态写入（全局单份 = 会话互相污染）"
  );
  const sigLine57 = appSrc57Code.split(/\r?\n/).find((l) => /signature:/.test(l) && /sessionScopeSignature\(values\)/.test(l)) || "";
  (/moodSignature\(readMood\(threadId\)\)/.test(sigLine57) ? ok : fail)(
    "【57】下发签名含语气档（漏了 = 状态变了也不重新下发，功能看着像没生效）"
  );
  (/composeMoodInstructions\(composeScopeInstructions\(base, sessionScopeBlock\(values\)\)/.test(appSrc57Code) ? ok : fail)(
    "【57】语气块随会话作用域一起下发（同一通道 = 天然按会话隔离）"
  );
  (/bumpMood\(params\.threadId, "turn-ok"\)/.test(appSrc57Code) ? ok : fail)("【57】回合顺利收尾记「向好」");
  (/bumpMood\(params\.threadId, "turn-fail"\)/.test(appSrc57Code) ? ok : fail)("【57】失败/中断/被中止记「转差」");
  (/bumpMood\(threadRef\.current\.id, userSig\)/.test(appSrc57Code) ? ok : fail)("【57】用户语气信号（被夸/被催）也进状态");
  const forgetCalls57 = (appSrc57Code.match(/forgetThreadMood\(/g) || []).length;
  (forgetCalls57 >= 4 ? ok : fail)(`【57】删除会话时级联清状态与签名（定义+3 处调用，实测 ${forgetCalls57}）`);
  (/adaptiveToneRef\.current = next;/.test(appSrc57Code) ? ok : fail)(
    "【57】开关用 ref 镜像（onHarnessEvent 的闭包读不到新 state，直接读 state 会永远读到初值）"
  );

  // 纯函数断言：直接跑 agent-mood.mjs 的真实现
  {
    const wild = normalizeMood({ valence: 99, energy: -5, rapport: 42, turns: -3 });
    (wild.valence === 1 && wild.energy === 0.05 && wild.rapport === 1 && wild.turns === 0 ? ok : fail)(
      "【57】坏值/越界一律归一（有界，不漂）"
    );
    // 从高水平起连败：valence 触底后下降量会变 0（那是下界在起作用，不是惩罚变小）
    let s57 = { ...emptyMood(), valence: 0.9, energy: 0.9 };
    const pen57 = [];
    for (let i = 0; i < 7; i++) { const before = s57.valence; s57 = applyMoodSignal(s57, "turn-fail", 1000); pen57.push(Number((before - s57.valence).toFixed(4))); }
    (pen57[0] === 0.12 && pen57[1] === 0.15 && pen57[6] === 0.3 ? ok : fail)(
      `【57】连败惩罚递增且封顶 0.30（实测 ${pen57.join("/")}）`
    );
    (applyMoodSignal({ ...emptyMood(), valence: -0.95 }, "turn-fail", 1000).valence >= -1 ? ok : fail)(
      "【57】惩罚不把心情推过下界（有界，不会越挫越负到无意义）"
    );
    let w57 = emptyMood();
    for (let i = 0; i < 50; i++) w57 = applyMoodSignal(w57, "turn-ok", 1000);
    (w57.valence > 0 && w57.valence <= 1 && w57.energy <= 1 && w57.rapport <= 1 ? ok : fail)(
      `【57】连续成功收敛到正侧且不越界（实测 valence=${w57.valence.toFixed(3)}）`
    );
    const bad57 = applyMoodSignal(applyMoodSignal(emptyMood(), "turn-fail", 1000), "turn-fail", 1000);
    const later57 = decayMood(bad57, 1000 + 3 * 60 * 60 * 1000);
    (Math.abs(later57.valence) < Math.abs(bad57.valence) ? ok : fail)(
      `【57】空闲衰减把状态拉回基线（${bad57.valence.toFixed(3)} → ${later57.valence.toFixed(3)}）`
    );
    (moodTone({ valence: 0, energy: 0.1 }).key === "terse" ? ok : fail)("【57】精力见底 → 极简档");
    (moodTone({ valence: -0.5, energy: 0.6 }).key === "sober" ? ok : fail)("【57】心情偏低 → 收紧档");
    (moodTone({ valence: 0.6, energy: 0.8 }).key === "brisk" ? ok : fail)("【57】心情好+精力足 → 轻快档");
    (moodTone({ valence: 0, energy: 0.5 }).key === "steady" ? ok : fail)("【57】默认平稳档");
    const blk57 = moodBlock(applyMoodSignal(emptyMood(), "turn-ok", 1000), 1000);
    (blk57.includes(MOOD_HEADING) && /\*\*只影响说法/.test(blk57) && /不要在回复里谈论这个状态/.test(blk57) ? ok : fail)(
      "【57】注入块写明「只影响说法」并禁止谈论状态（否则会出现「我现在心情不错」这类噪音）"
    );
    const a1 = moodSignature({ valence: 0.1, energy: 0.5, rapport: 0.1, updatedAt: 1 });
    const a2 = moodSignature({ valence: 0.2, energy: 0.6, rapport: 0.2, updatedAt: 2 });
    (a1 === a2 && a1 !== "" ? ok : fail)(`【57】签名不含浮点（同档同签名，实测 ${a1} vs ${a2}）`);
    // 模拟「上一次下发过的完整文本又被当基线传进来」：块只能出现一次（翻倍 = 每轮重发越拼越长）
    const twice57 = composeMoodInstructions(composeMoodInstructions("BASE", blk57), blk57);
    ((twice57.match(/会话状态（语气自适应/g) || []).length === 1 ? ok : fail)("【57】组合/剥离幂等（反复重发不会越拼越长）");
    let mA = emptyMood();
    let mB = emptyMood();
    for (let i = 0; i < 3; i++) mA = applyMoodSignal(mA, "turn-fail", 1000);   // A 连败三次
    mB = applyMoodSignal(mB, "turn-ok", 1000);
    (moodTone(mA).key === "sober" && moodTone(mB).key !== "sober" ? ok : fail)(
      `【57】两会话各自演进语气不同（A=${moodTone(mA).key} / B=${moodTone(mB).key}）`
    );
    (moodSignature(mB) === moodSignature(applyMoodSignal(emptyMood(), "turn-ok", 1000)) ? ok : fail)(
      "【57】A 的连败没有改到 B 的状态（同一份输入跑出同一份结果，证明确实各存各的）"
    );
  }


  // ⑩ 浏览器专用技能 browser-skill（09-19 用户：「browser skill 内置到已安装技能里面，专门跑浏览器自动化」
  //    → 随后「这个更好，那个替换掉」：改用 browser-skill 替换 browser-automation）
  //    要点：① 随应用写入 codexHome/skills/（内置=代码为准，启动时按内容覆盖）
  //          ② 内容必须覆盖**真实存在**的命令（照 help 写）且替换后**不丢能力说明**
  //             （通道选型 / CloakBrowser 是从旧技能并过来的，删旧技能不能把它们一起删掉）
  //          ③ 旧技能必须退役清理 —— 内建写入只增不删，不清的话老用户磁盘上那份会继续被加载
  //          ④ 仍受「浏览器自动化」总闸管（名单 = BROWSER_SKILL_IDS）
  const bsSrc58 = readBuiltinSkillsSource();
  (/\["browser-skill", BROWSER_SKILL\]/.test(bsSrc58) ? ok : fail)(
    "【58】browser-skill 已注册进内置技能（随应用启动写入 codexHome/skills/）"
  );
  (!/\["browser-automation", BROWSER_SKILL\]/.test(bsSrc58) ? ok : fail)(
    "【58】旧技能不再被写入（browser-automation 已退役，否则两套浏览器说明同时加载）"
  );
  (/name: browser-skill[\r\n]/.test(bsSrc58) ? ok : fail)(
    "【58】技能 frontmatter 的 name 与目录名一致（browser-skill，否则引擎按名字索引不到）"
  );
  // 命令必须照 playwright-cli --help 写（写错模型就照着错命令试）
  const bsCmds58 = ["snapshot", "find <text>", "requests", "response-body", "console [min-level]", "state-save", "state-load", "kill-all", "tab-list", "--raw", "eval <func>"];
  const bsMiss58 = bsCmds58.filter((k) => !bsSrc58.includes(k));
  (bsMiss58.length === 0 ? ok : fail)(`【58】技能覆盖真实实操命令（缺：${bsMiss58.join("、") || "无"}）`);
  // 替换后不能丢能力说明：通道选型表 + CloakBrowser 段（原本在旧技能里）
  const bsMerge58 = ["通道选型", "内置浏览器面板", "CLOAKBROWSER_ENTRY", "cloakbrowser install"];
  const bsLost58 = bsMerge58.filter((k) => !bsSrc58.includes(k));
  (bsLost58.length === 0 ? ok : fail)(
    `【58】替换后能力说明未丢失（缺：${bsLost58.join("、") || "无"}）`
  );
  // 退役清理：指纹比对 + 兼容 .disabled（被总闸禁用过的旧技能也要能清）
  (/const RETIRED_SKILLS: \[string, string\]\[\] = \[\["browser-automation", RETIRED_BROWSER_SKILL\]\]/.test(bsSrc58) ? ok : fail)(
    "【58】旧技能进了退役名单（否则老用户磁盘上那份永远留着）"
  );
  (/"SKILL\.md", "SKILL\.md\.disabled"/.test(bsSrc58) ? ok : fail)(
    "【58】退役清理想到了 .disabled 形态（被总闸禁用过的旧技能不会被漏掉）"
  );
  // ⛔ 判据锚「两边都归一化行尾」这个不变量本身，不锚具体语句形态（语句会被重构，不变量不会）
  (/existing\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bsSrc58) && /original\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bsSrc58) ? ok : fail)(
    "【58】退役清理归一化行尾后比对指纹（否则被停用/启用重写成 LF 的旧技能永远清不掉）"
  );
  const cgSrc58 = readFileSync(join(ROOT, "src", "lib", "capability-groups.ts"), "utf8");
  (/BROWSER_SKILL_ID = "browser-skill"/.test(cgSrc58) ? ok : fail)(
    "【58】总闸管的是新技能名（还指着旧名 = 关总闸关不到真正的技能）"
  );
  (/BROWSER_SKILL_IDS: readonly string\[\] = \[BROWSER_SKILL_ID\]/.test(cgSrc58) ? ok : fail)(
    "【58】技能名单与主技能名一致（名单里留着已退役的名字 = 状态永远对不上）"
  );
  const appSrc58b = readAppUi();
  (/findCapabilitySkills\(localSkills as any\[\], BROWSER_SKILL_IDS\)/.test(appSrc58b) ? ok : fail)(
    "【58】渲染层按名单聚合技能状态（总闸显示才不会与实际状态脱节）"
  );
  (/browserSkills: findCapabilitySkills\(skills, BROWSER_SKILL_IDS\)/.test(appSrc58b) ? ok : fail)(
    "【58】联动后复算也走同一份名单"
  );
}

{
  // ── 【59】回合「输出被上游截断」的检测 + 自动续接（09-19 用户实测「思考内容过长会被截断，
  //    运行状态就断了」；真机取证：商汤把单次响应钳到 8192，思考 16365 字符吃满预算 → 正文 0
  //    字符 → 引擎当 task_complete 正常收尾。本地部署模型同样有单次输出上限）。──
  //    核心不变量：① 检测是纯函数、可被断言 ② 应用对思考/输出**不做任何限制** ③ 检测到截断
  //    要自动续接（承接语义，从断点续写）④ 防死循环有窗口/次数上限 ⑤ 不把正常回合误判成截断。
  const ttSrc59 = readFileSync(join(ROOT, "src", "lib", "turn-truncation.mjs"), "utf8");
  const appSrc59 = readAppUi();

  // —— 行为断言（跑真实实现，覆盖「正常回合不误报」这个最关键的不变量）——
  const t59 = { items: [
    { type: "userMessage", id: "u1" },
    { type: "reasoning", id: "r1", summary: [{ text: "x".repeat(2000) }], content: [{ text: "y".repeat(15000) }] }, // 思考极长（≈16.4K 字符）
    { type: "agentMessage", id: "a1", text: "" }, // 正文空
    // 无任何工具 item
  ]};
  const t59ok = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "完整的一段回答，不止一句话。".repeat(200) }, // 有正文
  ]};
  const t59tool = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "" },
    { type: "functionCallOutput", id: "f1", name: "exec_command", output: "ok" }, // 有工具动作
  ]};
  const t59short = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "短思考" }] },
    { type: "agentMessage", id: "a1", text: "" },
  ]};
  // ⛔ 用户提醒「不要让正常收尾产生空转」的关键区间：思考很长 + **短结论**（20~300 字符之间，
  //   比如"好的，按方案 A 做"）+ 无工具 —— 这是正常收尾，绝不能误判成截断（否则自动续接
  //   会多出一个应用自己发的回合 = 空转）。20 阈值下短结论(>20)不判；放宽到 300 必误判 → 反证红。
  const t59shortReply = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "z".repeat(9000) }] }, // 思考长
    { type: "agentMessage", id: "a1", text: "好的，按方案 A 来，我这就去处理，完成后立刻把结果发给你看。" }, // 正常短结论（>20 且 <300，20 阈值下不误判）
  ]};
  // ⛔ 真实形态（rollout 实证）：引擎在截断时把思考摘要**逐字复制**成 agentMessage 当正文
  //   （task_complete 的 last_agent_message 就是它）——「正文非空」不等于「有产出」。
  const t59echo = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "s".repeat(9000) }], content: [] }, // 思考长
    { type: "agentMessage", id: "a1", text: "s".repeat(9000) }, // 正文 = 思考复述（逐字相同）
  ]};
  const t59real = { items: [
    { type: "reasoning", id: "r1", summary: [{ text: "s".repeat(9000) }], content: [] }, // 思考长
    { type: "agentMessage", id: "a1", text: "这是真正的产出正文，不是思考的复述。".repeat(100) }, // 真实正文 ≠ 思考
  ]};
  (isTruncatedEmptyTurn(t59) ? ok : fail)("【59】截断空转（长思考+空正文+无工具）判真");
  (isTruncatedEmptyTurn(t59echo) ? ok : fail)("【59】正文=思考逐字复述 判真（引擎截断时把思考摘要复制成正文，复述≠产出）");
  (isTruncatedEmptyTurn(t59real) ? fail : ok)("【59】正文是真实产出（≠思考）不误判");
  (isTruncatedEmptyTurn(t59ok) ? fail : ok)("【59】有正文的正常回合不误判");
  (isTruncatedEmptyTurn(t59tool) ? fail : ok)("【59】有工具动作的回合不误判");
  (isTruncatedEmptyTurn(t59short) ? fail : ok)("【59】思考不长的空回合不误判");
  (isTruncatedEmptyTurn(t59shortReply) ? fail : ok)("【59】长思考+正常短结论的回合不误判（防正常收尾被当成截断 → 空转）");
  const s59 = turnOutputStats(t59);
  (s59.reasoningChars >= TRUNCATE_REASONING_MIN_CHARS && s59.outputChars < TRUNCATE_OUTPUT_MAX_CHARS && s59.toolItems === 0 ? ok : fail)(
    `【59】统计口径正确（思考=${s59.reasoningChars} / 正文=${s59.outputChars} / 工具=${s59.toolItems}）`
  );

  // —— 结构不变量 ——
  (AUTO_CONTINUE_MAX_ATTEMPTS >= 1 && AUTO_CONTINUE_MAX_ATTEMPTS <= 3 ? ok : fail)(
    `【59】自动续接次数上限合理（${AUTO_CONTINUE_MAX_ATTEMPTS}，防死循环）`
  );
  (/AUTO_CONTINUE_WINDOW_MS/.test(appSrc59) && /autoContinueLogRef/.test(appSrc59) ? ok : fail)(
    "【59】自动续接有防循环记账（窗口+次数，否则思考→截断→又思考烧钱）"
  );
  (/maybeAutoContinueTruncated\(/.test(appSrc59) ? ok : fail)(
    "【59】回合收尾时对截断空转触发自动续接"
  );
  (/thread\/queue\/add/.test(appSrc59) && /thread\/queue\/start/.test(appSrc59) ? ok : fail)(
    "【59】自动续接走队列入队+启动（新回合带全新输出预算）"
  );
  (/从上次中断处继续/.test(ttSrc59) && /不要重新思考/.test(ttSrc59) ? ok : fail)(
    "【59】续接指令是「承接续写」语义（从断点往下写，不是重做任务）"
  );
  (/应用没有对思考或输出做任何限制|应用未做任何限制/.test(ttSrc59) ? ok : fail)(
    "【59】说明里讲清应用未做限制（用户明确要求长思考不受限）"
  );
  (/\bslice\(0,\s*\d{1,4}\s*\)/.test(ttSrc59) ? fail : ok)(
    "【59】检测模块对思考/输出正文不做长度截断（应用不限制输出）"
  );
}

{
  // ── 【60】侧栏「任务完成」绿点 + 通知真实会话名（09-19 用户：「通知栏总显示未命名会话」
  //    +「会话完成，左侧栏没有反馈效果……点击进去绿点消失」）──
  const appSrc60 = readAppUi();
  const css60 = readStyles();
  // 通知名：fallback 必须传空串（内部 fallback「未命名会话」恒非空 ⇒ 后面的 firstUserTextInTurn
  // 永远执行不到 = 通知永远「未命名会话」的真根因）
  (/cleanThreadDisplayTitle\(entry\?\.name,\s*\{\s*preview:\s*entry\?\.preview,\s*fallback:\s*""\s*\}\)/.test(appSrc60) ? ok : fail)(
    "【60】通知名的会话标题 fallback 传空串（否则内部「未命名会话」恒非空，真实名字永远轮不到）"
  );
  // 绿点状态机
  // ⛔ 点亮必须在**跨会话生命周期区**（method0 分支）：下面的当前会话事件流有 threadId 过滤
  //   （`params.threadId !== threadRef.current?.id → return`），后台会话事件走不到 —— 第一版
  //   把点亮挂在那边，真机验收当场红（绿点永不出现）。
  (/if \(!params\.threadId \|\| params\.threadId !== threadRef\.current\?\.id\) markThreadDoneUnread\(params\.threadId\);\s*\n\s*\} else if \(method0 === "thread\/status\/changed"\)/.test(appSrc60) ? ok : fail)(
    "【60】turn/completed（跨会话区）对后台会话点亮完成绿点（挂在当前会话事件流 = 永不出现）"
  );
  (/markThreadStopped\(params\.threadId\);\s*\n\s*\/\/ 侧栏绿点（失败[^]*?if \(!params\.threadId \|\| params\.threadId !== threadRef\.current\?\.id\) markThreadDoneUnread\(params\.threadId\);/.test(appSrc60) ? ok : fail)(
    "【60】turn/aborted|failed|interrupted 也点亮绿点（失败也算运行结束）"
  );
  (/if\s*\(!threadId\s*\|\|\s*threadId === threadRef\.current\?\.id\)\s*return;/.test(appSrc60) ? ok : fail)(
    "【60】当前正在查看的会话不点绿点（用户全程看着，不需要反馈）"
  );
  (/clearThreadDoneUnread\(entry\.id\)/.test(appSrc60) ? ok : fail)(
    "【60】点击侧栏会话行即清除绿点（用户明令：点进去消失）"
  );
  (/unreadDoneIds\.has\(entry\.id\)\s*\?\s*<span className="thread-done-dot"/.test(appSrc60) ? ok : fail)(
    "【60】侧栏行渲染绿点（running 优先，完成后未读才亮）"
  );
  (/\.thread-done-dot\s*\{/.test(css60) && /#22c55e/.test(css60) ? ok : fail)(
    "【60】绿点样式存在（绿色 = 成功收尾）"
  );
}

{
  // ── 【62】两条真机复现过的回归守卫（09-19 用户截图/复现）──
  //  ① 「发出去立马切走 → 绿点 → 30 秒内切回 → agent 回复没了」
  //     根因：后台会话的回复内容不落缓存（落缓存都在 threadId 过滤之后）+ openThread 有
  //     「30 秒内跳过 resume」快速路径 ⇒ 缓存没回复且不 resume = 永久缺失。
  //     修法：把「完成的回合落缓存」提到跨会话区（过滤之前）。
  //  ② 「消息回完了，右下角停止键还亮着」
  //     根因之一：迟到的 turn/started 会把已结束的回合重新点亮，而结束事件已消费 ⇒ 无人熄灭。
  //     修法：已结束回合 id 登记 + turn/started 不再点亮它们。
  //  ⛔ 本块刻意**不用 codeOnly**：实测 codeOnly 在本文件上会吃掉 ~177KB 代码
  //    （`/\*[\s\S]*?\*\//g` 被字符串/正则里的 `/*` 误配对，把中间大段代码当块注释剥掉），
  //    导致这里的断言被静默剥空 → 假红（第一版就是这样红的）。锚点本身已足够具体。
  const app62 = readAppUi();
  // ① 跨会话落缓存（turn/completed 与 aborted/failed 两处）
  // ⛔ 合并必须**以「缓存里已有该回合」为前提**：否则 mergeTurn 会把只有产出条目的回合
  //   追加成「没有用户消息的孤儿回复」（用户实测：一个用户消息下挂两条回复 / 回复重复）。
  //   缓存缺这一轮时改登记 needsFullReloadRef，让 openThread 必须 resume 拿完整回合。
  (/const hasTurn = Boolean\(cachedBg\?\.turns\?\.some\(\(turn\) => turn\.id === params\.turn\.id\)\);[\s\S]{0,260}?if \(cachedBg && hasTurn\) \{[\s\S]{0,260}?mergeTurn\(cachedBg, params\.turn\)[\s\S]{0,420}?needsFullReloadRef\.current\.add\(tidBg\);/.test(app62) ? ok : fail)(
    "【62】只在缓存已有该回合时合并；缺轮则登记完整重载（杜绝孤儿回复）"
  );
  (/const hasTurnFail = Boolean\(cachedFail\?\.turns\?\.some\(\(turn\) => turn\.id === params\.turn\.id\)\);[\s\S]{0,260}?mergeTurn\(cachedFail, params\.turn\)[\s\S]{0,420}?needsFullReloadRef\.current\.add\(tidFail\);/.test(app62) ? ok : fail)(
    "【62】失败/被中断分支同样只在缓存已有该回合时合并"
  );
  (/needsFullReloadRef = useRef<Set<string>>\(new Set\(\)\)/.test(app62) ? ok : fail)(
    "【62】「必须完整重载」登记表存在"
  );
  (/&& !needsFullReloadRef\.current\.has\(id\) && Date\.now\(\) - \(recentResumeAtRef\.current\.get\(id\) \?\? 0\) < 30_000\)/.test(app62) ? ok : fail)(
    "【62】「跳过 resume」快速路径让开必须重载的会话"
  );
  (/needsFullReloadRef\.current\.delete\(id\);/.test(app62) ? ok : fail)(
    "【62】resume 完成后清除「必须重载」标记"
  );
  // 落缓存只写 cache：合并语句里不得出现 setThread（视图仍归当前会话那两条链路）
  (/if \(mergedBg && mergedBg !== cachedBg\) threadCacheRef\.current\.set\(tidBg, mergedBg\);/.test(app62) ? ok : fail)(
    "【62】跨会话合并只写缓存、不直改视图"
  );
  // ② 已结束回合不得再被 turn/started 点亮
  (/const finishedTurnIdsRef = useRef<Set<string>>\(new Set\(\)\)/.test(app62) ? ok : fail)(
    "【62】已结束回合登记表存在"
  );
  (/rememberFinishedTurn\(startedTurnId\);/.test(app62) && /rememberFinishedTurn\(String\(params\.turn\?\.id \?\? params\.turnId \?\? ""\)\);/.test(app62) ? ok : fail)(
    "【62】completed 与 aborted/failed 都登记已结束回合"
  );
  (/if \(!startedAlreadyDone\) markThreadRunning\(params\.threadId, startedTurnId \|\| undefined\);/.test(app62) ? ok : fail)(
    "【62】跨会话 turn/started 不点亮已结束的回合"
  );
  // ⛔ 09-22：分支体提成 `handleXxx` 后，原来的 `return;`（退出 onEvent 回调）改成
  //    `return true;` + 调用处 `if (handleXxx(...)) return;` ⇒ 正则要同时接受两种写法，
  //    判据语义不变（仍是「已结束回合要提前退出，不点亮」）。
  (/if \(postStartTurnId && finishedTurnIdsRef\.current\.has\(postStartTurnId\)\) \{[\s\S]{0,60}?return(?: true)?;/.test(app62) ? ok : fail)(
    "【62】当前会话 turn/started 不点亮已结束的回合（否则停止键永久亮着）"
  );
}

{
  // ── 【63】429 自动重试必须**按会话独立**（09-19 用户实测：「多会话同时跑，只有当前看的
  //   那个会话会自动重试，后台会话直接断——会话完全没有完全独立」）──
  //   旧实现三处单槽（retryContextRef / rateLimitAttemptRef / rateLimitTimerRef）+ 429 检测点
  //   写在当前会话事件流里（threadId 过滤之后）⇒ 后台会话连排重试都走不到。
  const app63 = readAppUi();
  // ① 三份状态都必须是 per-thread Map
  (/const retryContextsRef = useRef<Map<string, RateLimitCtx>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试上下文按会话独立（Map，不再是单槽）"
  );
  (/const rateLimitAttemptsRef = useRef<Map<string, number>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试次数按会话独立（Map）"
  );
  (/const rateLimitTimersRef = useRef<Map<string, number>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试定时器按会话独立（Map，多会话可同时等待）"
  );
  // ② 旧单槽 API 不得复活
  const legacy = [/retryContextRef\.current(?!s)/, /rateLimitAttemptRef\.current/, /rateLimitTimerRef\.current/].filter((re) => re.test(app63)).length;
  (legacy === 0 ? ok : fail)(
    `【63】旧单槽 API 已清干净（残留 ${legacy} 处；复活=多会话互相覆盖）`
  );
  // ⛔ 09-22：分支体提成 `handleXxx` 后，「跨会话区」的判定不能只看区间内的字面代码 ——
  //    区间里现在只有 `if (handleEventRouter3(bag, event, params)) return;` 这样的**调用**。
  //    改为：区间文本 **+ 该区间调用的每个 handler 模块正文** 一起判定（语义不变：
  //    「429 重试 / engine error 通知 必须能从跨会话区到达」，而不是被 threadId 过滤挡在后面）。
  const FILTER63 = "if (params.threadId && params.threadId !== threadRef.current?.id) return;";
  const walkAllParts = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walkAllParts(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const partsFiles63 = walkAllParts(join(ROOT, "src", "features", "app-state", "parts"));
  const cross63 = (() => {
    for (const p of partsFiles63) {
      const raw = readFileSync(p, "utf8").replace(/\bbag\./g, "");
      const b = raw.indexOf(FILTER63);
      if (b < 0) continue;
      const a = raw.indexOf("── 跨会话生命周期事件");
      return raw.slice(a >= 0 ? a : 0, b);
    }
    return "";
  })();
  const handlerBodies63 = (() => {
    const out = new Map();
    for (const p of partsFiles63) {
      const raw = readFileSync(p, "utf8").replace(/\bbag\./g, "");
      const hits = [...raw.matchAll(/export function (handle[A-Za-z0-9_]+)\s*\(/g)];
      for (let i = 0; i < hits.length; i++) {
        out.set(hits[i][1], raw.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : raw.length));
      }
    }
    return out;
  })();
  let crossWithHandlers63 = cross63;
  for (const m of cross63.matchAll(/\b(handle[A-Za-z0-9_]+)\s*\(/g)) {
    const b = handlerBodies63.get(m[1]);
    if (b) crossWithHandlers63 += "\n" + b;
  }
  (/scheduleRateLimitRetry\(params\.threadId, \(rateLimitAttemptsRef\.current\.get\(params\.threadId\) \?\? 0\) \+ 1\);/.test(crossWithHandlers63) ? ok : fail)(
    "【63】429 排重试在跨会话区（后台会话也能重试；写回过滤之后 = 后台永远不重试）"
  );
  (crossWithHandlers63.includes('method0 === "error"') ? ok : fail)(
    "【63】engine error 通知（429 常见形态）同样在跨会话区处理"
  );
  // ④ 重试发起串行化：**按会话分门**（同一会话不并发投递），跨会话不排队。
  //    ⛔⛔ 09-19 用户严令「每个会话必须完全独立，A 在跑/报错/重试跟 B 一点关系都没有」：
  //    这里**必须**是 per-thread 的 Map，**不许**退回全局单门 —— 全局门会让 B 的重试
  //    排队等 A 发完，正是"会话之间还串着"的根源。
  (/const retryGatesRef = useRef<Map<string, Promise<unknown>>>\(new Map\(\)\)/.test(app63) ? ok : fail)(
    "【63】重试发起串行化按会话分门（跨会话不排队、互不等待）"
  );
  (/retryGatesRef\.current\.set\(threadId, guarded\)/.test(app63) ? ok : fail)(
    "【63】串行门按 threadId 写入（同一个会话才排队）"
  );
  (/if \(retryGatesRef\.current\.get\(threadId\) === guarded\) retryGatesRef\.current\.delete\(threadId\)/.test(app63) ? ok : fail)(
    "【63】串行门用后即清（不在 Map 里无限累积）"
  );
  (!/\bretryGateRef\b(?!s)/.test(app63) ? ok : fail)(
    "【63】已无全局单门 retryGateRef（会话完全独立的结构保证）"
  );
  (/const delay = Math\.round\(base \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\);/.test(app63) ? ok : fail)(
    "【63】退避叠 ±20% 抖动（避免多会话同一秒重发）"
  );
  // ⑤ 手动发消息只清**当前会话**的重试（清全部=后台会话直接断）
  (/const focusedForSend = threadRef\.current\?\.id;\s*\n\s*if \(focusedForSend\) cancelRateLimitRetry\(focusedForSend, true\);/.test(app63) ? ok : fail)(
    "【63】手动发送只取消当前会话的重试（不清别的会话）"
  );
  // 权限取法：**按目标会话取 + 白名单**（架构审查发现裸传 localStorage 脏值会被引擎拒收）
  (/sandboxPolicy: sandboxPolicy\(threadSandboxOf\(threadId\) \?\? sandbox, threadCacheRef\.current\.get\(threadId\)\?\.cwd/.test(app63) ? ok : fail)(
    "【63】重试的沙箱目录 + 权限模式都按目标会话取（配置层面不串会话）"
  );
  (/approvalPolicy: threadApprovalOf\(threadId\) \?\? approvalPolicy/.test(app63) ? ok : fail)(
    "【63】重试的审批策略同样按目标会话取"
  );
  (/sandboxPolicy: sandboxPolicy\(threadSandboxOf\(ctx\.threadId\) \?\? sandbox, threadCacheRef\.current\.get\(ctx\.threadId\)\?\.cwd/.test(app63) ? ok : fail)(
    "【63】降档重发的沙箱/权限也按目标会话取"
  );
  // 白名单本体：非法/脏值必须被挡（`?? 当前 UI 值` 的兜底不能省）
  (/const SANDBOX_MODES = \["danger-full-access", "read-only", "workspace-write"\] as const;/.test(app63) ? ok : fail)(
    "【63】会话权限读取有白名单（脏值不传给引擎）"
  );
  (/const APPROVAL_MODES = \["never", "on-request", "untrusted"\] as const;/.test(app63) ? ok : fail)(
    "【63】审批档位白名单存在"
  );
}

{
  // ── 【64】首次安装不得默认启用任何供应商（09-19 用户：「没配置供应商的时候默认不要启用任何
  //   供应商，要不然会跟新配置的供应商同时启用」）──
  //   两处根因：① 保存新供应商时 enabled 无条件默认 true（没填密钥也启用）；
  //            ② 推荐卡（PPtoken 赞助位）默认启用（没记录 = 开）。
  const mainSrc64 = readMainSource();
  const appSrc64 = readAppUi();
  // ① 无密钥的第三方供应商不得报成启用（openai-official 例外：它靠登录凭据）
  //   ⛔ 09-19 补第二个例外：本机/内网自建服务（Ollama/LM Studio/vLLM/llama.cpp）本来就
  //      不需要 Key —— 若也一律禁用，用户配好本地模型却发不出消息且看不出原因。
  //      判据改锚「公网无 Key 仍禁用」这个**不变的意图**，而不是原来的整行字面。
  (/const keylessThirdParty = !hasKey && value\.provider !== "openai-official" && !isLocalEndpoint\(value\.baseUrl\);[\s\S]{0,120}?enabled: keylessThirdParty \? false : value\.enabled !== false/.test(mainSrc64) ? ok : fail)(
    "【64】未配置密钥的供应商不得视为启用（官方订阅 + 本机/内网服务两处例外）"
  );
  /* ⛔ 判据改成「两个代码形态**各自锚定**」，不再用固定字符窗口把两句串起来。
     历史：窗口 220 → 600（09-19 插了并发归一那几行）→ 09-25 又插了几行注释 + 常量替换，
     实测距离 877 ⇒ 红。**这是判据写法的问题，不是代码的问题** —— 固定窗口的跨语句断言
     会随"中间合法地多写一行"而假红，而每次假红都诱人把 N 调大，调到最后等于没约束。
     两句用**同名唯一变量** `keylessThirdPartySave` 绑定，强度不变（该名在文件里唯一）、
     且与中间写了多少行无关。 */
  (/const keylessThirdPartySave = !encryptedKey && provider !== "openai-official" && !isLocalEndpoint\(baseUrl\);/.test(mainSrc64) &&
   /enabled: keylessThirdPartySave \? false : \(input\.enabled \?\? existing\?\.enabled \?\? true\)/.test(mainSrc64) ? ok : fail)(
    "【64】保存新供应商：没填密钥就存成禁用（本机/内网服务例外，与显示侧同源）"
  );
  // ② 推荐卡默认关（只有显式点开过才启用）
  (/localStorage\.getItem\("pptoken-card-off"\) !== "0"/.test(appSrc64) ? ok : fail)(
    "【64】推荐卡默认不启用（首次安装没有任何供应商处于启用态）"
  );
}

{
  // ── 【65】429 兜底重试必须**任何路径都能接住**（09-19 用户截图「429 重试机制都没有了？
  //   直接中止了？」）── 真机（mock 供应商 429）实测出三个致命点：
  //   ① 引擎把限流包成 `Reconnecting... 10/10`（**文案里没有 429**）⇒ 旧词表落空；
  //   ② 当前会话的 error 分支用**翻译后的中文文案**判定是否限流 ⇒ 翻译后不含 429 ⇒
  //      跨会话区刚排好的重试链被当场 cancel（"有登记也不重试"的元凶）；
  //   ③ 登记只覆盖手动发送 ⇒ 排队释放/重启后恢复的回合没有上下文 ⇒ 检测点 `has()` 落空。
  const appSrc65 = readAppUi();
  const rlSrc65 = readFileSync(join(ROOT, "src", "lib", "rate-limit-retry.ts"), "utf8");
  // ① 引擎重连耗尽 = 可重试信号
  (/Reconnecting/.test(rlSrc65) && /Number\(exhausted\[1\]\) >= Number\(exhausted\[2\]\)/.test(rlSrc65) ? ok : fail)(
    "【65】限流判定覆盖引擎的 `Reconnecting... N/M`（耗尽才算引擎放弃）"
  );
  // ② 清上下文/判限流必须用**原始错误**（rawError + details），不许用翻译后的文案
  (/const rawIsRateLimit = isRateLimitError\(\[rawError, details\]\.join\(" "\)\)/.test(appSrc65) ? ok : fail)(
    "【65】error 分支用原始错误判定是否限流（翻译后文案会丢掉 429 ⇒ 当场清掉重试链）"
  );
  (/&& !rawIsRateLimit\)/.test(appSrc65) ? ok : fail)(
    "【65】非限流才清重试上下文（限流留给重试链）"
  );
  // ③ 三个检测点都走统一入口（含兜底恢复）
  const ensureCalls65 = (appSrc65.match(/ensureRateLimitCtx\(/g) || []).length;
  (ensureCalls65 >= 4 ? ok : fail)(
    `【65】三处 429 检测点都走 ensureRateLimitCtx（含定义共 ${ensureCalls65} 处）`
  );
  // ④ 兜底绝不放弃：拿不到原文就发续接指令
  (/const ctx = recoverRateLimitCtx\(threadId, turn\) \?\? \{[^]*?autoContinuePrompt\(\)/.test(appSrc65) ? ok : fail)(
    "【65】拿不到原文时退续接指令（绝不因为「没有登记」就放弃重试）"
  );
  // ⑤ 重试条按会话独立记录（用户要求「每个会话独立弹这个自动重试」）
  (/useState<Record<string, \{ attempt: number; retryAt: number \}>>\(\{\}\)/.test(appSrc65) ? ok : fail)(
    "【65】重试条状态按会话分别记录（多会话各记各的倒计时）"
  );
  (/\{ \.\.\.current, \[threadId\]: entry \}/.test(appSrc65) ? ok : fail)(
    "【65】每会话独立写入重试条（不再被最后一次覆盖）"
  );
}

{
  // ── 【66】安装/依赖获取全程不得弹出系统窗口（09-19 用户：「把这些初次安装依赖和工具改成
  //   不弹窗，全部，进度条展示吧，这样可视化进度，方便新手」）──
  //   根因：Electron 父进程**没有控制台**，子进程一旦用 stdio:"inherit"，Windows 会给它
  //   **新分配一个 cmd.exe 控制台窗口**（用户截图那个黑框）。
  //   真机验证（e2e 起真实应用 + 安装 yt-dlp + tasklist 采样窗口）：管道方案全程**零新增**
  //   cmd/conhost 窗口；percent 事件 0→100 共 124 条 → 界面进度条有真实数据。
  const stripComments66 = (src) => src.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  for (const rel of ["scripts/install-runtimes.cjs", "scripts/install-automation.cjs"]) {
    const src = stripComments66(readFileSync(join(ROOT, rel), "utf8"));
    (!/stdio:\s*"inherit"/.test(src) ? ok : fail)(
      `【66】${rel} 不得用 stdio:"inherit"（无控制台的父进程下会弹 cmd 黑窗）`
    );
    (!/\bexecSync\(/.test(src) ? ok : fail)(
      `【66】${rel} 不得直接用 execSync（缺 windowsHide；统一走 runCommand/runStreaming）`
    );
  }
  const runtimesSrc66 = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (/windowsHide: true/.test(runtimesSrc66) ? ok : fail)(
    "【66】安装脚本的子进程显式 windowsHide"
  );
  (/@@PROGRESS/.test(runtimesSrc66) && /@@STAGE/.test(runtimesSrc66) ? ok : fail)(
    "【66】安装脚本上报结构化进度（@@PROGRESS / @@STAGE → 界面进度条）"
  );
  const mainSrc66 = readMainSource();
  (/function emitRuntimeProgress\(/.test(mainSrc66) && /percent: Math\.max\(0, Math\.min\(100/.test(mainSrc66) ? ok : fail)(
    "【66】主进程把进度行解析成 percent/stage 事件下发给界面"
  );
  const appSrc66 = readAppUi();
  (/className="runtime-progress-bar"/.test(appSrc66) ? ok : fail)(
    "【66】渲染层用进度条展示安装进度（卡片 / 安装弹窗）"
  );
  const envSrc66 = readFileSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"), "utf8");
  (/runtime-progress-bar/.test(envSrc66) ? ok : fail)(
    "【66】环境体检弹窗（一键安装）也有进度条"
  );
  const cssSrc66 = readStyles();
  (/\.runtime-progress-bar\s*\{/.test(cssSrc66) ? ok : fail)(
    "【66】进度条样式存在"
  );
}
{
  // ── 【67】引擎保留 provider id 不得写进配置（09-19 真实用户 DELL 事故）──
  //   档案里 provider=openai → config.toml 写出 [model_providers.openai] → 引擎**整份拒载**：
  //   `model_providers contains reserved built-in provider IDs: openai`，用户发消息必报错，
  //   且与用哪个模型无关。四层防：① 独立模块提供改名；② 写档案/写配置统一改名；
  //   ③ 会话级 config 覆盖也改名（审查发现的漏点）；④ 启动自愈清掉已写坏的段。
  const providerIdSrc67 = readFileSync(join(ROOT, "electron", "provider-id.ts"), "utf8");
  (/RESERVED_PROVIDER_IDS/.test(providerIdSrc67) && /export function safeProviderId/.test(providerIdSrc67) ? ok : fail)(
    "【67】保留 provider id 处理模块存在（electron/provider-id.ts）"
  );
  (/export function stripReservedProviderTables/.test(providerIdSrc67) ? ok : fail)(
    "【67】提供清理保留段的工具（供启动自愈用）"
  );
  const mainSrc67 = readMainSource();
  (/\[model_providers\.\$\{tomlBareKey\(safeProviderId\(normalized\.provider\)\)\}\]/.test(mainSrc67) ? ok : fail)(
    "【67】生成 provider 段头时过 safeProviderId（保留 id 会被改名）"
  );
  (/\.map\(\(id\) => safeProviderId\(id\)\)/.test(mainSrc67) ? ok : fail)(
    "【67】历史会话别名 id 同样过 safeProviderId（防 duplicate key）"
  );
  (/void healReservedProviderConfig\(\)/.test(mainSrc67) ? ok : fail)(
    "【67】启动时自愈已写坏的配置（老用户升级后自动恢复）"
  );
  // 自愈必须看**原始文件**里的 provider —— readCustomModels() 回来的已经改名，比较恒 false（实测踩过死代码）
  (/const rawList: Array<\{ provider\?: string \}> = raw \? JSON\.parse\(raw\) : \[\]/.test(mainSrc67) ? ok : fail)(
    "【67】自愈按原始档案判断是否需要改名（不是按已归一化的结果）"
  );
  const calls67 = (mainSrc67.match(/model_provider: safeProviderId\(/g) || []).length;
  (calls67 >= 7 ? ok : fail)(
    `【67】会话级 config 覆盖也过 safeProviderId（${calls67} 处）`
  );
  /* 09-22：harness-services.ts 拆成 memory-store.ts + scheduler.ts（原文件是两个无关的域）⇒ 断言跟着搬 */
  for (const rel of ["electron/channel-bot.ts", "electron/scheduler.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    (/model_provider: safeProviderId\(model\.provider\)/.test(src) ? ok : fail)(
      `【67】${rel} 的会话/子代理 config 同样过 safeProviderId`
    );
  }
}

{
  // ── 【68】不得把引擎重试参数调得比默认更激进（09-19 真实事故：429 越重试越频繁）──
  //   引擎默认 request_max_retries=4 / stream_max_retries=5 / stream_idle_timeout_ms=300000
  //   （codex-rs model-provider-info：DEFAULT_REQUEST_MAX_RETRIES / DEFAULT_STREAM_MAX_RETRIES）。
  //   曾写 10/10/600000 ⇒ 引擎在限流窗口内以 2~3 秒间隔密集重打上游 ⇒
  //   实测单个 turn 内 32 次 429、单个 submission 反复 exceeded retry limit，
  //   叠加应用层 10 次重试 = 最坏 100 倍请求放大（用户："WorkBuddy 用同一供应商完全没问题"）。
  //   ⇒ 现在一个键都不写（用引擎默认）。谁再加回来，构建阶段就红。
  const retrySrc68 = readFileSync(join(ROOT, "electron", "provider-retry.ts"), "utf8");
  // ⛔ 判据必须**剥掉注释**：该文件用注释详细记录了"曾写 10 是错的"这段历史，
  //   直接全文正则会把注释里的历史数值当成现役配置（实测踩过一次假红）。
  const retryCode68 = retrySrc68.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  (/export const PROVIDER_RETRY_TUNING = \{\} as const;/.test(retryCode68) ? ok : fail)(
    "【68】PROVIDER_RETRY_TUNING 必须为空（用引擎默认，不放大重试）"
  );
  (!/request_max_retries\s*[:=]\s*\d/.test(retryCode68) ? ok : fail)(
    "【68】provider-retry.ts 不得写死 request_max_retries 数值（代码区，不含注释）"
  );
  /* ⛔ 09-24 修：扫描前必须**剔注释** —— electron/provider-retry.ts:5 的说明文字里就写着
     `request_max_retries = 4`（那是在解释「引擎默认值」，属文档而非配置生成代码）。
     聚合面加宽把该文件纳入后，负向断言被这条注释顶成假红。断言本意就是「代码区不得写字面量」。 */
  const mainSrc68 = codeOnly(readMainSource());
  (!/request_max_retries = \d/.test(mainSrc68) ? ok : fail)(
    "【68】config.toml 生成处不得写 request_max_retries 字面量"
  );
  (!/stream_max_retries = \d/.test(mainSrc68) ? ok : fail)(
    "【68】config.toml 生成处不得写 stream_max_retries 字面量"
  );
  const rlSrc68 = readFileSync(join(ROOT, "src", "lib", "rate-limit-retry.ts"), "utf8");
  const maxMatch = rlSrc68.match(/RATE_LIMIT_MAX_ATTEMPTS = (\d+)/);
  (maxMatch && Number(maxMatch[1]) <= 8 ? ok : fail)(
    `【68】应用层重试次数保守（当前 ${maxMatch ? maxMatch[1] : "?"} 次，上限 8）`
  );
  const backoff = rlSrc68.match(/const BACKOFF_MS = \[([^\]]+)\]/);
  const first = backoff ? Number(String(backoff[1]).split(",")[0].trim()) : 0;
  (first >= 10000 ? ok : fail)(
    `【68】首次退避足够长（当前 ${first}ms，下限 10000ms —— 限流是分钟级窗口，靠等不靠多试）`
  );
}




{
  /* ── 【69】并发闸门已于 09-25 **整体删除**（用户：「直接把并发限制删了吧」）────────────
     被删的符号：`src/lib/concurrency.mjs`（concurrencyExceeded / normalizeMaxConcurrency / 两档常量）、
     part03 的 atConcurrencyLimit / notifyConcurrencyLimit / maxConcurrencyRef、
     主进程 `admitDispatch` / `maxConcurrentDispatch`、UI「最大并发」输入框。
     ⛔ 下面两条是**负向断言**（匹配前先过 codeOnly —— 注释里引用旧符号名不该把它顶成假红/假绿）：
        谁把并发限制加回来，预检直接红（用户 09-25 的明确要求是删除，不许悄悄复活）。
     ⛔ 上游限流仍由引擎默认重试/退避兜底（provider-retry.ts：一个重试键都不写）。 */
    const appUiCode69 = codeOnly(readAppUi());
    const mainSrc69 = codeOnly(readMainSource());
    (!/concurrencyExceeded|atConcurrencyLimit|normalizeMaxConcurrency|notifyConcurrencyLimit|maxConcurrencyRef/.test(appUiCode69) ? ok : fail)(
      "【69】⛔ 渲染层不得再有并发闸门的任何符号（用户 09-25 要求删除，不许悄悄复活）"
    );
    (!/admitDispatch|maxConcurrentDispatch|MAX_CONCURRENT_DISPATCH/.test(mainSrc69) ? ok : fail)(
      "【69】⛔ 主进程不得再有调度并发闸（L4 总量闸已删；L3 深度闸 canDispatchFrom 保留）"
    );

  /* ── 【159】默认值跨进程同源（09-25；压缩比例保留，并发档位已随闸门删除）──
     ⛔ `electron/` 与 `src/` 是**独立打包产物、互不 import**，所以「默认自动压缩比例」两侧各有一份
        字面量。改了主进程忘渲染层（或反过来）的症状是**静默偏半**：设置页显示 60%、主进程按 75% 写。
        跑绿也看不出来。
     ⛔ 判据取**字面量本身**（不是"含某个词"）—— 上一轮【150】就吃过「断言命中注释而非代码」的亏。
     ⛔ 并发档位已随闸门删除（见【69】），这里只剩压缩比例这一对。 */
  const ratioRenderer = ((readAppUi().match(/const AUTO_COMPACT_RATIO_DEFAULT = ([\d.]+);/) || [])[1]);
  const ratioMain = ((mainSrc69.match(/export const DEFAULT_AUTO_COMPACT_RATIO = ([\d.]+);/) || [])[1]);
  (ratioRenderer && ratioMain && ratioRenderer === ratioMain && Number(ratioRenderer) === 0.6 ? ok : fail)(
    `【159】默认自动压缩比例跨进程同源且为 0.6（渲染层 ${ratioRenderer} / 主进程 ${ratioMain}）`
  );
  /* ⛔ 反向：不能再有 `autoCompactRatio ?? 数字` 的裸默认（改了常量但某处仍写死 ⇒ 那一段 provider
     段的压缩阈值与设置页显示的不一致，而引擎按会话实际用的段取值 = 静默偏半）。
     ⛔ 判据必须**带上 autoCompactRatio**：裸匹配 `?? 0.8` 会命中无关代码（语音 asr rule2、
     记忆 confidence 都有 `?? 0.8`）—— 第一版就这么写真红了，属「断言比文案宽」的典型。 */
  (!/autoCompactRatio \?\? [\d.]+/.test(mainSrc69) ? ok : fail)("【159】主进程不再有 `autoCompactRatio ?? 数字` 裸默认（全走 normalizeAutoCompactRatio）");
  (/normalizeAutoCompactRatio\(appSettings\.autoCompactRatio\)/.test(mainSrc69) ? ok : fail)(
    "【159】压缩阈值经归一化（0 / 负数 / 越界会被挡下 —— 否则阈值变 0，引擎每轮都压缩）"
  );
  /* ⛔ 压缩阈值必须纳入**启动自愈的漂移判据**（09-25 code review 抓到）：
     config.toml 里的阈值是**写下来就不再变**的（除非有人重写整份配置）。只改设置 / 只改默认值
     都不会触发上面任何一条既有判据 ⇒ 旧阈值一直生效 = 用户看到的「改了没生效」。
     判据要同时锚「算期望值」与「接进 if 条件」两处 —— 只验前者会漏掉"算出来了但没接"。 */
  (/const expectedCompact = Math\.round\(compactWindow \* normalizeAutoCompactRatio\(/.test(mainSrc69) ? ok : fail)(
    "【159】启动自愈会算「期望压缩阈值」（与 applyCustomModel 同源算法）"
  );
  (/\|\| dispatchMcpBad \|\| compactStale\)/.test(mainSrc69) ? ok : fail)(
    "【159】压缩阈值漂移**接进了重写条件**（只算不接 = 恒不做，等于没有这条判据）"
  );
}


{
  // ── 【70】模型配置引导（09-19 用户三连反馈后定稿的形态）────────────────────
  //   1) 「排版太丑……弹窗提醒的优化一下展示」→ 四入口做成一行标签，一次只展开一个；
  //   2) 「中转站登录呢」→ 弹窗里补上中转站账户登录（登录页有的入口不能只在登录页有）；
  //   3) 「不要吸在输入框上面吧 / 输入框里面的删了」→ 删掉输入框内的提示条，
  //      入口改到**左侧栏的「模型配置」菜单**；
  //   4) 「如果在登录界面配置过了，就不要弹这个弹窗了」→ 落持久标记，配过一次永不再弹。
  const guideSrc70 = readFileSync(join(ROOT, "src", "components", "ModelSetupGuide.tsx"), "utf8");
  const appSrc70 = readAppUi();
  const cssSrc70 = readStyles();
  const relaySrc70 = readFileSync(join(ROOT, "src", "lib", "relay.ts"), "utf8");

  // ① 一键配置快路仍在（新手只需要粘一个 Key）
  (/onQuickSetup/.test(guideSrc70) ? ok : fail)("【70】引导弹窗内嵌一键配置（不再只给跳转按钮）");
  (/model-guide-key/.test(guideSrc70) ? ok : fail)("【70】引导里有 Key 输入框（新手只需粘一个 Key）");
  (/model-guide-line/.test(guideSrc70) ? ok : fail)("【70】引导里可选接入线路");
  (/lines=\{PPTokenEndpoints\}/.test(appSrc70) ? ok : fail)("【70】线路列表与登录页共用同一份数据（避免两处漂移）");
  (/async function quickSetup\(/.test(appSrc70) && /await handleLogin\(\{ \.\.\.info, model: "" \}\)/.test(appSrc70) ? ok : fail)(
    "【70】一键配置复用登录页那条成熟链路（不另写一套，避免漂移）"
  );

  // ② 四条路径都在，且是「一行标签、一次展开一个」的排版（上一版全堆在一起，用户嫌丑）
  (/model-guide-tabs/.test(guideSrc70) && /model-guide-tab /.test(guideSrc70) ? ok : fail)("【70】四入口是一行标签（teb 式，一次只展开一个 —— 排版不再挤成大长条）");
  (/onGoManual/.test(guideSrc70) && /onGoSubscription/.test(guideSrc70) ? ok : fail)("【70】保留「我自己配完整表单」与「ChatGPT 订阅登录」两条原路径（熟手不能被牺牲）");
  (/\.model-guide-tabs \{[\s\S]{0,120}?grid-template-columns: repeat\(4/.test(cssSrc70) ? ok : fail)("【70】标签栏样式存在（四列等宽）");

  // ③ 中转站账户登录必须在弹窗里（用户第一句话问的就是它）
  (/onRelayLogin/.test(guideSrc70) && /Wallet/.test(guideSrc70) ? ok : fail)("【70】引导弹窗里有「中转站账户」入口（登录页有、这里不能缺）");
  (/relayQuickLogin/.test(appSrc70) && /onRelayLogin=\{/.test(appSrc70) ? ok : fail)("【70】App 侧把中转站登录接到了弹窗");
  (/performRelayLogin/.test(appSrc70) && /export async function performRelayLogin/.test(relaySrc70) ? ok : fail)(
    "【70】中转站登录链路两处共用同一实现（lib/relay.ts 的 performRelayLogin，不复制）"
  );
  (!/window\.codex\.relayLogin\(\{ baseUrl: relayDraft/.test(appSrc70) ? ok : fail)(
    "【70】登录页不再自己写一份 relay 链路（已改走 performRelayLogin）"
  );

  // ④ 输入框内的提示条必须**删干净**（用户明令），入口改到侧栏
  (!/setup-banner/.test(appSrc70) ? ok : fail)("【70】输入框内不再有「还没配模型」提示条（用户：「输入框里面的删了」）");
  (!/\.setup-banner/.test(cssSrc70) ? ok : fail)("【70】提示条的样式也一并删除（不留死样式）");
  (/className=\{`sidebar-tab \$\{!customModel \? "needs-setup" : ""\}`/.test(appSrc70) ? ok : fail)(
    "【70】左侧栏有「模型配置」菜单（未配模型时带高亮点）"
  );
  (/<Bot size=\{15\} \/><span>模型配置<\/span>/.test(appSrc70) ? ok : fail)("【70】侧栏菜单文案是「模型配置」");
  // ⛔ 锚点别锚"前后顺序"：JSX 里文案在 onClick **之后**（按钮内容），属性在前 —— 取周边窗口才对
  const sideMenu70 = (() => {
    const at = appSrc70.indexOf("模型配置</span>");
    if (at < 0) return false;
    return /setSettingsPage\("model"\); setSettingsOpen\(true\); setMobileNav\(false\);/.test(appSrc70.slice(Math.max(0, at - 400), at + 120));
  })();
  (sideMenu70 ? ok : fail)("【70】侧栏「模型配置」点击后跳到模型设置页");
  (/\.sidebar-tab\.needs-setup \{/.test(cssSrc70) ? ok : fail)("【70】侧栏未配置高亮样式存在");

  // ⑤ 配过就不再弹（用户：「在登录界面配置过了，就不要弹这个弹窗了」）
  (/MODEL_CONFIGURED_KEY/.test(appSrc70) ? ok : fail)("【70】有「模型已配置过」的持久标记");
  (/if \(hadModelConfigured\(\)\) return;/.test(appSrc70) ? ok : fail)("【70】弹窗前先查标记 ⇒ 配过就不再弹");
  (/markModelConfigured\(\);/.test(appSrc70) ? ok : fail)("【70】配置成功时落标记（登录页/引导/中转站三条路径都汇到 handleLogin，那里写最不容易漏）");

  // ⑥ 未配模型时的既有联动不能被碰坏
  (/if \(!customModel\) \{ dbg\.deferredByModel = true; return; \}/.test(appSrc70) ? ok : fail)(
    "【70】未配模型时不弹环境体检（避免两个弹窗抢屏 —— 新手不知道该先干哪个）"
  );
  // ⛔ 同名分支有 3 处（另外两处是编辑重发/排队），必须锚**特征代码**才能命中 send() 里那处
  const sendGuard70 = appSrc70.slice(appSrc70.indexOf("planOnceRef.current = false; // /plan 旗标不跨发送泄漏"), appSrc70.indexOf("planOnceRef.current = false; // /plan 旗标不跨发送泄漏") + 600);
  (/setShowModelGuide\(true\)/.test(sendGuard70) && !/setNotice\("请先配置并启用自定义模型"\)/.test(sendGuard70) ? ok : fail)(
    "【70】未配模型时发送直接打开配置引导（不再只弹一句看不懂的错）"
  );
  // 引导文案不得残留 markdown 星号（上一版把 `**…**` 原样显示出来了，用户看到的就是星号）
  // ⛔ 必须**剥掉注释**再判：注释里写 `**强调**` 不会渲染到界面，拿全文去找会自己把自己顶红
  const guideText70 = guideSrc70.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  (!/\*\*/.test(guideText70) ? ok : fail)("【70】引导文案里没有未渲染的 markdown 星号（上一版界面上真的显示了 `**`）");
}


{
  // ── 【71】会话血缘：删源不得拖死子会话；已断链的必须自愈 ────────────────────
  //   09-19 用户事故：「我归档会话，提示 invalid paginated history lineage … missing source
  //   rollout，会话都没法选择了」。根因：旧版删会话时把**子会话依赖的源 rollout** 一起删了，
  //   而 fork/接力出来的子会话首行记着 `forked_from_id` → 引擎沿血缘回读源文件 → 找不到 →
  //   整个会话打不开。用户的原话是要「从根上修掉」且「会话必须独立」。
  const workerSrc71 = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
  const poolSrc71 = readFileSync(join(ROOT, "electron", "rollout-pool.ts"), "utf8");
  const mainSrc71 = readMainSource();
  // ① 删之前先算依赖：被别的会话依赖的源文件**必须保留**
  (/function collectLineage\(root\)/.test(workerSrc71) ? ok : fail)(
    "【71】purge 前先收集血缘依赖（collectLineage）"
  );
  (/const dependents = \(deps\.get\(match\[1\]\.toLowerCase\(\)\) \|\| \[\]\)\.filter\(\(item\) => !ids\.has\(item\.childId\)\);/.test(workerSrc71) ? ok : fail)(
    "【71】删除对象被别的活着的会话依赖时不算可删（整批一起删的子会话除外）"
  );
  (/if \(dependents\.length\) \{[\s\S]{0,200}?kept\.push\(/.test(workerSrc71) ? ok : fail)(
    "【71】有依赖者的 rollout 走 kept（保留）而不是 unlink"
  );
  (/if \(!ids\.size\) return \{ removed, failed, kept \};/.test(workerSrc71) ? ok : fail)(
    "【71】purge 返回值带 kept（调用方才能感知「被有意保留」）"
  );
  // ② 主进程必须把"保留"告诉用户/日志，不能静默
  (/if \(result\?\.kept\?\.length\) \{/.test(mainSrc71) ? ok : fail)(
    "【71】删除后被保留的 rollout 有显式日志（不静默）"
  );
  // ③ 已写坏的（源已丢）要自愈：摘掉血缘字段 + 备份原首行（可回滚）
  // ⛔ 必须含 history_base —— 它才是引擎真正读的血缘载体（09-19 实测：只摘 forked_from_id
  //   那组时文件层面看着"已自愈"，引擎照样报 missing source rollout，白跑两轮真机验证）。
  (/"history_base"\]/.test(workerSrc71) && /const LINEAGE_KEYS = \[[^\]]*"forked_from_id"[^\]]*\]/.test(workerSrc71) ? ok : fail)(
    "【71】血缘字段表含 history_base（引擎报错指的就是它的 thread_id）"
  );
  (/meta\.history_base\?\.thread_id/.test(workerSrc71) ? ok : fail)(
    "【71】依赖判定也认 history_base.thread_id（否则删源守卫仍漏判）"
  );
  // ⛔ review 抓出的两处：① 改写必须**原子替换**（写坏 = 会话历史损坏，比"打不开"更糟）；
  //   ② 自愈是 await 在启动链上的 ⇒ 必须有超时，worker 卡住不能把启动拖死。
  (/const tmpFile = `\$\{file\}\.heal\.tmp`;[\s\S]{0,160}?renameSync\(tmpFile, file\);/.test(workerSrc71) ? ok : fail)(
    "【71】自愈改写走「写临时文件 → rename」原子替换（避免半截 JSONL 毁掉会话历史）"
  );
  (/\{ healed: \[\], failed: \[\], timedOut: true \}/.test(mainSrc71) ? ok : fail)(
    "【71】血缘自愈带 5s 超时降级（await 在启动链上，不能拖死启动）"
  );
  (/for \(const key of LINEAGE_KEYS\) delete meta2\[key\];/.test(workerSrc71) ? ok : fail)(
    "【71】自愈时按表摘血缘字段（不是只删一个，避免漏摘导致仍打不开）"
  );
  (/writeFileSync\(`\$\{file\}\.lineage\.bak`, backupFirst, "utf8"\);/.test(workerSrc71) ? ok : fail)(
    "【71】自愈前备份原首行（.lineage.bak，可人工回滚）"
  );
  (/msg\.op === "healLineage"/.test(workerSrc71) ? ok : fail)(
    "【71】worker 暴露 healLineage 命令"
  );
  (/export function healRolloutLineageAsync\(codexHome/.test(poolSrc71) ? ok : fail)(
    "【71】主进程侧封装 healRolloutLineageAsync"
  );
  // ⛔ 必须 **await** 且在 `server.start()` **之前** —— 引擎一起来就把血缘读进内存，
  //   之后再改文件**同一次运行内不生效**（09-19 实测：文件已自愈但 resume 仍报 missing
  //   source rollout，必须重启才好）。位置写错 = 这个功能对"当前这次启动"完全无效。
  const healIdx = mainSrc71.indexOf("await healRolloutLineage();");
  const startIdx = mainSrc71.indexOf("await server.start();");
  (healIdx >= 0 && startIdx >= 0 && healIdx < startIdx ? ok : fail)(
    "【71】血缘自愈在 server.start() 之前 await（引擎起来后再改同一次运行内不生效）"
  );
  // ④ 自愈必须幂等：只处理「有血缘 + 源不在」的，别动正常会话
  (/if \(!meta\.parentId \|\| known\.has\(meta\.parentId\) \|\| !meta\.hasLineage\) continue;/.test(workerSrc71) ? ok : fail)(
    "【71】自愈只碰「源已丢失」的会话（源还在的正常会话不动，幂等）"
  );
}


{
  // ── 【72】上游协议手动开关（09-19 用户要求：Claude 类通道不认 responses，且自动判定不灵）──
  //   Cloid 等第三方网关常只提供 /v1/chat/completions；引擎只发 Responses ⇒ 由本地协议桥转换。
  //   但旧版桥的模式**恒为 auto**，而 auto 只在 404/405/501 时才切 chat —— 网关若对未知路径
  //   返回 400/401，就判成「端点正常」直接透传 ⇒ 对话失败且看不出原因。所以必须能手动指定。
  const bridgeSrc72 = readResponsesBridgeSource();
  const mainSrc72 = readMainSource();
  const appSrc72 = readAppUi();
  const hookSrc72 = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");

  // ① 模式来自配置，不许恒 auto
  (/const upstreamProtocols = new Map<string, BridgeMode>\(\);/.test(mainSrc72) ? ok : fail)(
    "【72】主进程有「供应商 id → 上游协议」的内存映射"
  );
  (/mode: upstreamProtocols\.get\(id\) \?\? "auto"/.test(mainSrc72) ? ok : fail)(
    "【72】桥注册时 mode 取自配置（不再恒 auto —— 手动指定才能生效）"
  );
  (!/mode: "auto", label: id/.test(mainSrc72) ? ok : fail)(
    "【72】没有残留的硬编码 auto 注册"
  );
  // ② 改设置必须能生效：register 变了要丢旧判定
  (/if \(previous && \(previous\.mode !== target\.mode \|\| previous\.baseUrl !== target\.baseUrl\)\) \{[\s\S]{0,80}?this\.resolved\.delete\(id\);/.test(bridgeSrc72) ? ok : fail)(
    "【72】协议/地址变化时丢掉已解析缓存（否则「改了设置不生效」）"
  );
  // ③ 400 的歧义判定：必须读措辞（只认状态码会误判）
  (/UNSUPPORTED_ENDPOINT_HINT/.test(bridgeSrc72) && /if \(status === 400\) \{/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 走「读响应措辞」判定（不能只看状态码：也可能是参数错误，切了反而更糟）"
  );
  // ④ 判定为「端点正常」时必须**回放**缓冲的响应体（不能吞掉真实报错）
  (/res\.end\(Buffer\.concat\(chunks\)\);/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 判定为端点正常时回放响应体（不吞真实报错）"
  );
  // ⑤ 数据链路：类型 + 保存归一 + 读侧兜底
  (/upstreamProtocol\?: BridgeMode;/.test(mainSrc72) ? ok : fail)("【72】档案类型含 upstreamProtocol");
  (/function normalizeUpstreamProtocol\(value: unknown\): BridgeMode \{/.test(mainSrc72) ? ok : fail)(
    "【72】主进程有协议归一函数（脏值落回 auto）"
  );
  (/const upstreamProtocol = normalizeUpstreamProtocol\(input\.upstreamProtocol \?\? existing\?\.upstreamProtocol\);/.test(mainSrc72) ? ok : fail)(
    "【72】保存时归一并在未传值时沿用旧值"
  );
  (/upstreamProtocol\?: BridgeMode \}\) => \{/.test(mainSrc72) ? ok : fail)("【72】custom-model:save 入参带该字段");
  (/upstreamProtocol: dedupedDraft\.upstreamProtocol \?\? "auto"/.test(hookSrc72) ? ok : fail)(
    "【72】渲染层保存时带上该字段（缺省 auto）"
  );
  // ⑥ 界面入口
  (/<span>上游协议/.test(appSrc72) ? ok : fail)("【72】供应商配置界面有「上游协议」选项");
  (/<option value="chat">Chat 兼容/.test(appSrc72) ? ok : fail)("【72】可手动选「Chat 兼容」");
  (/type UpstreamProtocol/.test(appSrc72) ? ok : fail)("【72】界面用类型约束（不是裸字符串）");
  // ⑦ 语义不许与 wireApi 混为一谈（wireApi 是写给引擎的，恒 responses）
  (/wireApi: "responses",/.test(hookSrc72) ? ok : fail)(
    "【72】wireApi 仍恒为 responses（写给引擎；引擎只发 Responses，写 chat 会拒载整份配置）"
  );
  // ⑧ 代码审查（09-19）修的三处 —— 都是"看起来能跑、实际会静默失效"的类型
  //   ① 协议映射必须在引擎起来**之前**预填：bridgeDial 是同步的、读内存表，而引擎起来后
  //      渲染层第一个请求就可能触发 bridgeDial —— 那时表还空 ⇒ 注册成 auto ⇒ 用户配的
  //      「强制 chat」重启后失效（竞态，难复现）。
  const bootSeq72 = mainSrc72.slice(mainSrc72.indexOf("await healRolloutLineage()"), mainSrc72.indexOf("await server.start()"));
  (/await readCustomModels\(\)/.test(bootSeq72) ? ok : fail)(
    "【72】启动链在 server.start() 之前预填「上游协议」映射（否则首个请求可能注册成 auto）"
  );
  //   ② 400 分支定性后必须排空上游响应：只 resolve 不消费会让 socket 长期悬挂，
  //      而 400 正是「网关不配套」的高频路径 ⇒ 泄漏随尝试次数累积。
  (/const verdictOf = \(\) => \(UNSUPPORTED_ENDPOINT_HINT\.test/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 歧义判定抽成单点（不许两处正则各写一遍，会漂移）"
  );
  (/\bup\.resume\(\);\s*\n\s*resolve\(verdict\)/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 判决后排空上游响应（不排空 = keep-alive 连接悬挂泄漏）"
  );
  //   ③ register 发现目标变化必须丢掉已解析协议（否则「改了设置不生效」且查不出原因）
  (/previous\.mode !== target\.mode \|\| previous\.baseUrl !== target\.baseUrl/.test(bridgeSrc72) ? ok : fail)(
    "【72】桥目标变化时丢弃已缓存的协议判定（mode 或 base_url 变了就重新判定）"
  );
}

// ── 【73】本地模型适配 + Claude 原生协议（09-19 用户要求）──
{
  const bridge73 = readResponsesBridgeSource();
  const main73 = readMainSource();
  const app73 = readAppUi();
  const hook73 = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");
  const css73 = readStyles();

  // ① Anthropic 协议档存在且与其它档区分
  (/export type BridgeMode = "auto" \| "responses" \| "chat" \| "anthropic";/.test(bridge73) ? ok : fail)(
    "【73】BridgeMode 含 anthropic 档"
  );
  (/export function toAnthropicRequest\(body: any\): any \{/.test(bridge73) ? ok : fail)(
    "【73】有 Responses → Anthropic Messages 的请求转换（纯函数）"
  );
  (/export class AnthropicStreamTranslator/.test(bridge73) ? ok : fail)(
    "【73】有 Anthropic SSE → Responses SSE 的流式翻译器"
  );
  // ② 协议硬规则：这三条照文档猜必错，必须钉死
  (/type: "tool_use",\s*\n\s*id: item\.call_id/.test(bridge73) ? ok : fail)(
    "【73】function_call → tool_use 且 id 沿用引擎 call_id（自己生成就对不上，工具往返必断）"
  );
  (/type: "tool_result",\s*\n\s*tool_use_id: item\.call_id/.test(bridge73) ? ok : fail)(
    "【73】function_call_output → tool_result 且 tool_use_id 配对"
  );
  (/if \(last && last\.role === role\) last\.content\.push\(\.\.\.blocks\);/.test(bridge73) ? ok : fail)(
    "【73】连续同角色消息合并（Anthropic 要求 strict 交替，不合并会被 400）"
  );
  (/max_tokens: Math\.max\(1, Math\.round\(wanted\)\)/.test(bridge73) ? ok : fail)(
    "【73】max_tokens 必填且被压到上限（引擎的上下文级大值原样透传会被拒）"
  );
  (/input_schema: tool\.parameters/.test(bridge73) ? ok : fail)(
    "【73】tools 用 input_schema（不是 chat 的 function.parameters）"
  );
  (/anthropic-version": ANTHROPIC_VERSION|x-api-key/.test(bridge73) ? ok : fail)(
    "【73】认证头转换：Bearer → x-api-key + 强制 anthropic-version"
  );
  // ③ 请求转换里不许把 system/developer 内容静默丢掉（本轮修过的真 bug）
  (/for \(const block of blocks\) if \(block\.type === "text" && block\.text\) systemChunks\.push\(block\.text\);/.test(bridge73) ? ok : fail)(
    "【73】input 里的 system/developer 内容收集进顶层 system（只 continue 跳过 = 静默丢上下文）"
  );
  // ④ 配置链路贯通（少一层就会「选了但没效果」）
  (/value === "chat" \|\| value === "responses" \|\| value === "anthropic" \? value : "auto";/.test(main73) ? ok : fail)(
    "【73】主进程 normalizeUpstreamProtocol 认 anthropic"
  );
  (/export type UpstreamProtocol = "auto" \| "chat" \| "responses" \| "anthropic";/.test(hook73) ? ok : fail)(
    "【73】渲染层类型含 anthropic"
  );
  (/<option value="anthropic">Anthropic（Claude 原生 \/v1\/messages）<\/option>/.test(app73) ? ok : fail)(
    "【73】供应商配置的下拉里真有这一档（只加类型不加选项 = 用户选不到）"
  );
  // ⑤ 本地模型预设
  (/const LOCAL_MODEL_PRESETS = \[/.test(app73) && /127\.0\.0\.1:11434\/v1/.test(app73) ? ok : fail)(
    "【73】本地模型预设存在（Ollama 11434 为起点）"
  );
  (["11434", "1234", "8000", "8080"].every((port) => app73.includes(`127.0.0.1:${port}/v1`)) ? ok : fail)(
    "【73】覆盖四家常用本地服务端口（Ollama / LM Studio / vLLM / llama.cpp）"
  );
  (!/maxConcurrency: "/.test(app73) ? ok : fail)(
    "【73】⛔ 本地预设不得再带并发档位（并发限制已删，09-25；不许悄悄复活）"
  );
  // 点预设不能改掉已有供应商的身份（改了就是覆盖别人的配置）
  // 点预设不能改掉已有供应商的身份 —— 09-19 改为**更强的保证**：
  // 编辑已保存供应商时整排预设根本不显示（见下条），所以旧的「isNew 判定」断言已失效并删除。
  // ⑥ 说明收进 ? 号
  (/function FieldHelp\(\{ text \}: \{ text: string \}\)/.test(app73) ? ok : fail)(
    "【73】有 ? 说明组件（用户要求：赘述收进 ? 号）"
  );
  (/tabIndex=\{0\}[\s\S]{0,140}?role="note"[\s\S]{0,80}?aria-label=\{text\}/.test(app73) ? ok : fail)(
    "【73】? 图标可键盘访问（只靠 hover 的话键盘用户读不到说明）"
  );
  (!/<p className="provider-form-hint">协议自动适配/.test(app73) ? ok : fail)(
    "【73】协议自动适配的常驻长说明已移除（改由 ? 承载）"
  );
  (/\.field-help-pop \{/.test(css73) ? ok : fail)(
    "【73】? 气泡浮层样式存在（portal 方案，09-20 起取代伪元素）"
  );
  (/\.local-preset-chip \{/.test(css73) ? ok : fail)("【73】本地预设 chip 样式存在");
  // ⑦ 本地服务「无 Key 也能启用」（09-19 代码审查抓到的真 bug）
  //   原逻辑把「无 Key 的第三方供应商」一律存成禁用（防首次安装默认启用），
  //   而本地模型服务本来就不需要 Key ⇒ 配好本地模型却发不出消息且看不出原因。
  (/function isLocalEndpoint\(baseUrl: unknown\): boolean \{/.test(main73) ? ok : fail)(
    "【73】有「本机/内网地址」判定（本地服务无 Key 应可启用）"
  );
  (/localhost" \|\| host === "::1" \|\| host === "0\.0\.0\.0"/.test(main73) ? ok : fail)(
    "【73】判定覆盖 loopback 各写法（127.x / localhost / ::1 / 0.0.0.0）"
  );
  (/\^172\\\.\(1\[6-9\]\|2\\d\|3\[01\]\)\\\./.test(main73) ? ok : fail)(
    "【73】判定覆盖 RFC1918 私网（含 172.16-31 这段，容易漏）"
  );
  // ⛔ 两处必须同源：只改保存侧 → 存成启用却显示停用；只改显示侧 → 界面假启用
  ((main73.match(/!isLocalEndpoint\(/g) ?? []).length >= 2 ? ok : fail)(
    "【73】显示侧（publicCustomModel）与保存侧（custom-model:save）都过同一判定（必须同源）"
  );
  (/provider !== "openai-official" && !isLocalEndpoint\(/.test(main73) ? ok : fail)(
    "【73】公网无 Key 的供应商仍被禁用（不能过度放宽，原意图要保住）"
  );
  // ⑧ 本地预设只在「新建」时显示 + 可取消（09-19 用户反馈）
  //   ① 「应该做新建的时候展示，不能在已配置模型里面还能选，容易误点」
  //   ② 「选中一个没法取消选择」
  // 09-21：块搬到组件后缩进变化，且 tsc 为回调参数补了 `: any` ⇒ 正则容忍两者（判据语义不变）
  (/const editingExisting = Boolean\(editingProvider\)\s*\n\s*\|\| providersList\.some\(\(item(?::\s*any)?\) => item\.provider === customDraft\.provider\);/.test(app73) ? ok : fail)(
    "【73】本地预设只在新建时显示（编辑已保存供应商时不出现，防误点）"
  );
  (!/const isNew = !current\.provider \|\| \/\^custom\\d\*\$\/\.test\(current\.provider\);/.test(app73) ? ok : fail)(
    "【73】预设显隐判定**不得**依赖 provider id 前缀（点了预设 id 会变成 ollama，整排会自己消失）"
  );
  (/if \(current\.baseUrl === preset\.url\) \{/.test(app73) ? ok : fail)(
    "【73】再点同一个预设可取消选择（用户反馈「没法取消」）"
  );
  (/name: current\.name\.trim\(\) === preset\.name \? "" : current\.name,/.test(app73) ? ok : fail)(
    "【73】取消时只回退预设写的值（用户手改过的名称/地址不动）"
  );
  // 取消分支要恢复一个全新的 custom id —— 用语义锚点（真实代码是 new RegExp 模板字符串，
  // 直接锚字面量要嵌套转义，太脆）
  (/if \(current\.baseUrl === preset\.url\) \{[\s\S]{0,400}?custom\$\{Date\.now\(\) % 1000\}/.test(app73) ? ok : fail)(
    "【73】取消时把预设生成的 id 也还原（避免留一个 ollama-2 这种无主 id）"
  );
  // ⑨ 「?」气泡必须走 portal 浮层（09-20 用户：「问好弹窗被左边供应商选项遮住了」）
  //   伪元素方案在 .provider-form（overflow-y:auto）里必被裁：气泡向左伸进 .provider-list 区域
  //   的部分直接消失（实测左边缘 537 < 列表右边界 603），看起来正是「被左边供应商遮住」。
  (/: \{ text: string \}\) \{[\s\S]{0,2600}?createPortal\(/.test(app73) ? ok : fail)(
    "【73】FieldHelp 的气泡走 createPortal 挂 body（伪元素逃不出滚动容器裁剪与层叠上下文）"
  );
  (!/\.field-help::after/.test(css73) ? ok : fail)(
    "【73】不得回退成 .field-help::after 伪元素气泡（09-20 已实锤会被 .provider-form 裁掉）"
  );
  (/\.field-help-pop \{[\s\S]{0,200}?position: fixed;/.test(css73) ? ok : fail)(
    "【73】气泡浮层本体是 position:fixed（fixed 不受祖先 overflow 裁剪）"
  );
  // ⑩ 通知是多条队列（09-20 用户：「会话窗口产生的弹窗相互污染，区分不出来哪个是哪个」）
  //   旧实现 const [notice, setNotice] = useState("") 是单槽：多会话并发来通知时后到的**直接顶掉**先到的。
  (!/const \[notice, setNotice\] = useState\(""\)/.test(app73) ? ok : fail)(
    "【73】不得回退成单槽 notice useState（多会话并发时会互相覆盖）"
  );
  (/const setNotice = useCallback\(\(text: string, threadId\?: string\) => \{[\s\S]{0,1500}?setNotices\(\(current\) => \[\.\.\.current, \{ id, text, threadId, scope \}\]/.test(app73) ? ok : fail)(
    "【73】setNotice 是「推一条入队」的兼容函数且引用稳定（useCallback——它被当 onNotice 传进子组件的 effect 依赖；空串仍=清空全部）"
  );
  (/notice-stack/.test(app73) && /\.notice-stack \{/.test(css73) ? ok : fail)(
    "【73】通知渲染走 .notice-stack 堆叠容器（多条并存、各自独立倒计时）"
  );
  (/String\(threadId\)\.replace\(\/-\/g, ""\)\.slice\(-4\)/.test(app73) ? ok : fail)(
    "【73】会话名兜底用 id 后 4 位短码（常量「会话」会让所有未命名会话撞成同一个名字）"
  );
  // ⑪ 弹窗位置跟随来源（09-20 用户：设置页产生的在设置弹窗内居中，对话的在对话区居中）
  (/threadId \? "chat" : \(settingsOpenRef\.current \? "settings" : "chat"\)/.test(app73) ? ok : fail)(
    "【73】通知归属（settings/chat）必须在入队时判定（渲染时再判会串组；带 threadId 恒为对话区）"
  );
  (/selector: "\.settings-modal"/.test(app73) && /selector: "main\.workspace"/.test(app73) ? ok : fail)(
    "【73】两组通知各贴各的锚：设置组贴 .settings-modal、对话组贴 main.workspace"
  );
  // ⑫ 通知中心（09-20 用户：收纳「不在看的会话」的通知 + 徽标 + 分组/已读/批量）
  (/const belongsToOtherThread = Boolean\(threadId && threadId !== threadRef\.current\?\.id\);/.test(app73) ? ok : fail)(
    "【73】中心只收「别的会话」的通知（设置操作提示/复制这类即时反馈无会话归属，收进去是噪音——用户点名纠正）"
  );
  (/scope === "chat" && settingsOpenRef\.current\) return;/.test(app73) ? ok : fail)(
    "【73】设置弹窗开着时对话来源的通知不弹浮层（不准跨对话框展示），静默进中心靠徽标提醒"
  );
  // 09-24：通知中心顶栏入口整块换成历史会话搜索（通知状态机仍在 part02，仅无顶栏入口）；
  // 同一个 portal 坑由新面板继承断言。
  (/chatSearchOpen && createPortal/.test(app73) ? ok : fail)(
    "【73】当前会话搜索面板必须 portal 到 body（.topbar z-index:30 的层叠上下文会把面板盖死——实测 DOM 全绿画面没有）；⛔ 开关必须是 bag.chatSearchOpen 单一真相源（Ctrl+Shift+F 也走它，另立局部 state 会让快捷键只打高亮不出面板）"
  );
  (/notice-center-v1/.test(app73) ? ok : fail)(
    "【73】中心持久化到 localStorage（notice-center-v1，上限 200 条）"
  );
  // ⑬ PATH 漂移检查必须跨平台（09-20 mac 审计抓到的真缺口）
  //   cfgPathLine 是 config.toml 里的 PATH 值：Windows 用 `;` 分隔、mac 用 `:`（path.delimiter）。
  //   写死 `;` 会在 mac 上把整条 PATH 当成一个元素 ⇒ 与 expectedFirst 永不相等 ⇒
  //   **每次启动都误判「安装目录漂移」并整份重写 config.toml**。
  (/cfgPathLine[\s\S]{0,160}?split\(path\.delimiter\)/.test(main73) ? ok : fail)(
    "【73】config.toml 的 PATH 漂移检查用 path.delimiter 切分（写死 ';' 会在 mac 上每次启动误判漂移并重写配置）"
  );
  (!/cfgPathLine\.replace\(\/\\\\\\\\\/g, "\\\\"\)\.split\(";"\)/.test(main73) ? ok : fail)(
    "【73】不得回退成写死分号切分 PATH"
  );
  // ⑭ 工具下载的进度与速度（09-20 用户：「把下载速度显示，和后台下载加一下」）
  //   ⛔ 关键事实：curl 的进度输出在**非 TTY**（我们走管道）下拿不到数据 ——
  //   `--progress-bar` 只吐 `#=#=#` 占位行、默认进度表只在结束时给一行总结。
  //   所以进度与速度**必须靠采样输出文件大小**自己算，不能回退去解析 curl 的输出。
  const instSrc = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  const instNoComment = instSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  (/\$\{speedText\}/.test(instSrc) && /@@SPEED/.test(instSrc) ? ok : fail)(
    "【73】下载脚本上报 @@SPEED（速率 + 已下载/总大小）"
  );
  (!/--progress-bar/.test(instNoComment) ? ok : fail)(
    "【73】不得依赖 curl 进度输出（非 TTY 下它只给占位行/结束总结——曾是进度条一直空的根因）"
  );
  (/setInterval\(\(\) => \{[\s\S]{0,1400}?\}, 500\)/.test(instSrc) ? ok : fail)(
    "【73】按 500ms 采样输出文件大小算百分比与瞬时速度"
  );
  (/const speed = line\.match\(\/\^@@SPEED/.test(main73) ? ok : fail)(
    "【73】主进程解析 @@SPEED 并随 runtime:progress 下发"
  );
  (/runtimeSpeed/.test(app73) ? ok : fail)(
    "【73】渲染层显示下载速度（安装弹窗 / 开发工具页 / 体检弹窗）"
  );
  (/后台运行/.test(app73) ? ok : fail)(
    "【73】安装弹窗支持「后台运行」：未完成也能关，下载继续、完成后再通知"
  );
  // ⑮ ⛔ 撤回记录（09-20 下午用户实测：「钉顶+发送特效你怎么又给我弄没了」）：
  //   12:47 曾加过「短会话内容靠底」= `.timeline { display:flex }` + 首元素 `margin-top: auto`。
  //   真机探针实测它**打坏钉顶**：`.timeline-bottom-spacer` 作为 flex item 的 `flex-shrink` 默认 1
  //   ⇒ 设 300px 只渲染 276px；而钉顶落点公式读的正是 `pad.offsetHeight`（**实际渲染高度**，
  //   见 `scrollHeightNoPad = scrollHeight − pad.offsetHeight`）⇒ 落点永远差一截；
  //   且首元素 auto margin 会把偏移算进 `anchorTopScroll`，与公式打架 ⇒ pad 在 0↔数百 px 振荡。
  //   故守卫改成**反向**：钉顶几何依赖 `.timeline` 的布局模型，不许改成 flex/grid。
  {
    const timelineBlock = (/\.timeline:not\(\.empty-state\)\s*\{([^}]*)\}/.exec(css73) || [])[1] ?? "";
    (!/display:\s*(flex|grid)/.test(timelineBlock) ? ok : fail)(
      "【73】非欢迎页的 timeline 不得是 flex/grid 容器（会压缩底部留白 spacer → 钉顶落点公式失效）"
    );
    // 留白 spacer 的高度必须是**显式 height**：钉顶公式要求它是可预测定值，
    // flex-grow 会让它随剩余空间伸缩（公式里的 pad.offsetHeight 就失去意义）。
    const spacerBlock = (/\.timeline-bottom-spacer\s*\{([^}]*)\}/.exec(css73) || [])[1] ?? "";
    (spacerBlock && !/flex(-grow)?\s*:\s*(1|auto)/.test(spacerBlock) ? ok : fail)(
      "【73】底部留白 spacer 必须用显式 height（不得 flex-grow：钉顶公式按定值算落点）"
    );
    // 撤回原因必须留在样式表里，防止后来者再把「靠底」加回来（这条是真机实测的代价换来的）
    (/已证明会打坏钉顶/.test(css73) ? ok : fail)(
      "【73】样式表保留「timeline 不得改 flex 靠底」的撤回说明（防回退）"
    );
  }
  (/notice-stack-in/.test(css73) ? ok : fail)(
    "【73】堆叠子项必须用自己的入场动画（旧 notice-in 最终帧 translate(-50%) 配 both 会把子项永久左移——靠左 bug 根因）"
  );
}

// ---------- 【74】自动化能力接线（09-20 盘点后的改造）----------
// 背景：nuphus MCP 已注册 38 个工具（桌面 14 + 浏览器 24），但内置技能里 `playwright-cli` 提 23 次、
//       `browser_*` 提 0 次 ⇒ 工具白占约 10k 前缀，而模型每步走 CLI（一次进程往返）。
// 本段钉住两件事：① 提示词必须与**已注册的工具**一致；② 技能停用状态与指令漂移判据不得退化。
{
  const bs74 = readBuiltinSkillsSource();
  const di74 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  const main74 = readMainSource();
  /* 按常量边界切出各自正文（不要用正则非贪婪到 `  ——正文里有转义反引号，容易切错）。
     ⛔ 09-22：技能常量已按技能切到 electron/builtin-skills/**，**拼接顺序不再等于原文件顺序**
     ⇒ 「从 A 到后面的 B」会切出空串（B 在拼接里排在 A 前面）。改成「从该常量到
     **下一个常量或下一段文件头注释**」——与文件怎么切无关，判据语义不变（仍是"切出该技能正文"）。 */
  const cutSkill = (name) => {
    const m = new RegExp("^(?:export\\s+)?const " + name + " =", "m").exec(bs74);
    if (!m) return "";
    const rest = bs74.slice(m.index + m[0].length);
    const nxt = /\n(?:export\s+)?const |\n\/\*\*/.exec(rest);
    return rest.slice(0, nxt ? nxt.index : rest.length);
  };
  const bSkill = cutSkill("BROWSER_SKILL");
  const dSkill = cutSkill("DESKTOP_SKILL");
  (bSkill && dSkill ? ok : fail)("【74】能从 builtin-skills.ts 切出两个技能正文（切不出来说明常量被改名/移动）");

  // ① 浏览器技能必须真的讲 browser_* 通道，而不只是换个标题
  (/browser_snapshot/.test(bSkill) && /browser_exec/.test(bSkill) && /browser_import_cookies/.test(bSkill) ? ok : fail)(
    "【74】browser-skill 讲清 browser_* 通道（快照 / 批处理 / 登录态复用）"
  );
  (/单次 CDP 往返/.test(bSkill) ? ok : fail)("【74】browser-skill 点明 browser_exec 的价值（多步合并成单次 CDP 往返）");
  (/三段循环/.test(bSkill) ? ok : fail)("【74】browser-skill 有「观察 → 动作 → 验证」三段协议");
  (/判存在/.test(bSkill) ? ok : fail)("【74】browser-skill 有判存在规则（nuphus 随桌面总闸注册，通道不能写死）");

  // ② 桌面技能：perceive/vision 分工 + 平台降级（Intel Mac 无本地 OCR）
  (/desktop_perceive/.test(dSkill) && /never click with them/.test(dSkill) ? ok : fail)(
    "【74】desktop-skill 写明 perceive 拿坐标、vision 的坐标不可点（工具描述原文警告）"
  );
  (/ONNX Runtime 已放弃 osx-x64/.test(dSkill) ? ok : fail)(
    "【74】desktop-skill 声明 Intel Mac 无本地 OCR（上游放弃 osx-x64，属预期而非故障）"
  );
  (/不可逆动作先问用户/.test(dSkill) ? ok : fail)("【74】desktop-skill 有不可逆动作先问用户的硬约束");

  // ③ 技能停用状态必须被尊重（09-20 修：总闸停用后每次启动被静默写回，总闸形同虚设）
  (/existsSync\(disabledFile\) \? disabledFile : activeFile/.test(bs74) ? ok : fail)(
    "【74】ensureBuiltinSkills 尊重 SKILL.md.disabled（否则用户停用的技能每次启动被写回）"
  );
  (/existing\.replace\(\/\\r\\n\/g, "\\n"\) !== content\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bs74) ? ok : fail)(
    "【74】技能内容比对归一化行尾（否则每次启动都白写一遍盘）"
  );

  // ④ 指令过期判据必须与「写出内容」同源（09-20 修的第二个 bug：旧判据 grep 一句老短语 ⇒ 恒 false）
  //   ⛔ 09-20 二次调整：为了让 nuphus 视觉 env 复用同一份输入，判据改成「先取 devInputNow、再生成整行」。
  //   断言随之改为**抓同源关系**（取值与生成整行用同一个变量）——比锚死一个具体写法耐改，
  //   且比旧版更强：旧版只证明"调了 devInstructionsInput"，新版证明"两次用的是同一份"。
  (/const devInputNow = await devInstructionsInput\(\);[\s\S]{0,140}?developerInstructionsLine\(devInputNow\)/.test(main74) ? ok : fail)(
    "【74】instructionsOutdated 用与写出同源的输入重新生成整行比对"
  );
  (/const instructionsOutdated = !configText\.includes\("Never infer/.test(main74) ? fail : ok)(
    "【74】不得回退成「grep 一句老短语」判断指令是否过期（老配置里本来就有 ⇒ 恒 false ⇒ 升级永不刷新）"
  );
  (/const devInput = await devInstructionsInput\(\)/.test(main74) && /developerInstructionsLine\(devInput\)/.test(main74) ? ok : fail)(
    "【74】applyCustomModel 与漂移判据共用 devInstructionsInput（两边输入不同会恒 true ⇒ 每次启动整份重写）"
  );

  // ⑤ 桌面指令不得只说命令行（否则模型不会直接调已注册的 desktop_* 工具）
  (/the nuphus MCP desktop tools are already registered/.test(di74) ? ok : fail)(
    "【74】developer_instructions 明说 desktop_* 已注册、可直接调用（旧文案只提 nuphus-call）"
  );
  (!/on-demand CLI bridge to desktop automation tools/.test(di74) ? ok : fail)(
    "【74】不得回退成「桌面只有 nuphus-call 命令行」的旧文案"
  );

  // ⑥ 跨平台文案不得写死单一平台的按键（09-20 审查抓到：指令里写死 Ctrl+V，mac 用户照着按必失败；
  //    这条文案是**每次请求都下发**的基础指令，错一次会持续误导）
  (!/Ctrl\+V/.test(bs74 + di74) || /Cmd\+V/.test(bs74 + di74) ? ok : fail)(
    "【74】按键写法不得只写死 Windows（出现 Ctrl+V 就必须同时给出 macOS 的 Cmd+V）"
  );
}

// ---------- 【75】自动化总闸＝硬控制 + nuphus 版本四处同源（09-20）----------
// 背景：两个总闸原先都不是硬控制 —— 关桌面会把 browser_* 一起带走（安全边界：不能只给浏览器），
// 关浏览器则 browser_* 仍全量注册、只靠提示词劝阻。现在由 disabled_tools 掩码实现硬阻断。
// 断言跑的是 dist-electron/automation-policy.js 的**真函数**（与【28】同路子），不是 grep 源码。
{
  const req75 = createRequire(import.meta.url);
  let pol = null;
  try { pol = req75(join(ROOT, "dist-electron", "automation-policy.js")); } catch { pol = null; }
  (pol ? ok : fail)("【75】dist-electron/automation-policy.js 可加载（总闸掩码的唯一来源）");

  if (pol) {
    const D = pol.NUPHUS_DESKTOP_TOOLS || [];
    const B = pol.NUPHUS_BROWSER_TOOLS || [];
    (D.length === 15 && B.length === 23 && new Set([...D, ...B]).size === 38 ? ok : fail)(
      `【75】nuphus 工具分组与实测枚举一致（桌面 15 + 浏览器 23 = 38；实际 ${D.length}+${B.length}）`
    );
    (pol.shouldRegisterNuphus({ desktop: false, browser: true })
      && pol.shouldRegisterNuphus({ desktop: true, browser: false })
      && !pol.shouldRegisterNuphus({ desktop: false, browser: false }) ? ok : fail)(
      "【75】nuphus 注册条件是「任一总闸开启」（关桌面不再连带丢掉 browser_* —— 安全边界）"
    );
    const onlyBrowser = pol.nuphusDisabledTools({ desktop: false, browser: true });
    const onlyDesktop = pol.nuphusDisabledTools({ desktop: true, browser: false });
    (onlyBrowser.length === 15 && !onlyBrowser.some((t) => t.startsWith("browser_")) ? ok : fail)(
      "【75】只开浏览器 ⇒ 掩掉整组桌面工具（真实键鼠拿不到）且不误伤 browser_*"
    );
    (onlyDesktop.length === 23 && !onlyDesktop.some((t) => t.startsWith("desktop_")) ? ok : fail)(
      "【75】只开桌面 ⇒ 掩掉整组浏览器工具（浏览器总闸＝硬控制，不再只是提示词）"
    );
    const merged = pol.withNuphusMasksForRules(
      { nuphus: { deny: [], ask: ["desktop_mouse"], allow: ["desktop_screenshot"] } },
      { desktop: false, browser: true },
    );
    (merged.nuphus.deny.includes("desktop_mouse")
      && !merged.nuphus.ask.includes("desktop_mouse")
      && !merged.nuphus.allow.includes("desktop_screenshot") ? ok : fail)(
      "【75】掩码进 deny 并从 ask/allow 摘除（否则同一工具既 disabled 又带 approval_mode，配置自相矛盾）"
    );
    (pol.effectiveNuphusPermission("desktop_mouse", "allow", { desktop: false, browser: true }) === "deny" ? ok : fail)(
      "【75】总闸掩码压过用户显式 allow（关着的组不能被单个工具放行）"
    );
  }

  const main75 = readMainSource();
  (/mcp-servers:permissions[\s\S]{0,700}?withNuphusMasks\(/.test(main75) ? ok : fail)(
    "【75】mcp-servers:permissions 也过掩码（否则界面显示「未设权限」而配置里已被禁用）"
  );
  (/shouldRegisterNuphus\(\{ desktop: desktopAuto, browser: browserAuto \}\)/.test(main75) ? ok : fail)(
    "【75】config.toml 的 nuphus 段用 shouldRegisterNuphus 判注册"
  );
  (/withNuphusMasksForRules\(mcpToolRulesOf\(mcpOverrides\)/.test(main75) ? ok : fail)(
    "【75】掩码并进 mcpToolRules（落成 disabled_tools）"
  );

  const pinOf = (file, re) => { try { return (re.exec(readFileSync(join(ROOT, file), "utf8")) || [])[1] || ""; } catch { return ""; } };
  /* ⛔ 09-24（评估报告 §3.4）：版本常量已收敛到 scripts/lib/tools-versions.cjs（单一来源），
     所以「win 版本常量 / mac npm 安装 / mac manifest」三处不再是字面量，而是从表里取。
     断言跟着搬：前两处改为「该文件确实从单一来源取 nuphus」，第三处改为直接在表里读。 */
  const versions75 = pinOf("scripts/lib/tools-versions.cjs", /nuphus: "([0-9.]+)"/);
  const pins = {
    "版本表": versions75,
    "win 取表": /const NUPHUS_VERSION = TOOLS_VERSIONS\.nuphus;/.test(readFileSync(join(ROOT, "scripts/prepare-windows-tools.cjs"), "utf8")) ? versions75 : "",
    "mac npm 取表": /@nuphus\/nuphus-mcp@\$\{TOOLS_VERSIONS\.nuphus\}/.test(readFileSync(join(ROOT, "scripts/prepare-mac-tools.cjs"), "utf8")) ? versions75 : "",
    "mac manifest 取表": /nuphus: TOOLS_VERSIONS\.nuphus/.test(readFileSync(join(ROOT, "scripts/prepare-mac-tools.cjs"), "utf8")) ? versions75 : "",
    "mac cargo ref": pinOf(".github/workflows/build-mac.yml", /repository: mrpulor-gh\/nuphus-mcp[\s\S]{0,220}?ref:\s*v([0-9.]+)/),
  };
  const uniq = new Set(Object.values(pins));
  (uniq.size === 1 && [...uniq][0] ? ok : fail)(
    `【75】nuphus 版本四处同源（${Object.entries(pins).map(([k, v]) => k + "=" + (v || "缺")).join(" / ")}）`
  );

  const bs75 = readBuiltinSkillsSource();
  const di75 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  (/判存在（必做的第一步）/.test(bs75) ? ok : fail)(
    "【75】desktop-skill 有「判存在」小节（总闸关着时别去调不存在的 desktop_*，也别用命令行绕）"
  );
  (/IF `desktop_windows_list` is in your tool list/.test(di75) ? ok : fail)(
    "【75】基础指令里桌面能力也按「工具列表里有没有 desktop_windows_list」判存在"
  );
  (/do not fall back to `nuphus-call` to bypass the switch/.test(di75) ? ok : fail)(
    "【75】明确禁止用命令行绕过总闸（nuphus-call 仍在 PATH 上，配置管不到这一层）"
  );
}

// ---------- 【76】nuphus 视觉插件接线（09-20）----------
// 背景：用户报「视觉插件配置好了总是不生效」。根因 = `[mcp_servers.nuphus]` 从来没有 env 段，
// 插件里的 baseUrl/apiKey/model 根本没进 nuphus 进程（`desktop_vision` 恒报 API_KEY required，
// 模型只好回落本地 OCR → 体感「一调用就空转」）。
// 格式 `[mcp_servers.X.env]` 已用**真实 app-server 探针**实证（假 stdio MCP 把自己 env 落盘，
// 4 个哨兵值全部命中、stderr 无 Invalid configuration），这里只守「接线没被改回去 / 没写歪」。
{
  const req76 = createRequire(import.meta.url);
  let nv = null;
  try { nv = req76(join(ROOT, "dist-electron", "nuphus-env.js")); } catch { nv = null; }
  (nv ? ok : fail)("【76】dist-electron/nuphus-env.js 可加载（视觉 env 映射的唯一来源）");

  if (nv) {
    const full = { enabled: true, baseUrl: "https://x.example/v1", apiKey: "  sk-abc  ", model: " glm-v " };
    const pairs = nv.nuphusVisionEnv(full);
    const map = Object.fromEntries(pairs);
    (pairs.length === 4
      && map.NUPHUS_MCP_VISION_PROVIDER === "openai"
      && map.NUPHUS_MCP_VISION_API_KEY === "sk-abc"
      && map.NUPHUS_MCP_VISION_MODEL === "glm-v"
      && map.NUPHUS_MCP_VISION_BASE_URL === "https://x.example/v1" ? ok : fail)(
      "【76】配好时产出 4 个 NUPHUS_MCP_VISION_*（provider 恒 openai，值 trim 后原样下发）"
    );
    (nv.NUPHUS_VISION_PROVIDER === "openai" ? ok : fail)(
      "【76】provider 固定 openai（内置视觉插件与 nuphus 同为 OpenAI 兼容 /chat/completions）"
    );
    // 缺一即不写：半截 env 只会让 nuphus 报一句更难懂的错
    (nv.nuphusVisionEnv({ enabled: false, baseUrl: "https://x", apiKey: "k", model: "m" }).length === 0
      && nv.nuphusVisionEnv({ baseUrl: "https://x", apiKey: "", model: "m" }).length === 0
      && nv.nuphusVisionEnv({ baseUrl: "", apiKey: "k", model: "m" }).length === 0
      && nv.nuphusVisionEnv({ baseUrl: "https://x", apiKey: "k", model: "  " }).length === 0
      && nv.nuphusVisionEnv(undefined).length === 0 ? ok : fail)(
      "【76】停用或缺 apiKey/model/baseUrl ⇒ 返回空（整段 env 不写，不产出半截配置）"
    );
  }

  const main76 = readMainSource();
  const nvSrc76 = readFileSync(join(ROOT, "electron", "nuphus-env.ts"), "utf8");
  // ⛔ 只能有一处**生成**：出现两次就是重复段（TOML duplicate key ⇒ 引擎起不来，09-16 踩过同类）。
  //   数「生成数组里那一个元素」的形态（`["", NUPHUS_VISION_ENV_TABLE, ...]`）——
  //   表名字面量只允许出现在 nuphus-env.ts 的常量定义里，两处各写一次就会悄悄漂移。
  const envTableCount = (main76.match(/\["", NUPHUS_VISION_ENV_TABLE,/g) || []).length;
  (envTableCount === 1 ? ok : fail)(
    `【76】视觉 env 段只由一处生成（实际 ${envTableCount} 处 —— 两处会写出重复表，引擎直接起不来）`
  );
  (/export const NUPHUS_VISION_ENV_TABLE = "\[mcp_servers\.nuphus\.env\]"/.test(nvSrc76) ? ok : fail)(
    "【76】表名字面量只在 nuphus-env.ts 定义一次（写出侧与漂移判定共用，不各写一遍）"
  );
  (/\$\{key\} = "\$\{escapeToml\(value\)\}"/.test(main76) ? ok : fail)(
    "【76】env 值走 escapeToml 转义（key 里出现过 \\ / \" 会写坏 TOML）"
  );
  (/nuphusVisionEnv\(devInput\.nuphusVision\)/.test(main76) ? ok : fail)(
    "【76】config.toml 的 nuphus 段用 nuphusVisionEnv(devInput.nuphusVision) 取 env"
  );
  (/nuphusVision: builtinPlugins\.vision,/.test(main76) ? ok : fail)(
    "【76】devInstructionsInput 把原始视觉配置带出来（同一份来源，改插件时两处一起变）"
  );
  (/nuphusVisionEnvDrift\(\{[\s\S]{0,220}?escape: escapeToml,/.test(main76) ? ok : fail)(
    "【76】漂移判定注入的 escape 就是写出用的 escapeToml（换一个实现 ⇒ 判定永远对不上 ⇒ 每次启动重写）"
  );
  (/nuphusRegisteredNow = shouldRegisterNuphus\(/.test(main76) ? ok : fail)(
    "【76】注册前提走 shouldRegisterNuphus + 覆盖表（与 config.toml 写出侧同一判据）"
  );
  (/\|\| instructionsOutdated \|\| nuphusVisionStale \|\| disabledMissing/.test(main76) ? ok : fail)(
    "【76】nuphusVisionStale 真的进了重写条件（只算出变量、不参与判断 = 死代码）"
  );

  if (nv) {
    // ---- 漂移判定的**行为断言**（这块内联时只能 grep；「恒真 ⇒ 每次启动整份重写」是最危险的失效模式）----
    const V = { enabled: true, baseUrl: "https://x.example/v1", apiKey: "sk-abc", model: "glm-v" };
    // 用**生产同一个** escapeTomlString（config-toml.js 的真产物），不要自己另写一份 ——
    // 判定两端只要有一端转义口径不同，就会恒判漂移（每次启动整份重写）。
    const esc = req76(join(ROOT, "dist-electron", "config-toml.js")).escapeTomlString;
    const withEnvText = [
      "[mcp_servers.nuphus]",
      'command = "nuphus.exe"',
      "",
      nv.NUPHUS_VISION_ENV_TABLE,
      `NUPHUS_MCP_VISION_PROVIDER = "${nv.NUPHUS_VISION_PROVIDER}"`,
      `NUPHUS_MCP_VISION_API_KEY = "${esc(V.apiKey)}"`,
      `NUPHUS_MCP_VISION_MODEL = "${esc(V.model)}"`,
      `NUPHUS_MCP_VISION_BASE_URL = "${esc(V.baseUrl)}"`,
    ].join("\n");
    const noEnvText = '[mcp_servers.nuphus]\ncommand = "nuphus.exe"\n';
    const D = (o) => nv.nuphusVisionEnvDrift(o);
    (D({ vision: V, registered: true, configText: noEnvText, escape: esc }) === true
      && D({ vision: V, registered: true, configText: withEnvText, escape: esc }) === false ? ok : fail)(
      "【76】已配插件 + 已注册：缺 env 判漂移、逐字一致不判（用户改 key 后会自动重写）"
    );
    // ⛔ 这条就是「恒真」防线：没注册时我们本来就不写这段，绝不能判漂移
    (D({ vision: V, registered: false, configText: noEnvText, escape: esc }) === false ? ok : fail)(
      "【76】已配插件但 nuphus 未注册 ⇒ **不**判漂移（否则每次启动整份重写 config.toml）"
    );
    // 插件停用/清空 ⇒ 残留段必须清掉；清完就不再命中（收敛，不会每轮重写）
    (D({ vision: undefined, registered: true, configText: withEnvText, escape: esc }) === true
      && D({ vision: { ...V, enabled: false }, registered: true, configText: withEnvText, escape: esc }) === true
      && D({ vision: undefined, registered: false, configText: withEnvText, escape: esc }) === true
      && D({ vision: undefined, registered: false, configText: noEnvText, escape: esc }) === false ? ok : fail)(
      "【76】不需要 env 时（停用/清空/未注册）残留段判漂移；重写后即不再命中（收敛）"
    );
    // 值变了必须判漂移（否则「改完 key 仍然不生效」）
    (D({ vision: { ...V, apiKey: "sk-other" }, registered: true, configText: withEnvText, escape: esc }) === true
      && D({ vision: { ...V, model: "other" }, registered: true, configText: withEnvText, escape: esc }) === true
      && D({ vision: { ...V, baseUrl: "https://y.example/v1" }, registered: true, configText: withEnvText, escape: esc }) === true ? ok : fail)(
      "【76】key / model / baseUrl 任一改动都判漂移（重复不生效的另一种成因）"
    );
  }

  // 密钥不许出现在 developer_instructions（那是发给模型与落 rollout 的文本）
  const di76 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  (!/nuphusVision|NUPHUS_MCP_VISION/i.test(di76) ? ok : fail)(
    "【76】视觉密钥不进 developer_instructions（只写进 config.toml 的 env 表）"
  );
}

// ---------- 【77】输入框下方的 AI 内容提示（09-20 用户要求）----------
// 「在输入框下面空白居中位置加一排字：内容由AI生成，请核实重要信息」。
// 合规类文案最容易被重构顺手删掉/挪走，这里钉住三件事：在、是静态、位置在整列最下方。
{
  const appSrc77 = readAppUi();
  const css77 = readStyles();

  (/<p className="composer-disclaimer">内容由AI生成，请核实重要信息<\/p>/.test(appSrc77) ? ok : fail)(
    "【77】提示文案原样在（用户指定内容，改写/删除都要能被发现）"
  );
  // 静态：不许挂条件（条件渲染 + 动态高度会让 `.composer-wrap` 的 ResizeObserver 反复重申贴底）
  (!/\{[^}]*&&\s*<p className="composer-disclaimer"/.test(appSrc77) ? ok : fail)(
    "【77】提示是静态渲染（不挂在条件里 —— 高度反复变化会触发反复贴底抖动）"
  );
  // 位置 = composer 那一列的最下方：在 suggest-row 之后、</main> 之前
  const iSug = appSrc77.indexOf('className="suggest-row"');
  const iDis = appSrc77.indexOf('className="composer-disclaimer"');
  const iMain = appSrc77.indexOf("</main>");
  (iSug >= 0 && iDis > iSug && iMain > iDis ? ok : fail)(
    "【77】位置在输入框那一列的最下方（suggest-row 之后、</main> 之前）"
  );
  const rule77 = (/\.composer-disclaimer\s*\{([^}]*)\}/.exec(css77) || [])[1] ?? "";
  (rule77 && /text-align:\s*center/.test(rule77) ? ok : fail)(
    "【77】样式规则存在且居中（缺规则会退回左对齐默认值）"
  );
  (!/position:\s*(absolute|fixed)/.test(rule77) ? ok : fail)(
    "【77】提示不脱流（绝对定位会让它不参与列高，居中基准就不是输入框那一列了）"
  );
}

// ---------- 【78】会话改名必须由**本地覆盖**权威（09-20 用户报「导入会话改名不生效」）----------
// 实测根因（隔离 CODEX_HOME + 真实 app-server）：
//   ① `thread/name/set` 返回 `{}` 不报错，但 `thread/list` 里的 `name` **仍是引擎按该会话首条
//      用户消息自动生成的那个**（改完立刻读也没变）⇒ 界面若跟着引擎走，改名永远不显示；
//   ② 旧 `renameThread` 先做本地乐观更新，紧接着 `refreshThreads()` 用引擎那份**整表替换**
//      ⇒ 同一拍就把改动抹掉（观感 = 改了一点反应都没有）。
// 修法与既有 cwdOverrides 同构：用户显式改过的名字由本地持有，并在**所有**引擎回包落地处贴回。
{
  const app78 = readAppUi();
  (/localStorage\.getItem\("thread-name-override-v1"\)/.test(app78) ? ok : fail)(
    "【78】本地名字覆盖表存在（thread-name-override-v1）"
  );
  (/const rememberThreadName = useCallback/.test(app78) && /const effectiveThreadName = useCallback/.test(app78) ? ok : fail)(
    "【78】有 rememberThreadName / effectiveThreadName（唯一写入点 + 唯一读取口径）"
  );
  // 覆盖必须贴在**每一处**引擎回包落地处，漏一处就会「刷新一下名字弹回去」
  const listSites = (app78.match(/withNameOverride\(withCwdOverride\(entry\)\)/g) || []).length;
  (listSites === 2 ? ok : fail)(
    `【78】两处 thread/list 入口都贴了名字覆盖（实际 ${listSites} 处 —— 漏一处刷新就回退）`
  );
  (/withNameOverride\(freshThread\)/.test(app78) ? ok : fail)(
    "【78】新建/导入会话本地落地时也贴覆盖（导入建的会话走的正是这条）"
  );
  (/withNameOverride\(loadedRaw\)/.test(app78) ? ok : fail)(
    "【78】resume 回包也贴覆盖（打开会话时顶栏标题才不会回退）"
  );
  // 写入点在乐观更新之前：引擎那份不可靠，本地必须先落
  const rn = app78.indexOf("async function renameThread");
  const body = rn >= 0 ? app78.slice(rn, rn + 1600) : "";
  (body && /rememberThreadName\(id, name\);[\s\S]{0,260}?setThreads\(\(current\) => current\.map\(applyName\)\)/.test(body) ? ok : fail)(
    "【78】renameThread 先落本地覆盖再做乐观更新（顺序反了就会被刷新覆盖）"
  );
  // 不许回退成「靠引擎回包显示」：改名后必须仍然调 refreshThreads（靠覆盖兜住），
  // 且失败提示不得说成「重命名失败」（本地已生效，说失败会让用户以为白改）
  (/已改名（引擎侧未同步：\$\{engineError\.message\}）/.test(body) ? ok : fail)(
    "【78】引擎侧同步失败时的措辞是「已改名（引擎侧未同步…）」而不是「重命名失败」"
  );
}

// ---------- 【79】折叠头不再显示「N 项失败」文字（09-20 用户明令）----------
// 用户原话：「把那个折叠线上后面的那个几项失败文字删了，这个不要」。
// 两条一起守：① 文字不许回来；② **失败信号本身不能被顺手删掉**（保留左侧小圆点）。
{
  const app79 = readAppUi();
  const css79 = readStyles();
  (!/wb-fold-failed/.test(app79) && !/\{failedCount\}\s*项失败/.test(app79) ? ok : fail)(
    "【79】折叠头不再渲染「N 项失败」文字（用户要求删除，别再回退）"
  );
  (!/\.wb-fold-failed\s*\{/.test(css79) ? ok : fail)(
    "【79】配套样式 .wb-fold-failed 已随文字一起删掉（不留死代码）"
  );
  (/wb-fold-dot \$\{failedCount \? "error"/.test(app79) ? ok : fail)(
    "【79】失败信号保留在左侧小圆点（删文字 ≠ 删掉「这轮有失败」的表达）"
  );
}

// ---------- 【80】审批提醒口径：只留侧栏「需审批」徽标 + 审批永不进通知中心（09-21 用户定稿）----------
// 用户先问「不会被收纳到通知图标里面去吧，千万不能被收进去」；我做了「跨会话待审批浮层」，
// 用户看过后否掉：「你这个还是不要加，不好看，bug 太多了，就之前正常左侧侧边栏提醒需审批类似就行」
// ⇒ 定稿口径 = **提醒入口只有侧栏徽标（threadAttention）+ 当前会话的审批卡**，不许再加第二处。
{
  const app80 = readAppUi();
  const css80 = readStyles();
  // ① 浮层已按用户要求回滚，别再回来。
  // ⛔ 负向断言必须走 codeOnly：本仓库习惯在注释里写「某写法已删除/别再恢复」，按原文匹配
  //    会把注释里提到 approval-elsewhere 当成它还在 → 假红（见 codeOnly 的说明，09-18 踩过三次）。
  (!/approval-elsewhere/.test(codeOnly(app80)) && !/approval-elsewhere/.test(codeOnly(css80)) ? ok : fail)(
    "【80】跨会话待审批浮层已回滚（用户 09-21 明确不要第二处提醒入口，只留侧栏「需审批」徽标）"
  );
  // ② 侧栏徽标这条既有口径必须在（用户认可的就是它，别顺手删掉）
  (/threadAttention/.test(app80) && /需审批/.test(app80) && /\.thread-attention-badge/.test(css80) ? ok : fail)(
    "【80】侧栏「需审批 / 需选择 / 需确认」徽标仍在（用户认可的提醒口径）"
  );
  // ③ setNotice = 通知中心唯一入账通道。审批类文案一旦走它，就会被收进通知图标（用户明确不要）
  const noticeCalls = app80.split(/\r?\n/).filter((line) => /setNotice\(/.test(line) && !/const setNotice|setNotice = /.test(line));
  const leaks = noticeCalls.filter((line) => /审批|批准|requestApproval|requestUserInput|elicitation/i.test(line));
  (leaks.length === 0 ? ok : fail)(
    `【80】审批类文案不得走 setNotice（= 不进通知中心）：命中 ${leaks.length} 处${leaks.length ? " → " + leaks[0].trim().slice(0, 90) : ""}`
  );
  // ④ 通知中心的入账条件：仍只认「别的会话产生的通知」，不许被改成什么都收
  (/const belongsToOtherThread = Boolean\(threadId && threadId !== threadRef\.current\?\.id\)/.test(app80) ? ok : fail)(
    "【80】通知中心入账条件未放宽（仍只收「别的会话」的通知）"
  );
}

// ---------- 【81】切主题必须覆盖「所有窗口」的原生外观（09-21 用户实测：独立窗口深色下窗口钮看不见）----------
// 症状：独立会话窗口右上角三个系统钮「看不见但能点」。根因：theme:apply 只设了 mainWindow 的
// titleBarOverlay，独立窗口创建时写死浅色符号色且再没更新 ⇒ 深色顶栏上近黑符号。
{
  const main81 = readMainSource();
  (/function applyWindowChrome\(dark: boolean\)/.test(main81) ? ok : fail)(
    "【81】存在 applyWindowChrome（主题 → 窗口原生外观的唯一入口）"
  );
  // 09-21 主进程按域拆分：窗口集合已收敛到 electron/features/window-bus（allBusWindows() =
  // 主窗口 + 全部独立弹窗，单一权威）。判据语义不变：切主题必须遍历**所有**窗口。
  (/(\[mainWindow, \.\.\.popoutWindows\]|allBusWindows\(\))/.test(main81) ? ok : fail)(
    "【81】切主题遍历「主窗口 + 全部独立窗口」（只改 mainWindow ⇒ 独立窗口深色下窗口钮看不见）"
  );
  (!/mainWindow\?\.setTitleBarOverlay/.test(main81) ? ok : fail)(
    "【81】不再单独给 mainWindow 设标题栏 overlay（旧写法正是漏掉独立窗口的原因）"
  );
  (!/symbolColor:\s*"#1b1b1a"/.test(main81) ? ok : fail)(
    "【81】窗口创建处不得写死浅色符号色（深色模式下新开的独立窗口会立刻复现「看不见但能点」）"
  );
  (/已给 \$\{targets\.length\} 个窗口下发标题栏符号色/.test(main81) ? ok : fail)(
    "【81】下发后打日志（含覆盖窗口数 + 已下发符号色）——⛔ 本版 Electron 没有 getTitleBarOverlay 读回接口，别写它（TS2551 会直接让构建失败）"
  );
  (!/getTitleBarOverlay\s*\(/.test(main81) ? ok : fail)(
    "【81】不**调用**不存在的 getTitleBarOverlay（本版 Electron 无此 API；注释里提到不算，只认带括号的调用）"
  );
}

// ---------- 【82】内置的第三方写作技能：内容必须与上游逐字一致（09-21 用户：「对我们有帮助的都内置安装好」）----------
// 内置三个 MIT 许可的写作 / 输出风格技能（humanizer / no-ai-slop / i-have-adhd），原文**逐字**进 builtin-skills.ts，
// 随启动写进 codexHome/skills/。来源、许可与内置当天的 sha 记在 THIRD_PARTY_NOTICES.md。
// ⛔ 为什么必须钉 sha：内置等于**我们替用户分发别人的内容**。一旦有人在常量里手改（或转义写坏），
//    用户拿到的就不是上游那份，而界面上完全看不出区别 —— 只有逐字比对能发现。
{
  const bs82 = readBuiltinSkillsSource();
  // 反转义 = 转义的**逆序**：先 \${ → ${ ，再 \` → ` ，最后 \\ → \
  //  ⛔ 顺序写错会把 ${token} 还原成带反斜杠的形态（09-21 实测：差 1 字节，差点误判成内容不一致）
  const unesc82 = (s) => s.replace(/\\\$\{/g, "${").replace(/\\`/g, "`").replace(/\\\\/g, "\\");
  const body82 = (cname) => {
    const head = `const ${cname} = \``;
    const i = bs82.indexOf(head);
    if (i < 0) return null;
    const start = i + head.length;
    const end = bs82.indexOf("`;", start); // 正文里的反引号都已转义，第一个裸 "`;" 就是结尾
    return end < 0 ? null : unesc82(bs82.slice(start, end));
  };
  // 字节数与 sha256 = 内置当天的上游内容（与 THIRD_PARTY_NOTICES.md 同源）
  const EXPECT82 = [
    // 09-24 发版基线切换（巨石→重构版）时实测更新：主仓库 v0.0.26 系列期间对三个技能文案做过
    // 有意更新（29102/10950/7349 为已随 0.0.26-b 发布给用户的版本），副本建基线时快照较旧。
    // 口径 = readModuleWithDir("electron/builtin-skills") 聚合抽常量反转义（.workbuddy/tmp/hash-skills.cjs 同法）。
    ["humanizer", "HUMANIZER_SKILL", 29102, "c39879e29a7fe8a9e4bcd0ef66339589ba0e85e3893521ecb0d96a277761467c"],
    ["no-ai-slop", "NO_AI_SLOP_SKILL", 10950, "1c1abfa4e447e2e96f02832cc3d31d8b298184027aab1bb4cf5aa33179dc2f81"],
    ["i-have-adhd", "I_HAVE_ADHD_SKILL", 7349, "37f3ff72c0514f0119bd43753030e9c916abf10ef0c358fe849c3b4ea3ff6c88"],
  ];
  for (const [dir, cname, bytes, sha] of EXPECT82) {
    const body = body82(cname);
    if (!body) { fail(`【82】内置技能 ${dir} 的常量 ${cname} 不存在（entries 指向了不存在的常量）`); continue; }
    const gotBytes = Buffer.byteLength(body, "utf8");
    const gotSha = createHash("sha256").update(body, "utf8").digest("hex");
    (gotBytes === bytes ? ok : fail)(`【82】${dir} 内容字节数与内置时一致（${gotBytes}${gotBytes === bytes ? "" : ` ≠ ${bytes}`}）`);
    (gotSha === sha ? ok : fail)(
      `【82】${dir} 内容 sha256 与上游一致${gotSha === sha ? "" : `（现 ${gotSha.slice(0, 12)}… / 内置时 ${sha.slice(0, 12)}…；若确为有意更新，请同步本表与 THIRD_PARTY_NOTICES.md）`}`
    );
    const fmName = (body.match(/^name:\s*(.+)$/m) || [, ""])[1].trim();
    (fmName === dir ? ok : fail)(`【82】${dir} 目录名与 frontmatter 的 name 一致（实际 "${fmName}"；不一致会出现同名两条技能）`);
  }
  (/\["humanizer", HUMANIZER_SKILL\],[\s\S]{0,180}?\["no-ai-slop", NO_AI_SLOP_SKILL\],[\s\S]{0,180}?\["i-have-adhd", I_HAVE_ADHD_SKILL\],/.test(bs82) ? ok : fail)(
    "【82】三个技能都进了 ensureBuiltinSkills 的 entries（只写常量不进 entries = 永远不落盘）"
  );
  (/\["document-convert", DOC_CONVERT_SKILL\],/.test(bs82) ? ok : fail)(
    "【82】document-convert 在 entries 里（教模型用内置 markitdown 读 PDF/Word/Excel/PPT 附件）"
  );
  // 用户明确要求「codex 自己也可以下载」⇒ 技能里必须给出**带国内镜像**的 pip 命令
  (/pypi\.tuna\.tsinghua\.edu\.cn\/simple "markitdown\[pdf,docx,pptx\]" openpyxl/.test(bs82) ? ok : fail)(
    "【82】document-convert 技能给出「Codex 自己装」的清华镜像命令（用户要求 codex 也能自己下载）"
  );
  // ⛔ 安全约束：i-have-adhd 会重塑**全部**输出的写法 ⇒ 必须保持「只有用户显式调用才生效」。
  //    引擎认这个字段（二进制里有 disable-model-invocation / disable_model_invocation 两个名字），别删。
  (/^disable-model-invocation: true$/m.test(codeOnly(bs82)) ? ok : fail)(
    "【82】i-have-adhd 保留 disable-model-invocation: true（删掉它 = 模型可能自动把全部输出改成 ADHD 风格）"
  );
}

// ---------- 【83】文档转换（markitdown）：内置，但体积必须可控（09-21 用户定稿）----------
// 用户原话：「markitdown 这个可以内置，其他太大的丢到开发工具里面，配置好国内镜像下载源」。
// 落法：装进**内置 Python**（不是随包分发源码），默认随 Python 装好 = 内置；
//  「开发工具」页留一张卡（老用户补装 / 修复，单独点不会重装 Python）；下载走清华 pip 镜像。
// ⛔ 为什么死死盯住体积：`markitdown[all]` 实测 **273 MB+**，含 Azure 云端文档智能 SDK 与
//    音频 / YouTube 依赖；`[xlsx]` extra 会拉进 pandas(59MB)+numpy(31MB)。而转 xlsx 只需要
//    openpyxl(1.8MB)。一旦有人图省事写回 `[all]`，每个用户的安装体积会翻三倍且毫无收益。
{
  const ir83 = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  const ir83c = codeOnly(ir83); // 注释里提到 [all]/[xlsx] 不算命中（本仓库踩过注释假红的坑）
  const main83 = readMainSource();

  (/DOC_PACKAGES = \['"markitdown\[pdf,docx,pptx\]"', "openpyxl"\]/.test(ir83c) ? ok : fail)(
    "【83】只装 markitdown[pdf,docx,pptx] + openpyxl（精简组合）"
  );
  (!/markitdown\[all\]/.test(ir83c) ? ok : fail)(
    "【83】没用 markitdown[all]（实测 273 MB+，含 Azure 云端 SDK 与音频依赖）"
  );
  (!/markitdown\[[^\]]*xlsx/.test(ir83c) ? ok : fail)(
    "【83】没用 [xlsx] extra（会拉进 pandas+numpy ≈ 90 MB，而转 xlsx 只需 openpyxl）"
  );
  // ⛔ 按需、不内置：DOC_PACKAGES **不得**出现在默认 pip 安装清单里 —— 否则**每个**装 Python 的用户
  //    都要付这约 120 MB（09-21 用户定稿：有国内镜像 ⇒ 按需下载即可）。
  const docJoined = (ir83c.match(/\[PIP_PACKAGES, \.\.\.DOC_PACKAGES\]\.join/g) || []).length;
  (docJoined === 0 ? ok : fail)(
    `【83】文档转换**没有**并入默认 pip 安装清单（按需下载不内置；实际 ${docJoined} 处，应为 0）`
  );
  // 老用户补装入口：单独跑 `install-runtimes.cjs markitdown`（不重装 Python）
  (/if \(want\("markitdown"\)\) await installDocTools\(pythonDir\);/.test(ir83c) ? ok : fail)(
    "【83】开发工具卡片有独立补装入口（want(\"markitdown\")），不会顺手重装 Python"
  );
  // 默认 pip 安装的 skip 判定只看 fastapi：markitdown 是按需项，不该被它拖着一起装
  (/const marker = path\.join\(pythonDir, "Lib", "site-packages", "fastapi"\);/.test(ir83c) ? ok : fail)(
    "【83】默认 pip 安装的 skip 判定只看 fastapi（markitdown 是按需项，不随它一起装）"
  );
  // 平台差异：site-packages 路径不能写死 Python 版本号（mac 是 lib/pythonX.Y/site-packages）
  (/function pythonSitePackages\(pythonDir\)/.test(ir83c) ? ok : fail)(
    "【83】install-runtimes 有 pythonSitePackages helper（不写死 Python 版本号）"
  );
  // ⛔ Python 缺失时必须**抛错**，不能静默 return：脚本 EXIT=0 ⇒ 界面显示「安装完成」，
  //    而用户其实什么都没装上（09-21 代码审查抓到的 UX 缺口）。
  (/if \(!fs\.existsSync\(py\)\) \{\s*\n\s*throw new Error\(/.test(ir83c) ? ok : fail)(
    "【83】Python 缺失时抛错（静默跳过会让界面误报「安装完成」而实际没装）"
  );

  // main.ts 侧：卡片要真的出现在「开发工具」页，且装上之后状态能正确显示
  (/"openssl" \| "markitdown";/.test(main83) ? ok : fail)("【83】DevRuntimeId 收录 markitdown");
  (/markitdown: \{ name: "文档转换（markitdown）"/.test(main83) ? ok : fail)(
    "【83】「开发工具」页有「文档转换（markitdown）」卡片"
  );
  (/if \(id === "markitdown"\) \{[\s\S]{0,140}?pythonSiteDir\(path\.join\(root, "python"\)\)/.test(main83) ? ok : fail)(
    "【83】标记 markitdown 有专属「装没装」判定（pip 包路径含 Python 版本号，不能走 marker）"
  );
  // ⛔ 最危险的一条：卸载路径。marker 首段推导会得到 tools/python —— 卸载文档转换会把整个 Python 删光
  (/if \(id === "markitdown"\) \{[\s\S]{0,160}?pythonSiteDir\(path\.join\(toolsRoot\(\), "python"\)\)/.test(main83) ? ok : fail)(
    "【83】卸载只删 markitdown 包目录（不按 marker 首段推 → 否则会删掉整个 Python 运行时）"
  );
  // 卡片的体积提示必须与实测同量级（写小了会误导用户点）
  (/markitdown[\s\S]{0,400}?size: "约 \d+ MB"/.test(main83) ? ok : fail)(
    "【83】卡片标注了体积（用户点之前要知道要下多大）"
  );
}

// ---------- 【84】生图结果绝不内联 base64 进对话（09-21「工具输出裁剪」）----------
// 取证（不是预防性设计）：09-20 那场会话里**单条工具输出 = 3.03 MB**，base64 片段长 3,177,992
// 字符，而且它进对话历史后被**每轮重发**。根因两层，都要守（任一处回退就复发）：
//   ① `electron/main.ts`：生图网关多只回 `b64_json`，我们把它拼成 data URL 回给渲染层；
//   ② `src/App.tsx`：渲染层把它拼进**工具返回文本**（那才是进历史的地方）。
// 真行为断言在 `scripts/verify-image-plugin.mjs`（vm 里真跑 generateImageWith），已挂上 check 链。
{
  const main84 = readMainSource();
  const app84 = readAppUi();

  (/async function persistGeneratedImage\(url: string\)/.test(main84) ? ok : fail)(
    "【84】有 persistGeneratedImage（生图结果落盘，而不是把 base64 回传）"
  );
  (/persistGeneratedImage[\s\S]{0,700}?app\.getPath\("userData"\), "images"/.test(main84) ? ok : fail)(
    "【84】落盘目录是 <userData>/images（与命令行路径 harness-media.mjs 同目录，不造第二套落点）"
  );
  (/return \{ path, url: \/\^https\?:\/i\.test\(url\) \? url : "" \};/.test(main84) ? ok : fail)(
    "【84】generateImageWith 回的是 { path, url }，且 url 仅真托管地址才有（data URL 绝不回传）"
  );
  (/const text = result\.path[\s\S]{0,300}?: result\.url/.test(app84) ? ok : fail)(
    "【84】生图工具返回文本优先用本地路径，托管地址只作兜底"
  );
  (!/\+\s*result\.url/.test(app84) ? ok : fail)(
    "【84】App 侧不得再把 result.url 直接拼进返回文本（一拼就有 MB 级 base64 进对话历史）"
  );
  // 识图工具的**入参**同样要劝退 data URL：模型若填了内联 base64，一样几 MB 进历史
  (/imageUrl[\s\S]{0,240}?不要传 data URL/.test(app84) ? ok : fail)(
    "【84】describe_image 的 imageUrl 参数描述明确劝退 data URL"
  );
  // 识图工具也要能吃**本地路径** —— 引擎消息里的图片就是本地文件路径，模型照用法传过来时
  // 上游会 400「invalid image」。命令行那条路径（harness-media.mjs 的 vision 分支）早就做对了，
  // 主进程侧曾经没有 ⇒ 同一件事两条路径行为不一致（最难查的一类问题）。
  (/async function toImageSource\(ref: string\)/.test(main84) ? ok : fail)(
    "【84】有 toImageSource（本地图片路径读成 data URL，与命令行路径 harness-media 同口径）"
  );
  (/image_url: \{ url: await toImageSource\(input\.imageUrl\) \}/.test(main84) ? ok : fail)(
    "【84】describe_image 真的走了 toImageSource（否则模型传本地路径必然 400）"
  );
  const pkg84 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  (/verify-image-plugin/.test(String(pkg84.scripts?.check ?? "")) ? ok : fail)(
    "【84】verify-image-plugin（b64 必须落盘的行为断言）挂在 npm run check 链上"
  );
}

// ---------- 【85】能力选型表：唯一来源 + 「现在走哪条」的真判定（09-21）----------
// 背景：同一件事往往有多个后端（浏览器自动化、看图、生图…），选型规则原先散在技能文案、工具描述、
// 代码注释里 —— 用户查不到"现在实际走哪条"，同一个判据还会被写第二遍。现在收进
// electron/capability-registry.ts（纯函数，UI 与预检共用）。
// ⛔ 断言必须**能被反转**（总闸一关就必须没有活动后端）—— 恒真的断言等于没写。
{
  const req85 = createRequire(import.meta.url);
  let reg = null;
  try { reg = req85(join(ROOT, "dist-electron", "capability-registry.js")); } catch { reg = null; }
  (reg ? ok : fail)("【85】dist-electron/capability-registry.js 可加载（能力选型的唯一来源）");

  if (reg) {
    const caps = reg.CAPABILITIES || [];
    const ids = caps.map((c) => c.id);
    (caps.length >= 6 && new Set(ids).size === ids.length ? ok : fail)(
      `【85】能力表 ${caps.length} 条且 id 不重复（${ids.join("/")}）`
    );
    (caps.every((c) => c.backends.length > 0 && c.backends.every((b) => b.id && b.label && b.why)) ? ok : fail)(
      "【85】每个能力都有后端，且每个后端都写明「为什么排这个位置」（排序理由不许留空）"
    );

    const base = {
      platform: "win32", arch: "x64",
      desktopSwitch: true, browserSwitch: true,
      nuphusAvailable: true, nuphusVisionEnv: true,
      visionPlugin: true, imagePlugin: true,
      playwrightCli: false, markitdown: false,
    };
    const pick = (rows, id) => rows.find((r) => r.id === id) || {};
    const alt = (rows, capId, altId) => (pick(rows, capId).alternatives || []).find((a) => a.id === altId) || {};

    const allOn = reg.resolveCapabilities(base);
    (pick(allOn, "browser").activeId === "nuphus-browser" && pick(allOn, "desktop").activeId === "nuphus-desktop" ? ok : fail)(
      "【85】总闸开着时，浏览器与桌面自动化都走内置 MCP（nuphus）"
    );
    (pick(allOn, "vision").activeId === "nuphus-vision" ? ok : fail)(
      "【85】视觉 env 已下发时，看图首选 nuphus desktop_vision（BYOK）"
    );

    // 反转用例：总闸关掉 ⇒ **依赖 nuphus 的后端**全部不可用（掩码是硬阻断，不是提示词约束）。
    // ⛔ 别把「总闸关掉」误写成「视觉彻底不可用」：describe_image 走的是**内置视觉插件**
    //    （渲染层 dynamicTool → 主进程直接请求视觉 API，不经 nuphus），所以它不受总闸影响。
    //    我第一版断言就写错了这个假设，被这条"能反转"的断言当场抓出来。
    const allOff = reg.resolveCapabilities({ ...base, desktopSwitch: false, browserSwitch: false });
    (pick(allOff, "browser").activeId === null
      && pick(allOff, "desktop").activeId === null
      && alt(allOff, "vision", "nuphus-vision").available === false
      && alt(allOff, "vision", "local-ocr").available === false
      && pick(allOff, "vision").activeId === "describe-image" ? ok : fail)(
      "【85】总闸关掉后依赖 nuphus 的后端全不可用，而 describe_image（不经 nuphus）依旧可用"
    );

    // 视觉回退链：env 未下发 → describe_image；插件也没配 → 本地 OCR
    const noEnv = reg.resolveCapabilities({ ...base, nuphusVisionEnv: false });
    (pick(noEnv, "vision").activeId === "describe-image" ? ok : fail)(
      "【85】视觉 env 未下发时退到 describe_image（不是仍报 desktop_vision 可用）"
    );
    const noPlugin = reg.resolveCapabilities({ ...base, nuphusVisionEnv: false, visionPlugin: false });
    (pick(noPlugin, "vision").activeId === "local-ocr" ? ok : fail)(
      "【85】视觉插件也没配时退到本地 OCR（无需 key 的免费路径）"
    );

    // Intel Mac 没有本地 OCR 的平台二进制（ONNX 已放弃 osx-x64）；Apple Silicon 必须相反
    const intelMac = reg.resolveCapabilities({ ...base, platform: "darwin", arch: "x64", nuphusVisionEnv: false, visionPlugin: false });
    (pick(intelMac, "vision").activeId === null && alt(intelMac, "vision", "local-ocr").available === false ? ok : fail)(
      "【85】Intel Mac 上本地 OCR 判为不可用，视觉能力整体判为无可用后端"
    );
    const armMac = reg.resolveCapabilities({ ...base, platform: "darwin", arch: "arm64", nuphusVisionEnv: false, visionPlugin: false });
    (pick(armMac, "vision").activeId === "local-ocr" ? ok : fail)(
      "【85】Apple Silicon 同条件下本地 OCR 可用（与 Intel Mac 结论相反 ⇒ 平台判据真的生效）"
    );

    // 没装的后端不许被报成「可用」
    (alt(allOn, "browser", "playwright-cli").available === false && pick(allOn, "documents").activeId === null ? ok : fail)(
      "【85】没装的兜底后端判为「未就绪」；没装 markitdown 时文档转换判为无可用后端"
    );
    const withCli = reg.resolveCapabilities({ ...base, playwrightCli: true, markitdown: true });
    (alt(withCli, "browser", "playwright-cli").available === true && pick(withCli, "documents").activeId === "markitdown" ? ok : fail)(
      "【85】装上以后同两条又变「就绪」（与上一条互为反转）"
    );
  }

  // 唯一来源约束：界面只渲染快照、主进程采集判据复用现有来源（不另读一遍设置/插件）
  const app85 = readAppUi();
  (/capabilitiesSnapshot\(\)/.test(app85) ? ok : fail)(
    "【85】界面走 capabilities:snapshot 取快照（不是自己拼一套判据）"
  );
  const main85 = readMainSource();
  (/devInstructionsInput\(\)[\s\S]{0,500}?nuphusVisionEnv\(devInput\.nuphusVision\)\.length > 0/.test(main85) ? ok : fail)(
    "【85】主进程采集判据复用 devInstructionsInput（总闸与视觉配置的唯一来源，不另读一遍）"
  );
}

// ---------- 【86】配置面安全扫描：技能内容 / MCP 配置 / 明文密钥（09-21）----------
// 为什么需要：我们从外部引入了内容（3 个第三方写作技能**逐字内置** + markitdown 的使用说明），
// 而**技能文件是 prompt injection 的天然载体** —— 模型会把技能内容当真指令读。
// 这类问题不会自己暴露：症状是"模型行为有点怪"，没人会归因到技能内容。
//
// ⛔ 责任边界（它决定了断言怎么写）：**只硬断言我们自己引入的内容**（内置技能常量）。
//    用户侧技能/配置里的命中一律只告警 —— 用户装的东西不该让我们的构建变红；
//    但它必须**看得见**（扫了不报等于没扫）。完整报告走 `npm run scan:config`。
{
  let scan = null;
  try { scan = await import("../../scripts/lib/config-scan.mjs"); } catch { scan = null; }
  (scan ? ok : fail)("【86】配置面扫描器可加载（scripts/lib/config-scan.mjs）");

  if (scan) {
    const st = scan.selfTest();
    (st.ok ? ok : fail)(
      st.ok
        ? "【86】扫描器自证通过（每条规则正例必中；良性文本不被误报成 critical/high）"
        : `【86】扫描器自证失败：${st.failures.slice(0, 3).join("；")}（恒绿的扫描器比没有更糟）`
    );

    const fsMod = await import("node:fs");
    const pathMod = await import("node:path");
    const userData = scan.defaultUserDataDir({ homedir: homedir() });
    const { findings, scanned } = scan.scanWorkspace({ root: ROOT, userData, fs: fsMod, path: pathMod });

    // ⛔ 防空扫假绿：目标数太少说明路径推导错了（那时"零命中"毫无意义）
    (scanned.length >= 7 ? ok : fail)(
      `【86】扫描目标 ${scanned.length} 个（≥7：内置技能常量 + 用户侧技能与配置）`
    );

    /* ⛔ 09-22 起技能常量搬到了 electron/builtin-skills/** ⇒ 只认基文件路径会让内置技能命中被误判成「用户侧」（【86】转成 warn，失去阻断力）。 */
    const isBuiltin = (f) => /^electron\/builtin-skills(\/|\.ts#)/.test(String(f.source));
    const hard = findings.filter((f) => isBuiltin(f) && (f.severity === "critical" || f.severity === "high"));
    (hard.length === 0 ? ok : fail)(
      "【86】**内置技能**零 critical/high（我们自己引入的内容）" +
        (hard.length ? " → " + hard.slice(0, 3).map((f) => `${f.ruleId}@${f.source}:${f.line}`).join("；") : "")
    );

    const userSide = findings.filter((f) => !isBuiltin(f));
    if (userSide.length) {
      const n = (s) => userSide.filter((f) => f.severity === s).length;
      warn(
        `【86】用户侧技能/配置命中 ${userSide.length} 条（critical ${n("critical")} / high ${n("high")} / medium ${n("medium")}）——` +
          `不阻断构建，但值得人眼看一遍（npm run scan:config 出完整报告）：` +
          userSide.slice(0, 4).map((f) => `${f.ruleId}@${f.source}:${f.line}`).join("；")
      );
    } else {
      ok("【86】用户侧技能/配置零命中");
    }
  }
}

// ---------- 【87】计划可编辑构件（09-21 用户点名）----------
// 背景：计划原来只是**只读**渲染（ActionCard 里的 Markdown）。现在条目可勾选/改字/增删，
// 改完「交给 Codex」把它作为一条用户消息发回。
// ⛔ 语义边界：这**不是**"直接改引擎里的计划"（计划的权威状态在模型侧，我们传不进去），
//    而是「用户改了计划 → 让模型按新的执行」—— 编造一个"已同步到引擎"的假象比不做更糟。
{
  let steps87 = null;
  try { steps87 = await import("../../src/lib/plan-steps.mjs"); } catch { steps87 = null; }
  (steps87 ? ok : fail)("【87】计划条目解析器可加载（src/lib/plan-steps.mjs —— 纯函数，预检跑真断言而不是 grep）");

  if (steps87) {
    const engineText = "先看现状。\n\n- [ ] 改 A\n- [x] 改 B\n- [ ] 改 C";
    const parsed = steps87.parsePlan(engineText);
    (parsed.steps.length === 3 && parsed.steps[0].done === false && parsed.steps[1].done === true ? ok : fail)(
      "【87】能解析引擎真实格式（`- [ ]` / `- [x]`）并读出完成状态"
    );
    (parsed.intro === "先看现状。" ? ok : fail)(
      "【87】第一条条目之前的说明行归入 intro（不参与编辑、原样展示）"
    );
    (steps87.serializePlan(parsed.intro, parsed.steps) === engineText ? ok : fail)(
      "【87】序列化往返幂等（用户没改就不该产生差异 —— 否则「交给 Codex」会凭空改写计划）"
    );
    const messy = steps87.parsePlan("- [ ] 一\n收尾补充说明\n1. 第二\n2. 第三");
    (messy.steps.length === 3 && messy.steps[0].text.includes("收尾补充说明") ? ok : fail)(
      "【87】条目夹带的说明行并入上一条（丢内容比格式难看严重得多）；有序列表也认"
    );
    (steps87.parsePlan("").steps.length === 0 && steps87.parsePlan("只有一段没有条目的话").steps.length === 0 ? ok : fail)(
      "【87】无条目时不凭空造条目（空文本 / 纯段落）"
    );

    const app87 = readAppUi();
    (/<PlanEditor[\s\S]{0,220}?onSubmit=/.test(app87) ? ok : fail)(
      "【87】plan 分支渲染 PlanEditor 并接上 onSubmit（交回路径）"
    );
    (!/className="action-plan"/.test(app87) ? ok : fail)(
      "【87】不再渲染只读的 action-plan（两套并存会让用户改了看不到效果）"
    );
    const css87 = readStyles();
    (/\.plan-editor \{/.test(css87) && !/\.action-plan \{|\.action-card \.action-plan \{/.test(css87) ? ok : fail)(
      "【87】有 .plan-editor 样式，且旧的 .action-plan 死样式已清理（否则预检【3】会报未覆盖类）"
    );
    const editor87 = readFileSync(join(ROOT, "src", "components", "PlanEditor.tsx"), "utf8");
    (/from "\.\.\/lib\/plan-steps\.mjs"/.test(editor87) && !/export function parsePlan/.test(editor87) ? ok : fail)(
      "【87】组件从 lib 取解析函数（单一来源，别在组件里再实现一份）"
    );
  }

  // 通用结构性守卫（09-21 踩到的）：tsconfig.app.json 是 `allowJs: false`，
  // import 一个没有配套 `.d.mts` 的 `.mjs` 会报 TS7016 —— 而且**只在 build 时才炸**。
  // 项目惯例是每个 src/lib/*.mjs 配一个同名 .d.mts（现有 27 个都齐，这次我新加的漏了）。
  const libFiles87 = readdirSync(join(ROOT, "src", "lib"));
  const missingDts87 = libFiles87.filter((f) => f.endsWith(".mjs") && !libFiles87.includes(`${f.slice(0, -4)}.d.mts`));
  (missingDts87.length === 0 ? ok : fail)(
    `【87】src/lib 下每个 .mjs 都有配套 .d.mts（allowJs=false 下必需）${missingDts87.length ? " → 缺：" + missingDts87.join(", ") : ""}`
  );
  // 真实渲染断言（服务端渲染同一份组件代码）必须挂在 check 链上 —— 否则它只是份没人跑的文档。
  // 背景：真机 e2e 里没能把界面切进一个已有会话（点侧栏行后仍停在欢迎页，属 e2e 驱动问题），
  // 于是"有 plan item 时渲染成什么样"改由这条断言保证（它同时覆盖了 XSS 转义面）。
  const pkg87 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  (/verify-plan-editor/.test(String(pkg87.scripts?.check ?? "")) ? ok : fail)(
    "【87】verify-plan-editor（PlanEditor 真实渲染断言）挂在 npm run check 链上"
  );
}

// ---------- 【88】新鲜上下文的 reviewer：写的人不审自己（09-21 用户点名）----------
// 做法：随应用种入一个内置子智能体（幂等），复用现有委派链路（含防套娃 / 独占锁 / 身份闸），
// **不新造工具** —— 新工具会把那些安全闸重写一遍、还可能绕过去。
{
  const agents88 = readFileSync(join(ROOT, "electron", "builtin-agents.ts"), "utf8");
  const main88 = readMainSource();
  const di88 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");

  (/export const FRESH_REVIEW_ID = "fresh-review"/.test(agents88) ? ok : fail)(
    "【88】内置评审子智能体 id 固定（fresh-review —— 幂等种入依赖它）"
  );
  (/看不到/.test(agents88) && /具体位置/.test(agents88) && /未发现/.test(agents88) ? ok : fail)(
    "【88】提示词保留三条纪律：声明看不到历史 / 只报能定位的问题 / 允许说「未发现」（缺一条就会退化成夸一遍）"
  );
  (/effort: "high"/.test(agents88) ? ok : fail)("【88】审阅 effort 给 high（想清楚再说话，贪快会漏）");
  (/if \(list\.some\(\(agent\) => agent\.id === FRESH_REVIEW_ID\)\) return;/.test(main88) ? ok : fail)(
    "【88】种入幂等（已存在就返回 —— 用户改过提示词或停用过，不许覆盖）"
  );
  (/try \{ await ensureBuiltinReviewer\(\); \} catch/.test(main88) ? ok : fail)(
    "【88】调用包在 try/catch 里（启动链一处裸 await 抛出会掐死整条链）"
  );
  // ⛔ 最关键的一条：指引必须**条件式**。调度是**会话级**开关，而 developer_instructions 是全局的 ——
  // 直接命令"用 agent_invoke"会让没开调度的会话去调不存在的工具，把「没开」误判成「坏了」
  // （BROWSER_INSTRUCTIONS 的注释里记着同款教训）。
  (/IF `agent_invoke` is in your tool list/.test(di88) && /is NOT in your tool list/.test(di88) ? ok : fail)(
    "【88】复审指引是条件式的（先看自己的工具表；没开调度时不许硬调 agent_invoke）"
  );
  // ⛔ 09-21 查清：`agent_invoke` 是 config.toml 里的**全局** MCP 段（`tools/list` 无条件返回，
  //    main.ts 里没有 per-thread 掩码，开关只存在 thread-runtime）⇒「工具表里有没有」区分不出
  //    调度开没开。真实判据落在**调用结果**上（原因含「不持有调度权限」），必须写进指引。
  (/IF `agent_invoke` is in your tool list[\s\S]*不持有调度权限/.test(di88) ? ok : fail)(
    "【88】调度开关的判据落在调用结果上（工具表无差别返回 agent_invoke，当判据会白费回合）"
  );
  (/text \+= REVIEW_INSTRUCTIONS;/.test(di88) ? ok : fail)(
    "【88】复审指引真的被注入（算了常量却没拼进去 = 死代码）"
  );
}

// ---------- 【89】账号管理不变量（09-21）：停用账号永不「生效」+ 删除看得见且有确认 ----------
// 真机事故背景：relay-store.json 的 activeId 指向一个 disabled=true 的账号 ⇒ 中转站卡片同屏
// 显示「使用中 + 已停用 + 当前生效」；根因是 401 自动重登（relayAuthedFetch）调
// writeRelayAccount() 时把 activeId 一并改了 —— 打开中转站页就会对每个账号补 token。
// 判定集中到 electron/relay-accounts.ts（纯函数），这里既跑真断言也盯着接线。
{
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let ra = null;
  try { ra = req(join(ROOT, "dist-electron/relay-accounts.js")); } catch { ra = null; }
  const mainSrc89 = readMainSource();
  const appSrc89 = readAppUi();
  const relayUi89 = appSrc89; // 见 readAppUi()：appSrc89 已含 features/**，无需再手工并集
  if (!ra || typeof ra.normalizeRelayStore !== "function") {
    fail("dist-electron/relay-accounts.js 缺失 —— 账号生效判定无法断言");
  } else {
    const live = { id: "A", baseUrl: "https://api.pptoken.cc", accessToken: "t" };
    const off = { id: "B", baseUrl: "https://ppz123.asia", accessToken: "t", disabled: true };
    const noToken = { id: "C", baseUrl: "https://x.com" };
    ra.isRelayAccountLive(live) && !ra.isRelayAccountLive(off) && !ra.isRelayAccountLive(noToken) && !ra.isRelayAccountLive(null)
      ? ok("★ 可用账号＝有凭据且未停用（停用/无凭据/不存在一律不算）")
      : fail("可用判据不对 —— 停用账号可能被当成生效候选");
    ra.pickRelayActiveId([off, noToken, live]) === "A" && ra.pickRelayActiveId([off]) === null
      ? ok("★ 挑接手账号只从可用账号里挑，一个都没有 → null")
      : fail("挑接手账号会选中停用账号 —— 删账号后可能落到停用账号上");
    ra.normalizeRelayStore({ activeId: "B", accounts: [live, off] }).store.activeId === null
      && ra.normalizeRelayStore({ activeId: "B", accounts: [live, off] }).changed === true
      ? ok("★ 自愈：activeId 指向已停用账号 → 置空并标记落盘（用户实测的坏状态）")
      : fail("自愈失效 —— 「已停用」账号仍会显示成当前生效");
    ra.normalizeRelayStore({ activeId: "A", accounts: [live, off] }).changed === false
      && ra.normalizeRelayStore({ activeId: "A", accounts: [live, off] }).store.activeId === "A"
      ? ok("自愈不误伤正确的 activeId")
      : fail("自愈把正确的 activeId 也清了");
    ra.normalizeRelayStore({ activeId: "ZZ", accounts: [live] }).store.activeId === null
      ? ok("自愈：activeId 指向不存在的账号 → 置空")
      : fail("指向不存在账号的 activeId 没被清");
    // ⛔ 自愈只许改 activeId 这一件事：坏形状条目也要原样留着（读取路径不许删用户数据）
    (() => {
      const messy = { activeId: "A", accounts: [live, { email: "no-id@x.com" }, null] };
      const out = ra.normalizeRelayStore(messy);
      return out.store.accounts.length === 2 && out.store.activeId === "A";
    })()
      ? ok("自愈不剔条目（缺 id 的坏条目原样保留，只改 activeId）")
      : fail("自愈把条目删了 —— 读取路径丢用户数据");
    ra.relayProviderIdOf("https://api.pptoken.cc") === "relay-pptoken" && ra.relayProviderIdOf("https://ppz123.asia") === "relay-ppz123" && ra.relayProviderIdOf("不是URL") === ""
      ? ok("★ 中转站供应商命名单一来源（剥 api. 前缀 → 取首段 → 小写）")
      : fail("relay 供应商命名规则变了 —— 停用账号/正反向联动都会失配");
    /writeRelayAccount\(account, \{ activate: false \}\)/.test(mainSrc89) && /if \(options\.activate !== false\) store\.activeId = id;/.test(mainSrc89)
      ? ok("★ 401 自动重登只补凭据、不劫持 activeId（真机事故根因）")
      : fail("401 重登仍会改 activeId —— 打开中转站页就可能把停用账号顶成生效");
    /normalizeRelayStore</.test(mainSrc89) && /pickRelayActiveId\(store\.accounts\)/.test(mainSrc89)
      ? ok("★ readRelayStore 接自愈 + 删账号后按可用性挑接手者")
      : fail("数据层自愈 / 接手者判定没接上");
    !/store\.activeId = store\.accounts\[0\]/.test(mainSrc89)
      ? ok("不再有「activeId = accounts[0]」这种不看停用状态的赋值")
      : fail("仍有按索引取生效账号的写法 —— 会落到停用账号上");
    !/window\.codex\.relayLogout|relayLogout:/.test(relayUi89) && !/relayLogout/.test(readFileSync(join(ROOT, "electron", "preload.ts"), "utf8")) && !/ipcMain\.handle\("relay:logout"/.test(mainSrc89)
      ? ok("★ 「退出登录」（按 activeId 删账号的隐藏删除入口）已整链移除：handler / preload / 调用点")
      : fail("relay:logout 还留在某处（handler 或 preload 桥）—— 看着 A 的面板可能删掉 B");
    !/if \(!a\.active\) await switchAccount\(a\.id\)/.test(relayUi89)
      ? ok("★ 点卡片/「管理」不再自动切换生效账号（用户实测「点击管理直接生效了」）")
      : fail("openManage 仍会自动切换账号 —— 看一眼余额就改模型配置并重启引擎");
    (relayUi89.match(/<Trash2 size=\{13\} \/>删除<\/button>/g) || []).length >= 3
      ? ok("★ 删除入口都带文字（中转站卡片 / 中转站面板 / OpenAI 卡片，不再是光秃秃的图标）")
      : fail("还有删除入口是纯图标 —— 用户找不到（09-21 反馈）");
    (relayUi89.match(/openAppConfirm\(\s*"删除/g) || []).length >= 2
      ? ok("★ 删除前二次确认（openAppConfirm，文案写明会失去什么）")
      : fail("删除没有二次确认 —— 一点就没了");
    /const live = Boolean\(a\.active\) && !a\.disabled;/.test(relayUi89)
      ? ok("卡片「使用中/当前生效」判据同时要求未停用（与数据层同源）")
      : fail("卡片仍只看 active —— 停用账号会显示成当前生效");
    /ipcMain\.handle\("relay:overview", async \(_e, id\?: string\)/.test(mainSrc89) && /relayOverview\(account\?\.id\)/.test(relayUi89)
      ? ok("★ 管理面板按「被点开的账号」读余额/套餐/密钥（不再一律读生效账号）")
      : fail("面板仍读生效账号 —— 点开别的账号只会看到别人的数据");
    (relayUi89.match(/!isLiveRow\(account\.id\)/g) || []).length >= 2 && /不是当前生效账号/.test(relayUi89)
      ? ok("★ 非生效账号禁用「使用此套餐/使用」并给出提示（激活动作不许落到别的账号上）")
      : fail("非生效账号仍能直接激活 —— 会作用到当前生效账号上");
  }
}


// ---------- 【90】ipc-registry 域账本：与 main.ts / features 实际代码一致（09-21 架构改造批 4 前置）----------
// registry 是「域 → 现在在哪」的唯一查表（electron/ipc-registry.ts）。守卫保证它不撒谎：
//   · 每个 status=in-main|shell 的域：main.ts 里该前缀通道数必须 = 账本 count（搬走一个就得改账本）；
//   · 每个 status=in-features 的域：main.ts 里该前缀通道数必须 = 0（搬干净），且 features 文件里通道数 ≥ 账本 count。
// 每拆一个域都要更新 registry，否则这里直接红 —— 账本与代码永远同步。
{
  const reg90 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
  const entries90 = [...reg90.matchAll(/^\s*\{\s*prefix:\s*"([\w-]+)"\s*,\s*count:\s*(\d+)\s*,\s*status:\s*"([\w-]+)"\s*,\s*file:\s*"([^"]+)"\s*,\s*$/gm)];
  // 评估报告 P1-4（09-24）：期望值不再硬编码 —— manifest 里的唯一 prefix 数就是账本应收域数，
  // 加接口只动 manifest + gen:ipc，账本没跟上这里自动红（原意图不变，数字免维护）。
  const manifest90 = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
  const expect90 = new Set(manifest90.channels.map((c) => String(c.channel || "").split(":")[0]).filter(Boolean)).size;
  (entries90.length === expect90 ? ok : fail)(`【90】ipc-registry 登记 ${entries90.length}/${expect90} 个 IPC 域（= manifest 唯一 prefix 数；新拆域必须同步登记进账本）`);
  const countByPrefix90 = (src) => {
    const m2 = new Map();
    for (const mm of src.matchAll(/ipcMain\.(?:handle|on|removeHandler)\(\s*["']([^"']+)["']/g)) {
      const p2 = mm[1].split(":")[0];
      m2.set(p2, (m2.get(p2) || 0) + 1);
    }
    return m2;
  };
  const mainCounts90 = countByPrefix90(readFileSync(join(ROOT, "electron", "main.ts"), "utf8"));
  for (const [, prefix, countStr, status, file] of entries90) {
    const count = Number(countStr);
    if (status === "in-features") {
      const inMain = mainCounts90.get(prefix) || 0;
      (inMain === 0 ? ok : fail)(`【90】已拆域 ${prefix}：main.ts 通道数应为 0（实际 ${inMain}）—— 搬走 = 必须从 main.ts 消失`);
      /* ⛔ 09-22：域文件本身可能已按顶层声明再切成「同名子目录 + barrel」
         （如 electron/features/engine-ipc.ts + engine-ipc/01-*.ts）⇒ 通道数必须按
         「文件 + 同名子目录（递归）」一起数，否则账本记的通道数永远数不到（实测 19 项假红）。 */
      const fAbs = join(ROOT, "electron", file);
      let fSrc = existsSync(fAbs) ? readFileSync(fAbs, "utf8") : "";
      const fDir = fAbs.replace(/\.ts$/, "");
      if (existsSync(fDir) && statSync(fDir).isDirectory()) {
        const walk90 = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const p = join(d, e.name);
          if (e.isDirectory()) return walk90(p);
          return /\.ts$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
        });
        fSrc += "\n" + walk90(fDir).join("\n");
      }
      const inFile = (fSrc.match(new RegExp(`ipcMain\\.(?:handle|on|removeHandler)\\(\\s*["']${prefix}:`, "g")) || []).length;
      (inFile >= count ? ok : fail)(`【90】已拆域 ${prefix}：${file} 应有 ≥ ${count} 个通道（实际 ${inFile}）`);
    } else {
      const actual = mainCounts90.get(prefix) || 0;
      (actual === count ? ok : fail)(`【90】域 ${prefix}（${status}）：main.ts 通道数 ${actual} = 账本 ${count}（不一致 = 账本过期或有人搬了没记账）`);
    }
  }
}

// ── 53. 两条正文之间的过程 = 一个折叠块（**不再带概要统计小字**）；且不与「同一工具 >3 条」那层重复折叠 ──
// 用户 09-23 原话（前半段，已被后半段推翻）：「在两条正文消息之间新增一个折叠效果：无论中间执行了多少工具和命令，
// 最终都归并为一个可折叠区块显示，展开前只显示概要统计（如运行了几条命令、编辑了几个文件等）。统计需按工具的
// 实际调用内容进行映射归类，而非仅按工具名计数。现有的『相同工具连续调用超过三次时触发折叠』逻辑需与此保持
// 一致，避免重复折叠或冲突，请在实现时兼顾这两种折叠规则。」
// ⛔⛔ 同日晚些时候用户附截图改口：「这些文字多余，全部删掉」⇒ **右侧统计小字整条删除**（见 ④）。
//    分类纯函数（tool-call-classify.mjs）仍保留并继续被本节 ①②③ 真跑 —— 分类逻辑没删，删的是"展示"。
{
  console.log(C.bold("\n【112】过程折叠块的概要统计（分类纯函数仍在位；**展示已按用户 09-23 要求删除**）与两条折叠规则的分工"));
  let cls = null;
  try { cls = await import("../../src/lib/tool-call-classify.mjs"); }
  catch (error) { fail(`【112】tool-call-classify.mjs 读不到：${error?.message ?? error}`); }

  if (cls) {
    const { toolCallBucket, summarizeToolCalls, TOOL_CALL_BUCKET_ORDER } = cls;

    /* ① 按**调用内容**归类，不是按工具名 —— 这是本条需求的核心，判据必须钉住它。
        ⛔ 反例就是"只按 item.type 归类"：同一个 `commandExecution` 既可能是查看、也可能是跑构建。 */
    const cmd = (command) => ({ type: "commandExecution", command });
    (toolCallBucket(cmd("Get-ChildItem 'D:\\x' -ErrorAction SilentlyContinue | Select-Object Name")) === "read"
      ? ok : fail)("【112】`Get-ChildItem …` 归「查看」而不是「运行命令」");
    (toolCallBucket(cmd("Select-String -Path a.ts -Pattern fold")) === "search" ? ok : fail)("【112】`Select-String …` 归「搜索」");
    (toolCallBucket(cmd("grep -rn foo src/")) === "search" ? ok : fail)("【112】`grep -rn …` 归「搜索」");
    (toolCallBucket(cmd("npm run build:electron 2>&1 | Select-Object -Last 15")) === "command"
      ? ok : fail)("【112】构建命令尾巴上的管道格式化（`| Select-Object`）不得把它误判成「查看」");
    (toolCallBucket(cmd("cd 'D:\\x'; node -e \"console.log(1)\"")) === "command" ? ok : fail)("【112】没写没读的命令归「运行命令」");
    /* ② 写文件的命令归 write（**次数**单位）；文件数单位只留给 fileChange（见下方 edit） */
    (toolCallBucket(cmd("... | Set-Content -Path x.md")) === "write" ? ok : fail)("【112】`Set-Content` 归「写入文件」");
    (toolCallBucket(cmd("echo hi > out.txt")) === "write" ? ok : fail)("【112】重定向写文件归「写入文件」");
    (toolCallBucket(cmd("cd 'D:\\x'; @' const fs=require('fs'); fs.writeFileSync(f,s); '@ | node -")) === "write"
      ? ok : fail)("【112】node 单行脚本里的 fs 写调用归「写入文件」");
    /* ⛔ 实测踩到的假阳性：`=>` 后跟 `.test()` 形状上像 `> x.ext`，第一版把一堆 JS 单行脚本
       误判成"写文件"。重定向的 `>` 必须前面是空白/分隔符（`2>&1`、`=>` 因此都不命中）。 */
    (toolCallBucket(cmd("node -e \"const kept=lines.filter(l=>!re.test(l)); console.log(kept)\"")) === "command"
      ? ok : fail)("【112】`=>x.test()` 不得被误判成重定向写文件");
    (toolCallBucket(cmd("npm run build 2>&1 | Select-Object -Last 5")) === "command" ? ok : fail)("【112】`2>&1` 不得被误判成重定向");
    /* ③ 复合命令里的"有后果的动作"不能被同一条里的只读子命令冲淡 */
    (toolCallBucket(cmd("cd 'D:\\x'; git add a.ts; git commit -q -m \"x\"; git log --oneline -2; git status --short")) === "command"
      ? ok : fail)("【112】复合命令里的 `git commit` 不被同一条里的 `git log` 冲淡成「查看」");
    /* ④ 其余类型的映射（工具名只在这类**无内容可判**时才用） */
    const typeCases = [
      [{ type: "fileChange", changes: [{ path: "a" }] }, "edit"],
      [{ type: "webSearch", query: "x" }, "research"],
      [{ type: "imageView", path: "a.png" }, "read"],
      [{ type: "mcpToolCall", tool: "t" }, "external"],
      [{ type: "dynamicToolCall", tool: "t" }, "external"],
      [{ type: "collabAgentToolCall", tool: "agent_invoke" }, "collab"],
      [{ type: "reasoning" }, "thinking"],
      [{ type: "agentMessage", text: "x" }, null],
      [{ type: "userMessage" }, null],
      [{ type: "plan", text: "x" }, null],
      [{ type: "unheardOfTool" }, "other"],
    ];
    const wrong = typeCases.filter(([item, want]) => toolCallBucket(item) !== want);
    (wrong.length === 0 ? ok : fail)(`【112】类型映射逐条正确（错 ${wrong.length} 条：${wrong.map(([i, w]) => `${i.type}→${toolCallBucket(i)}(期望${w})`).join(" / ")}）`);

    /* ⑤ 统计文案：单位不混用（编辑按**文件数**、其余按**次数**），且实际动作排在"深度思考"之前 */
    const units = [];
    for (let i = 0; i < 7; i++) units.push({ item: cmd("Get-ChildItem 'D:\\x'") });
    for (let i = 0; i < 3; i++) units.push({ item: cmd("Select-String -Path a.ts -Pattern x") });
    for (let i = 0; i < 2; i++) units.push({ item: cmd("npm run build") });
    units.push({ item: cmd("Set-Content -Path out.md -Value x") });
    units.push({ item: { type: "fileChange", changes: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }] } });
    for (let i = 0; i < 5; i++) units.push({ item: { type: "reasoning" } });
    units.push({ item: { type: "agentMessage", text: "汇报" } });
    const stats = summarizeToolCalls(units);
    (stats.text.startsWith("查看 7 次") && stats.text.includes("编辑 3 个文件") && stats.text.includes("搜索 3 次")
      ? ok : fail)(`【112】统计文案按数量降序、且「编辑」以文件数为单位（实得 ${JSON.stringify(stats.text)}）`);
    (!/深度思考/.test(stats.text) ? ok : fail)("【112】实际动作优先占满展示位，「深度思考」不挤掉它们");
    // calls = 参与统计的**步骤**数（7 查看 + 3 搜索 + 2 构建 + 1 写文件 + 1 个 fileChange；
    // reasoning 单列、正文/用户消息不计）
    (stats.files === 3 && stats.calls === 14 ? ok : fail)(`【112】计数口径（正文/用户消息不计入；实得 files=${stats.files} calls=${stats.calls}）`);
    const writeBucket = stats.buckets.find((b) => b.bucket === "write");
    (writeBucket && writeBucket.count === 1 ? ok : fail)("【112】「写入文件」独立成桶（不和「编辑 N 个文件」混单位）");
    /* 同一文件改两次算 **1 个文件**（单位是文件不是次数） */
    (summarizeToolCalls([
      { item: { type: "fileChange", changes: [{ path: "a.ts" }] } },
      { item: { type: "fileChange", changes: [{ path: "a.ts" }] } },
    ]).text === "编辑 1 个文件" ? ok : fail)("【112】同一文件多次改动去重成 1 个文件");
    /* 边界：空 / 非数组 ⇒ 空文案（调用方据此回退到原意图摘要），不抛 */
    (summarizeToolCalls([]).text === "" && summarizeToolCalls(null).text === "" && summarizeToolCalls(undefined).text === ""
      ? ok : fail)("【112】空输入返回空文案（调用方可回退，不抛）");
    /* 只有思考的段仍给得出文案（否则折叠头会空着） */
    (summarizeToolCalls([{ item: { type: "reasoning" } }]).text === "深度思考 1 段" ? ok : fail)("【112】只有思考的段也给得出文案");
    (TOOL_CALL_BUCKET_ORDER.includes("edit") && TOOL_CALL_BUCKET_ORDER.includes("write") && TOOL_CALL_BUCKET_ORDER.includes("thinking")
      ? ok : fail)("【112】桶顺序表含 edit/write/thinking（排序稳定性依据）");
  }

  /* ④ ⛔ 展示层已按用户 09-23 要求**删掉右侧统计小字**（附截图：「这些文字多余，全部删掉」），
        所以这里守住的是**反向**约束：不许把它挂回来。
        ⚠️ 分类纯函数（tool-call-classify.mjs）**仍保留**并被本节 ①②③ 真跑钉着 ——
        它要是没了，本节那些分类断言会先红（等于顺手删了分类逻辑）。 */
  // ⛔ 行尾免疫：git checkout 往返可能把工作树写成 CRLF，`\n  }\n` 这类定位会全部失配
  //    （09-23 实测：A/B 恢复后运行态守卫整段假红）。统一剥掉 \r 再做任何切片/正则。
  const seq112 = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8").replace(/\r/g, "");
  // ⛔ 数"有没有真的渲染统计"必须先剥注释：本文件里解释"统计已删、想加回来怎么写"的注释本身
  //    就含 `wb-fold-stats` 字样，直接 match 会把注释算成一次渲染 ⇒ 自造假红。
  const seq112Code = seq112.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  {
    const n = (seq112Code.match(/stats=\{/g) || []).length;
    (n === 0 ? ok : fail)(`【112】折叠头不再挂概要统计（实得 ${n} 处，需 0 —— 用户 09-23「这些文字多余，全部删掉」）`);
    const head = (seq112Code.match(/wb-fold-stats/g) || []).length;
    (head === 0 ? ok : fail)(`【112】渲染层无 wb-fold-stats 残留（实得 ${head} 处，需 0）`);
  }

  /* ⑤ ⛔ 两条折叠规则的分工（用户明确要求「避免重复折叠或冲突」）：
        · 完成态：外层折叠块独占「两条正文之间的全部过程」⇒ 内层必须关掉「同一工具 >3 条」那层；
        · 运行态：没有外层折叠块 ⇒ 那层仍是唯一收敛机制，必须保留。 */
  {
    // ⛔ 只数**属性形式**（`cap={false} renderUnit`）：注释里解释这条规则时也会写到 `cap={false}`，
    //    按裸串计数会把注释算进去（第一版就是 3 ≠ 2 假红）。
    const noCap = (seq112.match(/cap=\{false\} renderUnit/g) || []).length;
    // 09-23 双层折叠 + 运行态 autoFold 后为 4 处：两条完成态分支 + 内层芯片（NestedProcessRuns
    // 里两段）+ 运行态已被正文隔开的折叠段。末段内联仍保留 cap（那里没有外层折叠块）。
    (noCap === 4 ? ok : fail)(
      `【112】折叠段都关掉了内层截断（实得 ${noCap}，需 4 = 两条完成态分支 + 内层芯片两段 + 运行态折叠段）`
    );
    const runAt = seq112.indexOf("if (running) {");
    const runEnd = runAt >= 0 ? seq112.indexOf("\n  }\n", runAt) : -1;
    const runBlock = runAt >= 0 && runEnd > runAt ? seq112.slice(runAt, runEnd) : "";
    /* ⑤b 运行态（09-23）：被正文隔开的过程段 autoFold 收成芯片（那段关内层截断）；
        还在长的末段保持内联（cap 默认开，是它唯一的收敛机制）。两个判据一起钉。 */
    (runBlock && /autoFold/.test(runBlock) && (runBlock.match(/cap=\{false\} renderUnit/g) || []).length === 1
      ? ok : fail)("【112】运行态：被正文隔开的过程段 autoFold 收成折叠块（且只关这一段的内层截断）");
    (runBlock && /: <CappedToolSequence key=\{`live-/.test(runBlock)
      ? ok : fail)("【112】运行态末段仍内联（还在长、还在跑的那段不进摘要）");
    /* 内层那层折叠本体仍必须在（改造不能把它删掉） */
    const cards112 = readFileSync(join(ROOT, "src", "features", "session-cards", "SessionCards.tsx"), "utf8");
    (/export function CappedToolRun\(\{ label, units, renderUnit, limit = 3 \}/.test(cards112)
      ? ok : fail)("【112】「相同工具连续调用超过 3 条」规则仍在（CappedToolRun 默认 limit = 3）");
    (/hiddenCount = Math\.max\(0, units\.length - limit\)/.test(cards112) ? ok : fail)("【112】超出 limit 的那部分才收进折叠行");
    (/export function CappedToolSequence\(\{ units, renderUnit, cap = true \}/.test(cards112)
      ? ok : fail)("【112】CappedToolSequence 有 cap 开关（默认开启 = 不改变既有行为）");
    (/if \(cap === false\) return/.test(cards112) ? ok : fail)("【112】cap=false 时逐条原序渲染（不再分组截断）");
  }

  /* ⑥ 样式收口：统计的样式规则已随渲染一起删掉（不留死 CSS）。 */
  (!/\.wb-fold-stats\s*\{/.test(readStyles()) ? ok : fail)("【112】.wb-fold-stats 样式规则已随渲染一起删除（不留死 CSS）");
}
  }

  /* ══ 【118】过程折叠的分段口径（长正文才是锚点、短过渡正文算过程）+ 意图词标题 + 命令行剥壳 ══
     用户 09-23 附截图：「图二这种正文之间的折叠效果能做出来吗，图一我们现在这看着很变扭」；
     尝试「每段正文之间的过程各自成一个折叠块」当天被否：
     「你先加了一个正文中间折叠，运行过程不折叠吗」⇒ **整段运行过程折叠必须保留**（旧消息靠它保持简短）。
     ⛔ 【112】与本节的同一块区域的两半：【112】管「统计怎么算」，【118】管「分段与标题怎么取」。 */
  {
    console.log(C.bold("\n【118】过程折叠：长正文锚点 / 单条过程也收 / 意图词标题 / 命令行剥壳"));
    let cd = null;
    try { cd = await import("../../src/lib/command-display.mjs"); }
    catch (error) { fail(`【118】command-display.mjs 读不到：${error?.message ?? error}`); }
    const foldPlan = await import("../../src/lib/turn-fold-plan.mjs");

    if (cd) {
      /* ① 剥壳（真跑）：宿主包上去的 shell 启动器不许出现在界面上 —— 真机原样见 command-display.mjs 文件头 */
      const LAUNCHER = `"D:\\Codex Harness Desktop-refactor\\resources\\tools\\pwsh\\pwsh.exe"`;
      const innerCommand = `Get-Content -LiteralPath 'D:\\Codex Harness Desktop-refactor\\src\\App.tsx'`;
      const stripped = cd.stripShellLauncher(`${LAUNCHER} -Command "${innerCommand}"`);
      (stripped === innerCommand ? ok : fail)(`【118】剥掉 pwsh 启动器外壳（实得 ${JSON.stringify(stripped).slice(0, 60)}）`);
      (cd.stripShellLauncher(`${LAUNCHER} -NoProfile -ExecutionPolicy Bypass -Command "npm run check"`) === "npm run check"
        ? ok : fail)("【118】剥壳能吃多个启动器开关（-NoProfile / -ExecutionPolicy <值>）");
      /* ⛔ 认不出来必须原样返回：宁可显示带壳原文，也不能把用户的命令改写错 */
      const noShell = `cd 'D:\\x'; node -e "console.log(1)"`;
      (cd.stripShellLauncher(noShell) === noShell ? ok : fail)("【118】没有外壳的命令原样返回（不猜、不改写）");
      (!/pwsh\.exe/i.test(cd.displayCommand(`${LAUNCHER} -Command "Get-Content -Lit x.ts"`)) ? ok : fail)(
        "【118】明细行的展示形态不含启动器路径"
      );
      /* ② 目标（真跑）：标题里的 topic 取**文件路径**，不取命令行原文 */
      const target = cd.commandTarget(`${LAUNCHER} -Command "Get-Content -LiteralPath 'D:\\a\\src\\App.tsx'"`);
      (/App\.tsx$/.test(target) && !/\\/.test(target) ? ok : fail)(
        `【118】命令目标取文件路径并归一为正斜杠（实得 ${JSON.stringify(target)}）`
      );
      (cd.commandTarget(`${LAUNCHER} -Command "Write-Output \\"ok\\""`) === "" ? ok : fail)(
        "【118】没有文件目标的命令返回空 ⇒ 标题退回无目标文案「运行命令」（对齐图二第一枚芯片）"
      );
      /* ⛔ URL 不是文件目标：真机实测过 —— `https:` 里的 `s:` 一度被当成盘符，
         摘要变成「运行 s://api.pptoken.org」。盘符只允许 `X:` **且后面紧跟分隔符**。 */
      (cd.commandTarget("curl -X POST https://a.b.org/v1/x.json -d '{}'") === "" ? ok : fail)(
        `【118】URL 不当文件目标（实得 ${JSON.stringify(cd.commandTarget("curl -X POST https://a.b.org/v1/x.json -d '{}'"))}）`
      );
      /* ⛔ 带空格的路径（`D:\Codex Harness Desktop-refactor\…`）必须保住盘符 ——
         第一版把 `\` 算进盘符前缀，这类路径直接匹配不到、盘符被吃掉。 */
      const spaced = cd.commandTarget(`${LAUNCHER} -Command "Get-Content -LiteralPath 'D:\\Codex Harness Desktop-refactor\\src\\App.tsx'"`);
      (/^D:\//.test(spaced) && /App\.tsx$/.test(spaced) ? ok : fail)(
        `【118】带空格路径保住盘符并归一为正斜杠（实得 ${JSON.stringify(spaced)}）`
      );
      (cd.shortenPath("D:\\a\\b\\c\\d\\e\\f\\g\\h\\i\\01-seg.tsx").endsWith("01-seg.tsx") ? ok : fail)(
        "【118】超长路径从左截（保文件名，不许把文件名切掉）"
      );
    }

    /* ③ 正文锚点判据（真跑 planCompletedFold）：⛔ **短过渡正文必须算过程**——
       09-23 试过「有正文就是正文锚点」，结果一整轮的过程被切成一堆小折叠块、过渡正文全裸，
       用户当天否掉（「你先加了一个正文中间折叠，运行过程不折叠吗」）。
       现行口径：只有长正文（≥ FOLD_BODY_ANCHOR_CHARS）与最终答复留在折叠组外，
       其余（工具/思考/一句话过渡）收进**同一个**折叠块，旧消息才保持简短。 */
    {
      const unit = (id, type, text = "") => ({ item: { id, type, text }, kind: type === "agentMessage" ? "body" : "foldable" });
      const units = [
        unit("toolA", "commandExecution"),
        unit("bodyShort", "agentMessage", "先按纪律读项目级技能。"),
        unit("toolB", "commandExecution"),
        unit("toolC", "reasoning"),
        unit("bodyLong", "agentMessage", "汇".repeat(712)),
        unit("toolD", "commandExecution"),
        unit("bodyFinal", "agentMessage", "收尾答复。"),
      ];
      const out = foldPlan.planCompletedFold(units, "bodyFinal");
      const bodies = out.filter((entry) => entry.kind === "body").map((entry) => entry.unit.item.id);
      const folds = out.filter((entry) => entry.kind === "fold").map((entry) => entry.units.map((u) => u.item.id));
      (folds.some((group) => group.includes("bodyShort")) ? ok : fail)(
        `【118】短过渡正文算过程、收进折叠组（旧消息靠它保持"整段运行过程折叠"；实得 ${JSON.stringify(folds)}）`
      );
      (bodies.includes("bodyLong") ? ok : fail)(
        `【118】长正文（712 字）仍是正文锚点、留在折叠组外（bodies=${bodies.join(",")}）`
      );
      (!folds.some((group) => group.includes("bodyLong") || group.includes("bodyFinal")) ? ok : fail)(
        `【118】长正文与最终答复不进过程组（实得 ${JSON.stringify(folds)}）`
      );
      (foldPlan.FOLD_BODY_ANCHOR_CHARS === 200 ? ok : fail)(
        `【118】长正文阈值仍是 200 字（实得 ${foldPlan.FOLD_BODY_ANCHOR_CHARS} —— 别顺手改）`
      );
      const empty = foldPlan.planCompletedFold(
        [unit("toolX", "commandExecution"), unit("bodyEmpty", "agentMessage", "   ")], "none",
      );
      ((empty.find((entry) => entry.kind === "fold")?.units ?? []).some((u) => u.item.id === "bodyEmpty") ? ok : fail)(
        "【118】空正文的 agentMessage 不算正文锚点（仍按过程处理）"
      );
    }

    /* ④ 接线：标题取意图词（两条完成态分支都要改）+ 统计保留在右侧 + 命令目标不再用原始命令行 */
    {
      const seq = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8");
      const intentTitles = (seq.match(/computeFoldSummary\((entry|seg|part)\.units, false, waitingForApproval\)/g) || []).length;
      (intentTitles === 4 ? ok : fail)(
        `【118】四处取意图摘要的地方都在（两条完成态分支 + 内层芯片 + 运行态折叠段；实得 ${intentTitles} 处，需 4）`
      );
      /* ⛔ 双层折叠（09-23）：外层「整段运行过程」+ 内层「正文之间各自成块」必须同时在 ——
         用户明确要求两者并存（「两个没办法同时存在吗」）。 */
      (/<NestedProcessRuns[\s\S]{0,200}?units=\{entry\.units\}/.test(seq) ? ok : fail)(
        "【118】外层过程块内部做二次分段（NestedProcessRuns —— 外层收整轮、内层收正文之间）"
      );
      (/key=\{`fold-completed-\$\{turn\.id\}-\$\{index\}`\}[\s\S]{0,2600}?defaultOpen=\{keepProcessOpen\}/.test(seq)
        ? ok : fail)("【118】外层仍是「整段运行过程」折叠块（默认收起 ⇒ 旧消息只有一行）");
      (!/segStats \|\| computeFoldSummary/.test(seq) && !/statsTextOf\(entry\.units\) \|\| computeFoldSummary/.test(seq)
        ? ok : fail)("【118】旧的「统计优先」标题口径不许回来（标题一律取意图摘要 / 回合收尾皮肤）");
      /* ⛔ 09-23 用户附截图改口：「这些文字多余，全部删掉」⇒ 右侧统计小字**整条删除**。
         这里守住反向约束（与【112】④ 同源，两处都要钉：只改一处会让另一处继续假绿）。 */
      const statsSlots = (seq.match(/stats=\{/g) || []).length;
      (statsSlots === 0 ? ok : fail)(
        `【118】右侧统计小字不挂在任何分支（实得 ${statsSlots} 处，需 0 —— 用户 09-23「全部删掉」）`
      );
      const foldTs = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8").replace(/\r/g, "");
      /* 09-23 深夜改为意图分级（【127】），断言跟着新形状走：目标仍必须走 commandTarget */
      (/object: raw \? commandTarget\(raw\) \|\| undefined/.test(foldTs)
        ? ok : fail)("【118】折叠摘要的命令目标走 commandTarget（不许退回把原始命令行当 topic）");
      /* ⛔ 单条过程也要收（09-23 用户追报「运行过程折叠没了」）：正文锚点化之后过程段普遍变小，
         旧的「只有 ≥2 条才折」会让孤零零的命令卡散在正文之间。判据落源码：flush 不许再按条数分叉。 */
      const foldTsFlush = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8").replace(/\r/g, "");
      (!/buffer\.length >= 2/.test(foldTsFlush) && /if \(buffer\.length\) segments\.push\(\{ kind: "foldable"/.test(foldTsFlush)
        ? ok : fail)("【118】单条过程也收进折叠块（flush 不按条数分叉 —— 无论多少都归并为一个可折叠区块）");

      const panel = readFileSync(join(ROOT, "src", "features", "terminal", "TerminalPanel.tsx"), "utf8");
      (/displayCommand\(command\) \|\| "命令"/.test(panel) ? ok : fail)("【118】命令卡片表头用剥壳后的命令");
      /* ⛔ 展开里的完整命令必须是引擎原文（用户要照着复现）——剥壳只用于展示 */
      (/const command = String\(item\.command \?\? ""\)\.trim\(\);/.test(panel) ? ok : fail)(
        "【118】完整命令仍取引擎原文（剥壳只用于展示）"
      );
    }
  }

  /* ── 【122】灰线归属：回合收尾那条必须在，正文之间的芯片不许有 ──
     09-23 用户连续两轮，第二轮直接附完成态截图：
       ① 「正文中间的折叠，和思考板块折叠不要灰色线…不要删了那个正在处理下面的那个灰色运行过程
          折叠线，只保留这个灰色线」；
       ② 「运行完成，折叠后，这个地方灰色线不见」—— dd6f04b 把 `--completed` 的 border-bottom
          一起归零，结果**运行→完成**时那条线凭空消失（用户点名的是它，被误删的也是它）。
     ⇒ 判据落两处：CSS 里两条线都在且几何一致；源码里 `completed` 皮肤只给 lead 段（其余是芯片）。 */
  {
    console.log(C.bold("\n【122】灰线只留回合收尾那一条（运行中「正在处理」/ 完成后「耗时」是同一槽位）"));
    const cssLine = readStyles().replace(/\r/g, "");
    /** 取某个选择器的声明体；返回 null 表示**这条规则不存在**（与"存在但没有 border"区分开） */
    const ruleBody = (sel) => {
      const index = cssLine.indexOf(`${sel} {`);
      if (index < 0) return null;
      const end = cssLine.indexOf("}", index);
      return end < 0 ? null : cssLine.slice(index + sel.length + 2, end);
    };
    const visibleBottom = (body) =>
      body != null && (body.match(/border-bottom:\s*([^;]+);/g) || [])
        .some((decl) => !/^\s*0\s*$/.test((decl.split(":")[1] ?? "").replace(";", "")));
    const lineGeom = (body) =>
      body != null && /min-height:\s*28px/.test(body) && /padding:\s*0 3px 4px 0/.test(body);

    const completedHeader = ruleBody(".wb-fold--completed .wb-fold-header");
    (visibleBottom(completedHeader) ? ok : fail)(
      "【122】回合收尾头（完成态折叠头「耗时 …」）保留灰线 —— 它是运行中「正在处理 N 秒」那条线的接续"
    );
    const runningLine = ruleBody(".running-process-time");
    (visibleBottom(runningLine) ? ok : fail)("【122】运行中「正在处理 N 秒」的灰线仍在");
    (lineGeom(completedHeader) && lineGeom(runningLine) ? ok : fail)(
      "【122】两条线几何一致（min-height 28px + padding-bottom 4px ⇒ 运行→完成切换时线不跳）"
    );
    /* 反向绊线（次要）：直接给芯片选择器加边框也会画线。⛔ 注意这条**不够**——
       实际泄漏路径是 `.wb-fold--completed .wb-fold-header` 的**后代**匹配，见下面的嵌套守卫。 */
    const chipSels = [".wb-fold--summary .wb-fold-header", ".wb-fold--process .wb-fold-header"];
    const chipWithLine = chipSels.filter((sel) => visibleBottom(ruleBody(sel)));
    (chipWithLine.length === 0 ? ok : fail)(
      `【122】正文之间的意图词芯片不画灰线（命中 ${chipWithLine.join(" / ") || "无"}）`
    );

    /* ⛔⛔ 关键的**后代泄漏**守卫：`.wb-fold--completed .wb-fold-header` 是后代匹配 —— 大折叠展开后，
       体内每个芯片的折叠头也会命中它（真机实测 `.wb-fold--summary > .wb-fold-header` 得到
       `borderBottomWidth=1px` + `width=810`，而 base 是 `width: fit-content`）。
       用户 09-23 点名的「工具的折叠不要灰线，只保留大折叠的灰线」就是这条泄漏。
       ⇒ 必须有把嵌套头归零的覆盖规则（两个选择器任一即可，这里要求**都**在：一个按 `.wb-fold-body`
          结构、一个按任意嵌套 `.wb-fold`，防止将来中间层换类名时失效）。 */
    const nestedRule = readStyles().replace(/\r/g, "").match(
      /\.wb-fold--completed \.wb-fold-body \.wb-fold-header[^{]*\{[^}]*border-bottom:\s*0[^}]*\}/
    );
    (nestedRule ? ok : fail)(
      "【122】嵌套折叠头（大折叠体内的芯片/工具折叠）有归零规则 —— 防后代选择器泄漏（显式 0 条灰线）"
    );
    const nestedRule2 = readStyles().replace(/\r/g, "").match(
      /\.wb-fold--completed \.wb-fold \.wb-fold-header[^{]*\{[^}]*border-bottom:\s*0[^}]*\}/
    );
    (nestedRule2 ? ok : fail)(
      "【122】嵌套折叠头的归零规则同时覆盖任意嵌套层（不依赖 .wb-fold-body 这一个类名）"
    );

    const seqLine = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8")
      .replace(/\r/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const leadTernary = (seqLine.match(/variant=\{(?:index === leadFoldIndex|lead) \? "completed" : "summary"\}/g) || []).length;
    (leadTernary === 2 ? ok : fail)(
      `【122】两条渲染分支的 completed 皮肤都只给 lead 段（实得 ${leadTernary} 处，需 2）`
    );
    const bareCompleted = (seqLine.match(/variant="completed"/g) || []).length;
    (bareCompleted === 0 ? ok : fail)(
      `【122】没有无条件的 completed 皮肤（实得 ${bareCompleted} 处，需 0 —— 那会让每个过程段各画一条线）`
    );
    ((seqLine.match(/variant="summary"/g) || []).length >= 2 ? ok : fail)(
      "【122】芯片段仍是 summary 皮肤（内层 NestedProcessRuns + 运行态自动折叠共 ≥2 处）"
    );
  }

  /* ══ 【127】真实状态映射：意图分级 + 行数统计（09-23 用户附 WorkBuddy 截图「这种效果我也要」）══
     三件事钉死：① 命令按**字面意图**分级（commandIntentOf），不再一律「运行命令」；
     ② fileChange 用 diffStats 算 +/- 行（与明细卡同一真相源），摘要尾巴带 `+N -M`；
     ③ 新引擎运行时的**逗号形态**启动器（`pwsh.exe,-Command …`）必须能剥壳 ——
        剥不动时 commandTarget 会把 pwsh 路径当文件目标（真实踩到）。 */
  {
    const cmdSrc = readFileSync(join(ROOT, "src", "lib", "command-display.mjs"), "utf8").replace(/\r/g, "");
    const foldSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8").replace(/\r/g, "");
    const cmdCode = cmdSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const foldCode = foldSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (/export function commandIntentOf\(/.test(cmdCode) ? ok : fail)("【127】commandIntentOf 纯函数存在（命令的二级意图）");
    (/const raw = item\.command \? String\(item\.command\) : "";[\s\S]{0,120}group: commandIntentOf\(raw\)/.test(foldCode) ? ok : fail)(
      "【127】commandExecution 按 commandIntentOf 分组（不许一律 command —— 那是「全是运行命令」的根因）"
    );
    (/import \{ diffStats \} from "\.\/diff-stats";/.test(foldCode) && /const next = diffStats\(String\(change\?\.diff \?\? ""\)\);/.test(foldCode) ? ok : fail)(
      "【127】fileChange 用 diffStats 数 +/- 行（与明细卡同一真相源，不许另写一份解析）"
    );
    (/编辑 \{t}/.test(foldSrc) ? ok : fail)("【127】modify 词表用「编辑」（对齐用户截图「编辑 xxx.mjs」）");
    (/\+?\$\{editAdd\} -\$\{editDel\}/.test(foldCode) || /\+\$\{editAdd\} -\$\{editDel\}/.test(foldSrc) ? ok : fail)(
      "【127】摘要尾巴带聚合行数（+N -M —— 真实状态映射）"
    );
    (/SHELL_NAMES\.test\(basename\(commaHead\[1\]\)\)/.test(cmdCode) ? ok : fail)(
      "【127】剥壳认逗号形态启动器（pwsh.exe,-Command —— 不剥则目标提取会把 pwsh 路径当文件）"
    );
    /* ⛔ 运行态思考归段必须带事件顺序兜底（09-23 用户：「下一个正文输出的时候，深度思考板块
       没有被收纳到正文工具折叠里面去」）：上游经常不给 reasoning 回传 completed ⇒ 只看
       status/duration 会把它永远当直播。规则 = 后面已出现工具/正文 ⇒ 必然已结束，进折叠段。
       SessionQueue 的 reasoningActive 有同款规则 —— 两边必须一致，改一边必须同步另一边。 */
    (/const laterWork = units\.slice\(index \+ 1\)\.some\(\(next\) => next\.item\.type !== "reasoning"\);/.test(foldCode) ? ok : fail)(
      "【127】buildSegments 的思考直播判定带事件顺序兜底（后面有工具/正文 ⇒ 折叠段）"
    );
    (/&& !turnFinished;/.test(foldCode) ? ok : fail)(
      "【127】回合结束后不存在直播思考（buildSegments 的 turnFinished 收口）"
    );
    /* ── 表头真实映射（09-24 用户附截图：「这个还是显示已运行没有显示具体的真实映射」）── */
    const termSrc = readFileSync(join(ROOT, "src", "features", "terminal", "TerminalPanel.tsx"), "utf8").replace(/\r/g, "");
    const termCode = termSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (/export function commandPurpose\(/.test(cmdCode) ? ok : fail)("【127】commandPurpose 纯函数存在（从脚本输出标签提炼用途）");
    (/export const INTENT_VERB = \{ read: "查看", search: "定位", modify: "编辑", command: "运行" \}/.test(cmdCode) ? ok : fail)(
      "【127】意图→动词表存在（查看/定位/编辑/运行）"
    );
    (!/const verb = [^;]*"已运行"[^;]*;/.test(termCode) && /const intentVerb = INTENT_VERB\[intent\]/.test(termCode) ? ok : fail)(
      "【127】命令行表头动词按意图映射（⚠️ 不许退回写死的「已运行」—— 那正是用户截图里的问题）"
    );
    (/\[purpose, target\]\.filter\(Boolean\)\.join\(" · "\)/.test(termCode) ? ok : fail)(
      "【127】表头串 = 用途 · 目标（两者都显示，看不出目的才算没映射）"
    );
    (/\(\?!\[A-Za-z0-9_-\]\)/.test(cmdCode) ? ok : fail)(
      "【127】目标提取带尾部负向断言（防 `.codex-harness` 被截成半截 `.codex`）"
    );
    /* ── 技能归属映射（09-24 用户：「还有使用了技能类似没看见」）── */
    const toolLib = join(ROOT, "src", "lib", "tool-display.mjs");
    const itemSrc = readFileSync(join(ROOT, "src", "features", "session-queue", "ItemView.tsx"), "utf8").replace(/\r/g, "");
    const itemCode = itemSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const toolCode = existsSync(toolLib) ? readFileSync(toolLib, "utf8").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "") : "";
    (existsSync(toolLib) && /export function skillOfItem\(/.test(toolCode) ? ok : fail)(
      "【127】tool-display.mjs 的 skillOfItem 存在（技能归属纯函数）"
    );
    (/const skill = skillOfItem\(item\);[\s\S]{0,320}group: "skill"/.test(foldCode) ? ok : fail)(
      "【127】折叠原子优先按技能归类（命中 ⇒ group=skill，摘要出「使用技能 …」）"
    );
    (/skill: \{ topic: "使用技能 \{t\}"/.test(foldSrc) ? ok : fail)("【127】词表有 skill 档（使用技能）");
    (/const skill = skillOfItem\(item\);/.test(itemCode) && /info=\{<><code>\{skill \? skill\.label : title\}<\/code>/.test(itemCode) ? ok : fail)(
      "【127】工具卡表头显示技能中文名（使用技能而不是「调用 server/tool」）"
    );
    /* ── 技能 / 插件 / MCP 「怎么用的」（09-24 用户：「技能，插件，mcp 等等都要展示出来怎么用了」）── */
    (/export function argSummary\(/.test(toolCode) ? ok : fail)("【127】argSummary 纯函数存在（从入参提炼「怎么用了」）");
    (/const source = skill \? "技能" : isMcp \? "MCP" : "插件";/.test(itemCode) ? ok : fail)(
      "【127】工具卡标明来源：技能 / MCP / 插件（mcpToolCall=MCP，dynamicToolCall=插件动态工具）"
    );
    (/className="action-arg"/.test(itemCode) ? ok : fail)("【127】工具卡显示关键入参（用了什么 url/路径/查询词）");
    (/mcp: \{ topic: "调用 MCP \{t\}"/.test(foldSrc) && /plugin: \{ topic: "用插件 \{t\}"/.test(foldSrc) ? ok : fail)(
      "【127】词表有 mcp / plugin 两档（不再混进含糊的「调用服务」）"
    );
    /* ⛔ 命中文路径（09-24 实测：`markitdown D:/x/报告.pdf` 取不到目标 ⇒ 只剩技能名） */
    (/const SEG = "\[A-Za-z0-9_\.@%~\+\\\\u4e00-\\\\u9fff-\]"/.test(cmdCode) ? ok : fail)(
      "【127】commandTarget 的路径段允许中文（否则中文文件名取不到目标）"
    );
    (/SKILL_PATH_RE\s*=/.test(toolCode) && /byPath\[1\]/.test(toolCode) ? ok : fail)(
      "【127】技能识别带目录路径兜底（`…/skills/<名>/…`，用户自建技能名不在内置表也照样显示）"
    );
    (/cache\[\\\\\/\]\[A-Za-z0-9\._-\]\+\[\\\\\/\]\)?/.test(toolCode) ? ok : fail)(
      "【127】插件路径取插件名而不是 vendor 名（`plugins/cache/<vendor>/<plugin>`，取错等于没信息）"
    );
    (/const skill = command \? skillOfItem\(\{ type: "commandExecution", command \}\) : null;/.test(termSrc) ? ok : fail)(
      "【127】命令行卡也走技能识别（模型用技能多半是一条读 SKILL.md 的命令 —— 只按意图显示就看不出在用技能）"
    );
    (/skill \? \(running \? "正在使用技能" : failed \? "使用技能失败" : "已使用技能"\)/.test(termSrc) ? ok : fail)(
      "【127】命令行卡动词按技能走（正在/已使用技能，含失败态）"
    );
    (/skillTargetLabel\(target\) \|\| skill\.label/.test(termSrc) ? ok : fail)(
      "【127】技能没有目标时显示技能中文名（不许退回剥壳后的命令原文）"
    );
    (/skillTargetLabel\(/.test(foldCode) ? ok : fail)(
      "【127】折叠芯片的技能目标走 skillTargetLabel（半截路径 / 技能目录内 / 纯点目录 一律丢弃）"
    );
    (/const isDotDir = \(v\) => \/\^\\\.\[A-Za-z0-9_-\]\+\$\/.test\(v\);/.test(toolCode) ? ok : fail)(
      "【127】纯点目录段（`.workbuddy`）丢弃 —— commandTarget 会把它误当扩展名先命中"
    );
    (/export function registerKnownSkills\(/.test(toolCode) && /KNOWN_SKILLS\.get\(/.test(toolCode) ? ok : fail)(
      "【127】技能显示支持本地清单（目录名 → descriptionZh/description，自建技能才看得懂）"
    );
    const skillHostPart = join(ROOT, "src", "features", "app-state", "parts", "part01", "03-accounts-connectors-rate-limit", "01-accounts-connectors-skills.tsx");
    (existsSync(skillHostPart) && /window\.codex\?\.listLocalSkills\?\.\(\)/.test(readFileSync(skillHostPart, "utf8")) ? ok : fail)(
      "【127】启动把 skills:local-list 喂进展示层（不注册就退回目录名）"
    );
    (/if \(hay && item\?\.arguments\) hay \+= /.test(toolCode) ? ok : fail)(
      "【127】工具入参也纳入技能匹配串（技能路径可能只出现在 arguments 里）"
    );
  }

  /* ①⓪ 【149】列表尾部 lazy 续行容错（09-24 用户：「最后一个总是歪的，前面空那么多」）。
     ⛔ 现象：`30. 四通八达` 后面紧跟一行**顶格**结语（模型常忘加空行）⇒ CommonMark 把它当作该
        列表项的 lazy 续行 ⇒ 渲染成 `<li>四通八达<br/>结语</li>` ⇒ 结语从 marker 之后起排，
        左侧空出 marker 宽度（截图里就是「最后一行歪了、前面空一块」）。
     ⛔ 修法（src/lib/markdown-blocks.mjs 的 softenListTailLazyContinuation）：只在这类尾行前
        补一个空行，让它成为独立段落（块数不变 ⇒ 流式 key 稳定、组件不重挂载）。
        判据三条同时成立才动：在块尾 + 顶格 + 非列表项/非块级开头；围栏内一律不碰。
     本守卫 = 静态（分块只允许一份实现）+ 跑真代码的真值表（正向必拆 / 反向必不拆）。 */
  {
    const mdSrc = readFileSync(join(ROOT, "src", "features", "markdown", "Markdown.tsx"), "utf8");
    if (/from "\.\.\/\.\.\/lib\/markdown-blocks\.mjs"/.test(mdSrc)) ok("【149】Markdown.tsx 的分块取自 src/lib/markdown-blocks.mjs");
    else fail("【149】Markdown.tsx 必须 import src/lib/markdown-blocks.mjs（分块逻辑只允许一份）");
    if (/function splitMarkdown/.test(codeOnly(mdSrc))) fail("【149】Markdown.tsx 又出现本地 splitMarkdown 实现（两份必然漂移）");
    else ok("【149】Markdown.tsx 无本地分块实现残留");

    const soft = (lines) => splitMarkdown(lines.join("\n"));
    const ord = soft(["27. 一鸣惊人", "30. 四通八达", "1–10 全是「数字开头」"]);
    if (ord.length === 1 && /\n\n/.test(ord[0]) && ord[0].endsWith("1–10 全是「数字开头」")) ok("【149】有序列表尾部的顶格结语行前补空行（不再落进最后一个 li）");
    else fail("【149】有序列表尾部结语仍被当 lazy 续行：" + JSON.stringify(ord));
    const unl = soft(["- 甲", "- 乙", "（结语）"]);
    if (unl.length === 1 && /\n\n（结语）$/.test(unl[0])) ok("【149】无序列表同款处理");
    else fail("【149】无序列表尾部结语未处理：" + JSON.stringify(unl));
    const indented = ["1. 甲", "   缩进续行"];
    if (soft(indented).join("\n") === indented.join("\n")) ok("【149】缩进的续行不动（作者本意是列表项内续行）");
    else fail("【149】缩进续行被误拆：" + JSON.stringify(soft(indented)));
    const plain = ["只是一段普通文字。"];
    if (soft(plain).join("\n") === plain.join("\n")) ok("【149】纯段落原样不动");
    else fail("【149】纯段落被改动：" + JSON.stringify(soft(plain)));
    const fenced = ["```js", "1. 甲", "结语"];
    if (soft(fenced).join("\n") === fenced.join("\n")) ok("【149】围栏内（含流式未闭合）不注入空行 —— 否则会改动代码块内容");
    else fail("【149】围栏内被注入空行：" + JSON.stringify(soft(fenced)));

    // 09-24 二次反馈（截图里列表 → 空档 → **仍然缩进**的两行）⇒ 另一种成因：正文行首的
    // **全角空格 U+3000**。它在 HTML 里不被折叠（只有 ASCII 空格会被折叠），会实打实渲染成
    // 一块可见空白。行尾那种还会把长行挤折、多出一行，所以两端都去。
    const fs1 = "\u3000";
    if (trimInvisibleSpace(fs1 + "甲" + fs1) === "甲") ok("【149】行首/行尾全角空格被去掉（U+3000 不被 HTML 折叠，会渲染成可见空白）");
    else fail("【149】全角空格未被去掉：" + JSON.stringify(trimInvisibleSpace(fs1 + "甲" + fs1)));
    if (trimInvisibleSpace("甲 乙\u00a0") === "甲 乙") ok("【149】U+00A0（不换行空格）同理处理");
    else fail("【149】U+00A0 未处理：" + JSON.stringify(trimInvisibleSpace("甲 乙\u00a0")));
    const fsCase = soft(["30. 四面八方", "", fs1 + "这次与上一版不重复。"]);
    if (fsCase.length === 2 && !fsCase[1].includes(fs1) && fsCase[1].endsWith("这次与上一版不重复。")) ok("【149】端到端：带行首全角空格的结语段不再缩进");
    else fail("【149】端到端未生效：" + JSON.stringify(fsCase));
    const fsFence = ["```js", fs1 + "const a = 1;", "```"];
    if (soft(fsFence).join("\n") === fsFence.join("\n")) ok("【149】围栏内的全角空格原样保留（代码内容一个字符都不许动）");
    else fail("【149】围栏内被改动：" + JSON.stringify(soft(fsFence)));

    // 09-24 真因（用户第三次截图，源文本实测是 `> 1–10 全是…`）：**引用块**。全仓此前一条
    // blockquote 样式都没有 ⇒ 走浏览器默认 `margin: 1em 40px`（左右各缩 40px、零可见标记）
    // = 用户看到的「最后一行凭空歪了、前面空那么多」。必须有显式样式（含左侧竖条）。
    const styles = readStyles();
    if (/\.markdown blockquote\s*\{[^}]*border-left/.test(styles)) ok("【149】引用块有显式样式（左竖条 + 小内边距），不再吃浏览器默认的左右各 40px");
    else fail("【149】.markdown blockquote 缺样式 —— 会退回浏览器默认 margin: 1em 40px（用户报的「歪 + 前面空一块」）");
  }
}

// ── 54. 思考卡浮窗形态（09-26 三轮迭代定稿：芯片 + portal 浮窗 + macOS 缩放特效）──
{
  const itemSrc = readFileSync(join(ROOT, "src", "features", "shared", "ReasoningCard.tsx"), "utf8").replace(/\r/g, "");
  const styles54 = readStyles();
  // ⓪ 单一真相源（09-26 教训：两份逐字相同的 ReasoningCard 并存，修一份漏另一份，
  //    探针 fit 生效率 0/25 才暴露）。调用点只许 import 共享组件，本地定义 = 事故复发。
  (!/function ReasoningCard\(/.test(readFileSync(join(ROOT, "src", "features", "session-queue", "ItemView.tsx"), "utf8")) ? ok : fail)(
    "【161】⛔ 思考卡单一真相源：session-queue/ItemView 里不得再有本地 ReasoningCard 实现"
  );
  (/export function ReasoningCard/.test(itemSrc) ? ok : fail)(
    "【161】思考卡真相源 = src/features/shared/ReasoningCard.tsx（共享导出）"
  );
  // ① 正文一律走 portal 浮窗（直播与 done 预览同一条路）——内联 Fold 展开已退役：
  //    思考不占消息流布局，工具卡不再被撑出视口（用户 09-26 定稿）。
  (/createPortal\(/.test(itemSrc) ? ok : fail)("【161】思考正文 = portal 浮窗（直播与预览同路）");
  (!/Fold open=\{open\}/.test(itemSrc) ? ok : fail)("【161】⛔ 内联 Fold 展开不得回归（那是「撑走工具卡」本身）");
  // ② 浮窗与输入框同宽同列（JS 每帧取 composerRect.width/left 写内联样式）。
  (/compR\.width/.test(itemSrc) && /compR\.left/.test(itemSrc) ? ok : fail)(
    "【161】浮窗与输入框同宽同列（width/left 取自 composerRect）"
  );
  // ③ 垂直**按空间自适应**（09-26 用户定稿「位置不固定每次都在下方」）：下方够放下方、
  //    不够放上方、两侧都不够取空间大的一侧；rAF 每帧重选边（追字/滚动/缩放都自适应）。
  (/const spaceBelow = compTop - 8 - chipR\.bottom;/.test(itemSrc) && /const spaceAbove = chipR\.top - 8;/.test(itemSrc) && /spaceAbove >= spaceBelow/.test(itemSrc) && /requestAnimationFrame\(loop\)/.test(itemSrc) ? ok : fail)(
    "【161】浮窗方向按空间自适应（下方/上方/取大侧钳边界），rAF 每帧重选边"
  );
  // ④ macOS 缩放特效：spawn 放大放出 / suck 缩回芯片（forwards 停在消失帧再卸载，
  //    卸载延迟 240ms——直接卸载会跳过特效）；transform-origin 钉在芯片所在的左上角。
  (/reasoning-float-spawn/.test(styles54) && /reasoning-float-suck/.test(styles54) && /transform-origin: 0 0;/.test(styles54) ? ok : fail)(
    "【161】spawn/suck 特效 + transform-origin 0 0（从芯片放大/缩回）必须都在 CSS"
  );
  (/exiting \? "sucking" : ""/.test(itemSrc) && /setTimeout\(\(\) => setExiting\(false\), 240\)/.test(itemSrc) ? ok : fail)(
    "【161】完成吸入 = .sucking 挂 240ms 再卸载（直接卸载会跳过特效）"
  );
  // ⑤ 正文 ≈ 4 行（96px）内部滚动：浮窗高度由此决定（不再有 260px 内联展开）。
  (/max-height: 144px;/.test(styles54) ? ok : fail)(
    "【161】浮窗正文 6 行（144px，09-26 用户要求加高）内部滚动 —— 撑高与裁切从此与思考无关"
  );
  // ⑥ 直播跟随贴底；done 预览不跟（从头读）。
  (/if \(el && reasoningFollowRef\.current\) el\.scrollTop = el\.scrollHeight;/.test(itemSrc) ? ok : fail)(
    "【161】直播跟随 = 每 tick 贴底（最新一行始终可见）"
  );
  // ⑦ 接管只认「真有内部滚动条」的滚轮/触摸（外层滚动冒泡不许误杀卡内跟随）。
  (/const onWheel = \(\) => \{ if \(el\.scrollHeight > el\.clientHeight \+ 1\) reasoningFollowRef\.current = false; \};/.test(itemSrc) ? ok : fail)(
    "【161】卡内接管只认「真有内部滚动条」的滚轮（外层滚动冒泡不许误杀）"
  );
  // ⑩ 吸入动画期间冻结追字（09-26 用户报「完成后展开卡顿一下」）：完成瞬间剩余全文
  //    一次性灌进浮窗 + 定时器每 16ms setDisplayed，与 suck 同帧抢主线程 = 卡顿。
  //    冻结到动画播完再放全文——那时浮窗已卸载，setDisplayed 只重渲染流内芯片，零成本。
  (/if \(exiting\) return;/.test(itemSrc) ? ok : fail)(
    "【161】吸入期间冻结追字（动画播完再放全文，卸载后零成本）"
  );
  // ⑧ 整面可点收起（09-26 用户定稿「留白地方做成折叠收纳的按键」）：点空白/头部收起，
  //    点正文例外（选字/滚动不能误收）。
  (/closest\("\.reasoning-body"\)/.test(itemSrc) && /onClick=\{\(event\) =>/.test(itemSrc) ? ok : fail)(
    "【161】浮窗整面可点收起（点正文例外——选字/滚动不误收）"
  );
  // ⑨ 面板身份色：左 accent 色条 + 头箭头主题蓝（09-26 用户要求加颜色区分；都在 CSS）。
  (/border-left: 3px solid var\(--accent\);/.test(styles54) && /color: var\(--accent\);/.test(styles54) ? ok : fail)(
    "【161】浮窗身份色 = 左 accent 色条 + 头箭头主题蓝（09-26 用户要求）"
  );
}
// ── 55. 压缩期间的运行态语义（09-26 用户截图：压缩后「正在生成回复 · 正在落笔」一直挂着）──
{
  const activitySrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part06", "02-seg", "01-turn-runtime-activity.tsx"), "utf8").replace(/\r/g, "");
  const part04Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  const part05Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  // ① 扫描跳过 contextCompaction：压缩 item 不是任何一种「活动」，不许被 switch 当成未知兜底。
  (/if \(isCompactionItem\(item\)\) continue;/.test(activitySrc) ? ok : fail)(
    "【163】runActivity 扫描跳过 contextCompaction（压缩不是「生成回复」，指示归分隔线与 toast）"
  );
  // ② 压缩进行中兜底必须给空串：此时「正在生成回复/正在落笔」是错的。
  (/compactPendingRef\.current\.has\(bag\.thread\.id\)\) return "";/.test(activitySrc) ? ok : fail)(
    "【163】压缩进行中 runActivity 兜底为空串（状态条静默，分隔线转圈承担指示）"
  );
  // ③ 压缩完成必须结算运行态（两个完成事件都要接）：turn/started 点亮的状态没人熄灭 = 永久挂。
  ((part05Src.match(/bag\.settleAfterCompaction\(/g) || []).length >= 2 ? ok : fail)(
    "【163】item/completed(contextCompaction) 与 thread/compacted 都必须调 settleAfterCompaction（缺一处就有挂起路径）"
  );
  // ④ 结算的守卫：本会话还有真实在跑 item（非压缩）时绝不动 —— 回合中途的自动压缩
  //    不能把真回合的运行态打停（「运行莫名停止」同类事故零容忍）。
  (/!isCompactionItem\(item\)\) return;/.test(part04Src) ? ok : fail)(
    "【163】settleAfterCompaction 有「真回合在跑就不动」守卫（自动压缩不许打断真回合）"
  );
  // ⑤ 反向绊线：结算不许漏 setActiveTurnId（只清 sending 不清 turn id = 状态条照样挂着）。
  (/bag\.setSending\(false\);[\s\S]{0,80}bag\.setActiveTurnId\(null\);/.test(part04Src) ? ok : fail)(
    "【163】settleAfterCompaction 必须同时清 sending 与 activeTurnId（漏一个状态条就还挂着）"
  );
  // ⑥ 成功提示条件化（09-26 用户截图「还在转圈就报成功」）：item/completed 只代表一个压缩
  //    completed 到达即认为本次压缩结束：**先** prune 收敛线程里其它压缩项，再报成功、再结算。
  //    ⛔ 不许回到「扫线程 item 判断还有没有在跑」的写法（09-26 用户「现在根本压缩成功不了」）：
  //      started/completed 两阶段 id 不一致时会残留一条 inProgress，判定被永久抑制 ⇒ 永远报不出成功。
  ((() => {
    const i = part05Src.indexOf('item/completed" && isCompactionItem');
    if (i < 0) return false;
    const branch = part05Src.slice(i, i + 1200);
    const pruneAt = branch.indexOf("pruneSupersededCompactions");
    const successAt = branch.indexOf('setCompactEventState("success")');
    return pruneAt >= 0 && successAt > pruneAt && !branch.includes("stillCompacting");
  })() ? ok : fail)(
    "【163】completed 即报成功，且先 prune 收敛残留压缩项（扫 item 判定会被残留 inProgress 永久抑制）"
  );
  // ⑦ 权威信号停转：thread/compacted 到达时本地把还挂着的 inProgress 压缩 item 落成
  //    completed（引擎侧 completed 迟到/缺失时分隔线会永远转圈）。
  //    ⛔ 锚到**分支边界**而非固定字符窗口（09-26 实测：分支里插几行就假红过一次）。
  ((() => {
    const i = part05Src.indexOf('event.method === "thread/compacted"');
    if (i < 0) return false;
    const nextBranch = part05Src.indexOf("} else if (event.method ===", i);
    const branch = part05Src.slice(i, nextBranch > 0 ? nextBranch : i + 3000);
    return branch.includes('status: "completed"') && branch.includes("settleAfterCompaction");
  })() ? ok : fail)(
    "【163】thread/compacted 必须本地落平还挂着的 inProgress 压缩 item（分隔线停转不依赖引擎补发）"
  );
    /* ── 【165】压缩线位置归位（09-26 两次修：回合中途自动压缩时引擎新开的压缩回合排在 turns 末尾，
     只提「所在回合」顶部不够 ⇒ 归位逻辑上收到 timeline 层：线固定插在最后一条用户消息回合正上方） */
  {
    const turnView = readFileSync(join(ROOT, "src/features/session-turn/SessionTurn/03-turn-view.tsx"), "utf8");
    const timeline = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8");
    (turnView.includes("!isCompactionItem(item)") && !turnView.includes("items={responseItems}") ? ok : fail)(
      "【165】回合内容区剔除压缩线（TurnFoldStream 只吃 foldItems，线不许再落回内容末尾）"
    );
    (timeline.includes("let lastCompaction: any = null;") && timeline.includes("isCompactionItem(it)") ? ok : fail)(
      "【165】timeline 层扫描最后一条已完成压缩 item（与 pruneSupersededCompactions 同口径）"
    );
    ((() => { const a = timeline.indexOf("compactionLine && i === insertBefore"); const b = timeline.indexOf("<MemoTurnView"); return a >= 0 && b >= 0 && a < b; })() ? ok : fail)(
      "【165】压缩线插在目标回合**之前**（= 最后一条用户消息的上方，不是回合后面）"
    );
    // ⛔ 同屏最多一条「已完成」压缩线（09-26 用户截图「两条压缩线」）：settled 兜底必须在归位处
    //    （else-if 与 compactionLine 互斥），不许再单独挂在时间线尾部。
    ((timeline.match(/compact-divider--settled/g) || []).length === 1 && /\} else if \(compactToast && compactToast\.state !== "running"/.test(timeline) ? ok : fail)(
      "【165】已完成压缩线只有一处渲染（item 优先，否则 toast 兜底，同位置互斥）"
    );
    const part04Prune = readFileSync(join(ROOT, "src/features/app-state/parts/part04/01-seg.tsx"), "utf8");
    (/let keep = keepId;/.test(part04Prune) && /keep = String\(last\?\.id \?\? ""\);/.test(part04Prune) ? ok : fail)(
      "【165】prune 空 id 也收敛（保留最后一条）——否则多余压缩项留在时间线里 = 多条线"
    );
    (/status !== \"inProgress\" && it\?\.status !== \"running\"/.test(timeline) ? ok : fail)(
      "【165】归位只取**已完成**的压缩 item（进行中的转圈由 compact toast 负责，不抢位置）"
    );
  }
  /* ── 【166】压缩 item 判定唯一口径 + 挂载兜底（09-26 rollout 取证） ──
     ⛔ 引擎落盘/事件的压缩 item 类型是 PascalCase「ContextCompaction」，各处硬写 camelCase
     会让整条压缩链静默不命中（item 不进 thread ⇒ 线只剩尾部 toast 兜底 ⇒ 用户三次看到「线在下面」）。
     ⛔ 压缩 item 的 turnId 常指向宿主不知道的引擎内部回合 ⇒ mergeItem 丢弃 ⇒ 必须挂载兜底。 */
  {
    const libSrc = readFileSync(join(ROOT, "src/lib/compaction-item.mjs"), "utf8");
    (libSrc.includes(".toLowerCase()") ? ok : fail)("【166】压缩判定大小写不敏感（唯一口径模块）");
    const uiFiles = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(entry.name)) uiFiles.push(p);
      }
    })(join(ROOT, "src/features"));
    const hardCoded = uiFiles.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /[=!]==?s*"contextCompaction"|!==s*"contextCompaction"/.test(s);
    });
    (hardCoded.length === 0 ? ok : fail)(
      "【166】渲染层/事件处理不许硬写 camelCase 判定（一律 isCompactionItem）" + (hardCoded.length ? "，命中：" + hardCoded.slice(0, 3).map((f) => f.replace(ROOT, "")).join("；") : "")
    );
    const turnView2 = readFileSync(join(ROOT, "src/features/session-turn/SessionTurn/03-turn-view.tsx"), "utf8");
    (/if \(userItems\.length === 0 && !hasRealContent\) return null;/.test(turnView2) ? ok : fail)(
      "【166】空推进回合整组不渲染（引擎把压缩跑成独立回合，否则只留一条孤零零的耗时灰线，用户截图「三条线」）"
    );
  }
}
