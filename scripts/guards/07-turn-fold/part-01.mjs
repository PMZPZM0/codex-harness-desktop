/** 07-turn-fold 第 1/6 段：原 07-turn-fold.mjs L34–L1044（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：07-turn-fold
 * 分节：【43】（原 L4094–L7963）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  AUTO_CONTINUE_MAX_ATTEMPTS, C, MOOD_HEADING, ROOT, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, codeOnly, composeMoodInstructions, createHash, createRequire, decayMood, emptyMood, existsSync, fail, homedir, isTruncatedEmptyTurn, join, mainSrc, moodBlock, moodSignature, moodTone, normalizeMood, ok, pathToFileURL, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readVoiceSettingsSrc, readdirSync, relative, spawnSync, statSync, turnOutputStats, walk, warn,
} from "../_ctx.mjs";
import { isQueueAlreadyStartedError } from "../../../src/lib/queue-errors.mjs";
import { splitMarkdown, trimInvisibleSpace } from "../../../src/lib/markdown-blocks.mjs";

import { mainC, toolchainC, terminalC, remoteC, updaterC, voiceSettingsC, voiceSectionC, hotkeyMatchC, macCfg, prepMac, verifyTools, sliceFn } from "./00-preamble.mjs";

export async function run() {
{
/NSMicrophoneUsageDescription/.test(macCfg)
    ? ok("【32】mac Info.plist 声明麦克风用途（缺了语音首次取麦必闪退）")
    : fail("【32】electron-builder.mac.cjs 缺 NSMicrophoneUsageDescription —— mac 上语音通话/听写取麦即被系统杀进程");
}

{
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
}

{
{
    const fnBody = sliceFn(remoteC, "function resolveCloudflaredBin", 760);
    // 判据必须精确：Windows 分支**本来就该**叫 cloudflared.exe（不能笼统禁止 .exe），
    // 要锁的是「mac 也有对应布局」+「解析基于内置工具目录而不是 process.cwd()」。
    (fnBody && /existingToolPath\(/.test(fnBody) && /\["cloudflared", "cloudflared"\]/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】cloudflared 走 userData/随包双根 + 平台化文件名（不再写死 cwd/…exe）")
      : fail("【32】remote.ts 的 cloudflared 解析仍依赖 process.cwd / 缺 mac 布局 —— mac 上手机配对隧道永不启动");
    /cloudflared-darwin-\$\{arch === "arm64" \? "arm64" : "amd64"\}\.tgz/.test(prepMac)
      ? ok("【32】prepare-mac-tools 现造 cloudflared(darwin) 并补执行位")
      : fail("【32】prepare-mac-tools 不造 cloudflared —— mac 包里没有隧道二进制");
    /path\.join\(root, "cloudflared", "cloudflared"\)/.test(verifyTools)
      ? ok("【32】mac 产物校验断言 cloudflared 存在且有执行位")
      : fail("【32】mac 产物校验没有 cloudflared 断言 —— 缺了要到用户那儿才发现");
  }
}

{
{
    const toolbox = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
    const fnBody = sliceFn(toolbox, "export function bundledFfmpeg", 900);
    const shaped = /process\.platform === "win32" \? "ffmpeg\.exe" : "ffmpeg"/.test(fnBody)
      && /\["ffmpeg", "bin", exe\]/.test(fnBody)
      && /\["ffmpeg", exe\]/.test(fnBody);
    (shaped && /existingToolPath\(/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】ffmpeg 路径平台化且两种布局都找（userData/随包双根，不依赖 cwd）")
      : fail("【32】bundledFfmpeg 未覆盖平台差异 / 布局 —— mac 上渠道语音转码与整片合并必失败");
  }
}

{
{
    const fnBody = sliceFn(mainC, "function runtimeInstalledBySystem", 1400);
    (/\/Applications\/Docker\.app/.test(fnBody) && /opt\/homebrew\/bin\/docker/.test(fnBody))
      ? ok("【32】mac 上探测 Docker Desktop（装了不再显示「未安装」）")
      : fail("【32】darwin 分支没有 docker 探测 —— mac 装了 Docker 也一直显示「未安装」");
    /split\(path\.delimiter\)/.test(fnBody)
      ? ok("【32】docker 的 PATH 探测用 path.delimiter（不再写死「;」）")
      : fail("【32】docker 的 PATH 探测写死「;」 —— POSIX 上永远探不到");
  }
}

{
{
    const fnBody = sliceFn(mainC, "function npmShimPaths", 800);
    /path\.join\(globalDir, "bin", pkg\)/.test(fnBody)
      ? ok("【32】npm 全局 shim 清理覆盖 POSIX 的 bin/<pkg>")
      : fail("【32】npmShimPaths 缺 bin/<pkg> —— mac 上卸载 npm 包后 shim 残留指向空目录");
  }
}

{
{
    const fnBody = sliceFn(toolchainC, "export function toolchainEnv", 1400);
    (/const realPwsh = bundledPwsh\(\);/.test(fnBody) && !/pwsh", "pwsh\.exe"/.test(fnBody))
      ? ok("【32】CODEX_REAL_PWSH 走 bundledPwsh()（平台解析）")
      : fail("【32】toolchainEnv 仍写死 pwsh.exe —— mac 上 CODEX_REAL_PWSH 永不设置");
  }
}

{
{
    const fnBody = sliceFn(updaterC, "function tarExecutable", 420);
    /\/usr\/bin\/tar/.test(fnBody)
      ? ok("【32】engine-updater 在 darwin 用 /usr/bin/tar")
      : fail("【32】engine-updater 的 tarExecutable 没有 darwin 分支 —— mac 上靠裸名 tar，PATH 被改过就落空");
  }
}

{
{
    (/split\(path\.delimiter\)/.test(terminalC) && /path\.join\(dir, name\)/.test(terminalC) && !/split\(";"\)/.test(terminalC))
      ? ok("【32】终端查找用 path.delimiter + path.join（不再反斜杠拼接 / 写死「;」）")
      : fail("【32】terminal.ts 仍用反斜杠拼接或 split(\";\") —— POSIX 上候选目录解析全错");
    /process\.platform === "win32" \? `PS \$\{this\.cwd\}> ` : `\$\{this\.cwd\} \$ `/.test(terminalC)
      ? ok("【32】自绘提示符平台化（mac 不再显示 PowerShell 风格的「PS …>」）")
      : fail("【32】终端提示符没平台化 —— mac 上显示「PS /Users/x>」");
  }
}

{
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
}

{
{
    (/const DARWIN_SPEC_TEXT/.test(mainC) && /specFor\(id, spec\)/.test(mainC))
      ? ok("【32】开发工具卡文案按平台覆盖（git/openssl/docker 在 mac 上不再照搬 Windows 口径）")
      : fail("【32】缺少 DARWIN_SPEC_TEXT/specFor —— mac 上开发工具卡仍在说「装 Git / 约 90 MB」");
  }
}

{
{
    const { macHotkeyLabel } = await import("../../../src/lib/hotkey.mjs");
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
}

{
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
}

{
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
}

{
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
    // 10-28：用户令「统一那 13 页旧页头」⇒ 页面标题/副标题/页头 ? 整排删除，
    //   只剩内容卡里的上下文 ?（语音基础模型卡等）。不再要求数量，只防「说明摊回标题下」。
    (hintCount <= 2)
      ? ok(`【32】页头 ? 已收起（仅保留内容卡里的上下文 ? ${hintCount} 处）`)
      : fail(`【32】设置页一个 ? 都不剩 —— 连内容卡里的说明入口也被误删了？`);
    const keyedHints = ((appC + voiceC).match(/helpKey="/g) || []).length;
    /* 兼作「完整帮助」的 ?：页头大清洗后只剩语音卡与专家团（团队页）两处。 */
    (keyedHints >= 1)
      ? ok(`【32】${keyedHints} 处 ? 兼作「完整帮助」入口（HelpButton 退休后入口没丢）`)
      : fail(`【32】兼帮助入口的 ? 一个都不剩 —— 有页面的完整帮助从此打不开`);
    // ⛔ 比"数量够"更强的判据：**每个帮助主题都必须有 ? 入口**。数量达标不代表没有孤儿 ——
    //    「模型」页（标题是 provider-list-head、不是 settings-copy）与「专家和专家团」页
    //    （说明只有一句短话、不在收编名单里）的入口就真被漏掉了：内容库还在，用户点不到。
    //    这正是本条守卫要防的形态（本轮 code review 抓到的两个真问题之一）。
    // 10-26 二轮用户令：「自动配置和保存重启放到界面右下角，? 号删除」⇒ 模型页那枚 ? 随页头整块撤掉。
    //    这是**明确要求**，不是漏挂 ⇒ 下面把它从"必须有入口"的名单里摘出；内容库仍保留 model 主题，
    //    用户召回时再挂一个 ? 即可。⛔ 别把别的主题也塞进这个例外来消红（那正是本条要防的孤儿）。
    // 10-27 用户（MCP 页截图）：「右上角问号删了」⇒ MCP 页那枚 ? 同样撤掉、内容库保留 mcp 主题。
    // 10-27 用户（插件页）：「插件页删页头?」（commit 18f153b40）⇒ plugins 那枚 ? 也撤了，
    //    当轮漏改这条名单 ⇒ 一直红着「plugins 入口丢了」。同口径补进例外，别再留假红。
    //    同日技能中心也按用户令删掉了 ?（64b0856e2「删分类小字与帮助问号」）⇒ skills 一并列入。
    // 10-28 用户令「统一那 13 页旧页头」⇒ 开发工具页头整块删除，devtools 一并列入例外（内容库保留）。
    const NO_HINT_KEYS = ["model", "mcp", "plugins", "skills", "devtools", "agentteam"];
    const orphanKeys = HELP_KEYS.filter((key) => !NO_HINT_KEYS.includes(key) && !new RegExp(`helpKey="${key}"`).test(appC + voiceC));
    (orphanKeys.length === 0)
      ? ok(`【32】${HELP_KEYS.filter((key) => !NO_HINT_KEYS.includes(key)).length} 个帮助主题都有 ? 入口（模型 / MCP / 插件 / 技能 / 开发工具 / 专家团按用户令撤掉，不计）`)
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

    /* ── 【247】设置两处分组必须**逐组一致**（10-03 用户「设置菜单看着有点乱」）─────
       病根不是分组难看，而是**侧栏与总览各分各的**：截图/组件库/人格市场/收藏夹
       在总览归「开发工具」、在侧栏归「常用」⇒ 同一页在两处位置不同，用户以为两套菜单。
       【32】只钉「页名集合覆盖」，钉不住**归属** ⇒ 这里真解析两个数组逐组比对：
         组数 / 组名（按序）/ 每组页名集合，且不许出现过载（>6）或过轻（<2）分组。 */
    (() => {
      const navBlock = (appC.match(/export const settingsNav[\s\S]*?\n\];/) || [""])[0];
      const helpBlock = (helpC.match(/export const OVERVIEW_GROUPS[\s\S]*?\n\];/) || [""])[0];
      if (!navBlock || !helpBlock) return fail("【247】读不到 settingsNav / OVERVIEW_GROUPS（结构变了？）");
      const navGroups = [...navBlock.matchAll(/group:\s*"([^"]+)",\s*items:\s*\[([\s\S]*?)\]\s*\}/g)].map((g) => ({
        name: g[1],
        items: [...g[2].matchAll(/\[\s*"[a-z0-9-]+",\s*"([^"]+)"/g)].map((x) => x[1]),
      }));
      const helpGroups = [...helpBlock.matchAll(/group:\s*"([^"]+)"[\s\S]{0,400}?items:\s*\[([\s\S]*?)\n\s{4}\]/g)].map((g) => ({
        name: g[1],
        items: [...g[2].matchAll(/page:\s*"([^"]+)"/g)].map((x) => x[1]),
      }));
      if (navGroups.length !== helpGroups.length) {
        return fail(`【247】侧栏 ${navGroups.length} 组 ≠ 总览 ${helpGroups.length} 组 —— 两处分组必须逐组一致`);
      }
      for (let i = 0; i < navGroups.length; i++) {
        if (navGroups[i].name !== helpGroups[i].name) {
          return fail(`【247】第 ${i + 1} 组组名不一致：侧栏「${navGroups[i].name}」vs 总览「${helpGroups[i].name}」`);
        }
        const missing = navGroups[i].items.filter((x) => !helpGroups[i].items.includes(x));
        if (missing.length) return fail(`【247】「${navGroups[i].name}」组两处归属不同：总览缺 ${missing.join("、")}`);
        const size = navGroups[i].items.length;
        if (size > 6) return fail(`【247】「${navGroups[i].name}」有 ${size} 项（>6，侧栏一屏拉不到底）`);
        if (size < 2) return fail(`【247】「${navGroups[i].name}」只有 ${size} 项（独立成组很怪，并入邻近组）`);
      }
      return ok(`【247】设置两处分组逐组一致（${navGroups.length} 组 / ${navGroups.reduce((n, g) => n + g.items.length, 0)} 页，每组 2~6 项）`);
    })();
  }
}

{
{
    const hints = await import("../../../src/lib/enhance-hints.mjs");
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
    /* ⛔⛔ 10-31 真机实测修掉的缺陷：增强成功那一拍备份就被清掉 ⇒「可还原」态永远不出现
       （实测证据：增强完成时按钮仍是 ✨ / title "AI 优化提示词"，第二下点进 loading = 再增强，
       原文再也拿不回）。根因 = 失效判定只问「当前文本是否包含原文前 60 字」，而增强结果按提示
       只要求保留**意图**、几乎不逐字保留原话。判据因此锚在「给模型写回这一拍放行」上。 */
    /* ⛔ 正则**不带 bag. 前缀**：readAppUi() 的聚合视图会剥掉切分引入的前缀（见 _ctx 说明）。 */
    (/enhanceResultRef\.current = next;/.test(appC2) && /prompt === enhanceResultRef\.current\) return;/.test(appC2))
      ? ok("【32】增强写回的那一拍不清原文备份（prompt === enhanceResultRef ⇒ 放行）")
      : fail("【32】备份失效判定没给「模型刚写回」放行 —— 增强完成后按钮停在 ✨，还原不回去（真 bug）");
    (/enhanceBackupRef\.current = null;\s*\r?\n\s*enhanceResultRef\.current = "";/.test(appC2))
      ? ok("【32】还原后清掉「增强结果标记」（否则复用到同一字符串会误放行）")
      : fail("【32】还原路径没清 enhanceResultRef —— 同一段文本再增强一次后仍会误放行");
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
}

{
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
    (procIdx > 0)
      ? ok("【32】「正在处理 N 秒 + 灰线」不再依赖工具调用（回合内 userMessage 一到就显示）")
      : fail("【32】RunningProcessTime 的条件又被改掉（缺 userItems 会顶到用户消息上方；挂回 isTaskTurn 则纯聊天看不到）");
    /* ⛔ 10-28 用户（截图）：「回合第一个思考出来的时候，上面还有一排小字『思考中』，跟下面重复了」
       ⇒ 那条占位头（● 思考中 / 生成中）整块删除。负向断言：不许长回来。 */
    (!/turn-card-header/.test(appC3) && !/\? "思考中" : "生成中"/.test(appC3))
      ? ok("【32】回合内不再有「● 思考中 / 生成中」占位小字（与思考卡重复；10-28 用户令）")
      : fail("【32】占位小字又长回来了 —— 用户明确说它和下面的「深度思考中」重复");
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
    // 模型下拉徽标化（09-18 用户「选择样式还可以优化一下，现在不好看」；10-25 当前项改用底色，不再显示勾选）
    (/function modelBadges\(/.test(appC3) && /badges: modelBadges\(model\)/.test(appC3) && /\.menu-item-badges/.test(cssNC) && !/menu-item-check/.test(appC3))
      ? ok("【32】模型下拉每行带「图片/视频/上下文/输出」徽标，当前项用底色标识（不显示勾选）")
      : fail("【32】模型下拉徽标缺失，或右侧勾选又回来了（用户 10-25：选中有底色就行）");
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
    (/levels=\{\["low", "medium", "high", "xhigh"\]\}/.test(appNC))
      ? ok("【32】思考强度固定四档（低/中/高/极高，10-24 用户定稿）")
      : fail("【32】思考强度档位不是四档 —— 用户明确要「低中高极高这几个档位就行」");

    // 10-24 用户参考图定稿：一条绿→蓝渐变厚滑杆 + 常显白色圆点，四档标签。
    ok(/linear-gradient(90deg, #16a34a 0%, #0ea5e9 100%)/.test(effortPickerC), "【32】思考强度是绿→蓝连续渐变条");
    const effortTail = cssNC.slice(cssNC.indexOf("10-24：思考强度改成"));
    ok(/.effort-picker-thumb {[sS]{0,220}opacity: 1/s.test(effortTail), "【32】白色圆点常显（不再 hover 才出现）");
    ok(/.effort-picker-bead[sS]{0,160}display: none/s.test(effortTail), "【32】亮珠 / 刻点 / 火苗已隐藏（简洁版）");
  ok(/EFFORT_BANDS/.test(effortPickerC) && /xhigh: "linear-gradient(90deg, #16a34a 0%, #0ea5e9 55%, #2563eb 100%)"/.test(effortPickerC), "【32】渐变随档位变化（低偏绿 / 高偏蓝 / 极高绿→蓝→深蓝）");
  ok(/effort-picker-sparks/.test(effortPickerC) && /effort-picker-sparks i:nth-child(9)/.test(cssNC) && /@keyframes effort-spark/.test(cssNC), "【32】拉到极高有粒子特效（9 颗白色小星 + 光晕）");
    ok(/.effort-picker-bar.burn .effort-picker-fill[sS]{0,220}linear-gradient(90deg, #16a34a 0%, #0ea5e9 100%)/s.test(effortTail), "【32】拉满仍是绿→蓝（不再切火焰色）");

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
/* 10-17：取模型表达式已统一为 resolveStartModel(bag)（模型迁移校验，见 send.tsx）⇒ 锚点跟着走。
   ⛔ appNC 会剥 `bag.` 前缀（旧锚点没有 bag. 就是证据）⇒ 两种形态都要认。 */
    (/clearEffortUnsupported\(resolveStartModel\((bag)?\), (bag\.)?effort\)/.test(appNC))
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
}

{
{
    const appEnv = readAppUi();
    const envGone = !existsSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"));
    (!/EnvCheckDialog|envCheckOpen|installEnvMissing|env-install-pill|__envCheckDbg/.test(codeOnly(appEnv)) ? ok : fail)(
      "【32】首启体检弹窗已删净（组件文件 + 渲染 + 状态 + 角标；⛔ 不许复活 —— 新手引导走侧栏常驻入口）"
    );
    (envGone ? ok : fail)("【32】⛔ EnvCheckDialog 组件文件不许回来（删的是整个功能，不是藏入口）");
    const instDispatch = readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8");
    (/if \(id === "laya" \|\| id === "phone-harness"\)[\s\S]{0,400}?layaInstall\(\)[\s\S]{0,200}?installPhoneHarness\(\)/.test(instDispatch))
      ? ok("【32】runtime:install 对 Laya / 手机控制分派到各自的 pip 安装器（开发工具页「一键安装」不空转）")
      : fail("【32】runtime:install 没分派 laya / phone-harness —— 安装按钮会静默什么都不装");
  }
}

{
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
}

{
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
}

{
{
    const appSrc = readAppUi();
    const start = appSrc.indexOf('className="settings-section stack plugin-center"');
    // 结束 = 该 section 自身的收尾。
    //   ⛔ 原来用「下一个 `settingsPage === "skills"`」当结束标记 —— 09-21 plugins 块搬进
    //   src/features/settings-plugins/ 独立组件后，两者在 readAppUi() 的拼接串里**不再相邻**
    //   （App.tsx 在前、features 在后），indexOf 返回 -1 ⇒ 切出空串 ⇒ 假红「(section 没切出来)」。
    const end = appSrc.indexOf("</section>", start);
    const pluginSection = start >= 0 && end > start ? appSrc.slice(start, end) : "";
    // 10-27：刷新收成组件内一个 `const refreshButton`（三个视图各挂一次，同一时刻只显示一颗）
    //   ⇒ 判据看**定义**数（在 return 之外，切不进 pluginSection）+ 卡内是否真的挂上了。
    const refreshDefs = (readFileSync(join(ROOT, "src/features/settings-plugins/PluginsMarketSection.tsx"), "utf8").match(/title="刷新[^"]*"/g) || []);
    (refreshDefs.length === 1 && /\{refreshButton\}/.test(pluginSection) && !/title="刷新插件市场"/.test(appSrc) ? ok : fail)("【35】插件页只有一个刷新入口（refreshButton 挂在各视图卡内）");
    (/async function refreshPluginsPage\(\)[\s\S]{0,240}?refreshSettingsResources\(\)[\s\S]{0,140}?refreshMarketPlugins\(/.test(appSrc))
      ? ok("【35】那一个刷新确实两处都刷（页面资源 + 当前筛选的市场列表）")
      : fail("【35】refreshPluginsPage 没同时刷市场列表 —— 合并后市场再也刷不动，且界面不报错");
  }
}

{
{
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const targets = walk(join(ROOT, "src"), [".ts", ".tsx"]);
    const offenders = [];
    for (const entry of targets) {
      strip(readFileSync(entry.path, "utf8")).split(/\r?\n/).forEach((line, i) => {
        // ⛔ 1~2 个反斜杠都算：`\\codex-home`（源码里的转义形态，渲染出 `\codex-home`）与
        //    `\codex-home`（模板串里会被 JS 当转义吃掉 → 分隔符直接消失）都是错的。
        if (/\\{1,2}(codex-home|skills|sessions|plugins|commands|logs|pw-browsers)/.test(line)) {
          offenders.push(`${relative(ROOT, entry.path)}:${i + 1}`);
        }
      });
    }
    (!offenders.length)
      ? ok(`【36】渲染层没有写死的反斜杠展示路径（扫 ${targets.length} 个 ts/tsx，注释已剥离）`)
      : fail(`【36】渲染层出现写死反斜杠的展示路径：${offenders.slice(0, 4).join("、")} —— mac 上会显示成 /a\\b\\c`);
    // 10-27：技能中心那行说明随页头一起删掉了（用户令）⇒ 不再钉死某个消费点；
    //   判据改成「helper 在 + 除定义外至少一处调用」，写死反斜杠仍由上面那条负向扫描守。
    (/function displayPath\(base: string, \.\.\.parts: string\[\]\): string \{/.test(readAppUi()) ? ok : fail)(
      "【36】展示路径走 displayPath()（helper 在；写死反斜杠仍有上面那条负向扫描守着）");
  }
}

{
{
    const mainSrc = readMainSource();
    (/const inFlight = runtimeInstalls\.get\(id\);[\s\S]{0,300}?await inFlight;[\s\S]{0,120}?joined: true/.test(mainSrc)
      && !/throw new Error\("该工具正在安装"\)/.test(mainSrc))
      ? ok("【37】同工具并发安装改为「等它跑完」（不再抛「该工具正在安装」）")
      : fail("【37】runtime:install 又会在并发时抛错 —— 用户点「一键安装」会撞上「该工具正在安装」并整批中断");
  }
}

{
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
      && /isTurnEndMethod\(event\.method\)\) stopWeixinTyping\(/.test(mainSrc))
      ? ok("【38】typing 随回合起停（turn/started 起、**四类结束**都停 —— 10-10 修：只认 completed 时被中断的回合「正在输入」永不消失）")
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
}

{
{
    const mainProbe = readMainSource();
    const appProbe = readAppUi();
    const hookProbe = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");
    (/probingViaBridge \? \["responses"\] : \["responses", "chat"\]/.test(mainProbe))
      ? ok("【39】探针：非桥路径 responses 被拒仍回落 chat；**走桥路径只探 responses**（桥负责翻译，绕桥去测 chat 是在测一条引擎不走的路）")
      : fail("【39】探针协议顺序丢了「走桥/直连」的区分 —— 火山 Coding Plan 类网关会误报，云模型也会误报");
    (/coding plan\/i\.test\(body\)/.test(mainProbe) && /白话：供应商表示这个模型不在其 Coding Plan/.test(mainProbe))
      ? ok("【39】coding-plan 404 带白话提示（告知换通用接入点/换模型，不再只有供应商原话）")
      : fail("【39】coding-plan 404 没有白话提示 —— 用户看到 404 无从下手");
    (/wireMismatch: !probingViaBridge && wireUsed !== requestedWire/.test(mainProbe) && /wireMismatch/.test(hookProbe))
      ? ok("【39】直连路径如实标注协议差异；**走桥路径不报**（桥负责翻译，报了就是把用户吓死）")
      : fail("【39】探针协议差异的上报规则丢了（直连要报、走桥不报）");
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
}

{
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
}

{
{
    const appEnv = readAppUi();
    // 按注释锚点切出两个 effect 的块：在全文里裸正则容易误命中别处的同名字符串
    // ⛔ 10-01 用户定稿：模型配置引导整体删除（首启只弹「开发工具」引导）——
    //   断言从「引导在位」翻转为「引导清零」；体检触发/登录链路各自独立成立。
    // ⛔ 10-02：① 匹配前必须过 codeOnly —— 本仓的注释里会原样写出这个字符串来解释隐患
    //    （我刚在为这次事故补注释时就撞成假红）；② 必须**大小写不敏感** —— `setShowModelGuide`
    //    的大写 S 会让小写正则恒真，正是这个恒真放过了 send.tsx 里那句悬空调用（真 bug）。
    (!/showModelGuide/i.test(codeOnly(appEnv)) ? ok : fail)("【32】模型引导状态全仓清零（app-ui 层不许再有 showModelGuide，含 setter）");
    (!/ModelSetupGuide/.test(appEnv) ? ok : fail)("【32】ModelSetupGuide 渲染清零（不许再有引导弹窗挂树）");
    (!/setEnvCheckOpen|missingCore|envCheckDoneRef/.test(appEnv) ? ok : fail)(
      "【32】体检触发链已清零（missingCore / setEnvCheckOpen / done 标记全删 —— 启动不再有任何引导弹窗）"
    );
  }
}

{
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
}
}
