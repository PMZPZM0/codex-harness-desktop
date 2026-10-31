/** 07-turn-fold 第 5/6 段：原 07-turn-fold.mjs L3660–L4560（逐字搬运 + 各自成块）。
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



export async function run() {
{
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
  // 用户明确要求「codex 自己也可以下载」⇒ 技能里必须给出**可用的 pip 命令 + 换源指引**。
  // ⛔ 10-02：不能再钉「清华源」——清华的索引页 200 但 wheel 直链 403，单源命令会让引擎
  //    卡在同一个 403 上反复重试（用户实测三处报障）。命令要指向可用镜像，并写明 403 时怎么换源。
  (/pip install[^\n]*"markitdown\[pdf,docx,pptx\]"[^\n]*\n/.test(bs82) && /403/.test(bs82) && /pypi\.org\/simple/.test(bs82) ? ok : fail)(
    "【82】document-convert 技能给出「Codex 自己装」的命令 + 403 换源指引（单源命令会让引擎卡死在同一个 403）"
  );
  // ⛔ 安全约束：i-have-adhd 会重塑**全部**输出的写法 ⇒ 必须保持「只有用户显式调用才生效」。
  //    引擎认这个字段（二进制里有 disable-model-invocation / disable_model_invocation 两个名字），别删。
  (/^disable-model-invocation: true$/m.test(codeOnly(bs82)) ? ok : fail)(
    "【82】i-have-adhd 保留 disable-model-invocation: true（删掉它 = 模型可能自动把全部输出改成 ADHD 风格）"
  );
}
}

{
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
  // ⛔ 锚**成员关系**而不是尾部字面量：原先写死 `"openssl" | "markitdown";`，
  //    09-27 往联合类型尾部追加 "platform-tools" 后这条就假红了（断言本身在骗人）。
  const devRuntimeIdLine = (main83.match(/type DevRuntimeId = [^\n]+/) ?? [""])[0];
  (devRuntimeIdLine.includes('"markitdown"') ? ok : fail)("【83】DevRuntimeId 收录 markitdown");
  (/markitdown: \{ name: "文档转换（markitdown）"/.test(main83) ? ok : fail)(
    "【83】「开发工具」页有「文档转换（markitdown）」卡片"
  );
  // ⛔ 10-01：markitdown 的专有分支已泛化为**pip 包通用表** PIP_PACKAGE_DIRS
  //    （markitdown / laya / phone-harness 同一套：判定看 site-packages 下的包目录，卸载只删包目录）。
  (/const PIP_PACKAGE_DIRS[\s\S]{0,300}?markitdown: "markitdown"/.test(main83) ? ok : fail)(
    "【83】pip 包类工具走 PIP_PACKAGE_DIRS 通用表（包名单一真相源，不再一处一写）"
  );
  (/PIP_PACKAGE_DIRS\[id\][\s\S]{0,200}?pythonSiteDir\(path\.join\(root, "python"\)\)/.test(main83) ? ok : fail)(
    "【83】pip 包的「装没装」判定看 site-packages 下的包目录（路径含 Python 版本号，不能走 marker）"
  );
  // ⛔ 最危险的一条：卸载路径。marker 首段推导会得到 tools/python —— 卸载文档转换会把整个 Python 删光
  (/if \(pipDir\) \{[\s\S]{0,200}?pythonSiteDir\(path\.join\(writeToolsRoot\(\), "python"\)\)/.test(main83) ? ok : fail)(
    "【83】卸载只删 pip 包目录（userData 安装根；不按 marker 首段推 → 否则会删掉整个 Python 运行时）"
  );
  // 卡片的体积提示必须与实测同量级（写小了会误导用户点）
  (/markitdown[\s\S]{0,400}?size: "约 \d+ MB"/.test(main83) ? ok : fail)(
    "【83】卡片标注了体积（用户点之前要知道要下多大）"
  );
}
}

{
{
  const main84 = readMainSource();
  const app84 = readAppUi();

  /* 09-29：落盘函数多了可选产物目录参数（persistGeneratedImage(url, dirOverride?)），
     断言锚到「有 url: string 形参」即可 —— 本条的意图是「生图结果落盘、不回传 base64」。 */
  (/async function persistGeneratedImage\(url: string/.test(main84) ? ok : fail)(
    "【84】有 persistGeneratedImage（生图结果落盘，而不是把 base64 回传）"
  );
  (/persistGeneratedImage[\s\S]{0,700}?app\.getPath\("userData"\), "images"/.test(main84) ? ok : fail)(
    "【84】落盘目录是 <userData>/images（与命令行路径 harness-media.mjs 同目录，不造第二套落点）"
  );
  (/return \{ path, url: \/\^https\?:\/i\.test\(url\) \? url : "" \};/.test(main84) ? ok : fail)(
    "【84】generateImageWith 回的是 { path, url }，且 url 仅真托管地址才有（data URL 绝不回传）"
  );
  (/已生成 \$\{saved\.length\}/.test(main84) ? ok : fail)(
    "【84】生图返回文本只用**本地落盘路径**（10-09 执行端搬进主进程 image-lab:generate；托管地址 / data URL 都不进返回文本）"
  );
  (!/\+\s*result\.url/.test(app84) ? ok : fail)(
    "【84】App 侧不得再把 result.url 直接拼进返回文本（一拼就有 MB 级 base64 进对话历史）"
  );
  // ⛔ 10-30 视觉辅助插件整体移除：describe_image 工具 / toImageSource 识图链已删，负向防复活。
  (!/builtin:describe-image|name: "describe_image"/.test(main84 + app84) ? ok : fail)(
    "【84】describe_image 工具链不许复活（10-30 视觉辅助插件整体移除）"
  );
  const pkg84 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  (/verify-image-plugin/.test(String(pkg84.scripts?.check ?? "")) ? ok : fail)(
    "【84】verify-image-plugin（b64 必须落盘的行为断言）挂在 npm run check 链上"
  );
}
}

{
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
      nuphusAvailable: true, imagePlugin: true,
      egoBrowser: false, markitdown: false,
    };
    const pick = (rows, id) => rows.find((r) => r.id === id) || {};
    const alt = (rows, capId, altId) => (pick(rows, capId).alternatives || []).find((a) => a.id === altId) || {};

    const allOn = reg.resolveCapabilities(base);
    (pick(allOn, "browser").activeId === "nuphus-cli-browser" && pick(allOn, "desktop").activeId === "nuphus-desktop" ? ok : fail)(
      "【85】总闸开着时桌面走 nuphus；未装 Ego Lite 时浏览器回落 browse-skills（nuphus-call 默认浏览器）"
    );

    // ⛔ 10-30 视觉辅助插件整体移除：看图能力只剩本地 OCR 一条后端；BYOK 视觉模型两条旧后端不许复活。
    const visionBackends = (reg.CAPABILITIES.find((c) => c.id === "vision")?.backends ?? []).map((b) => b.id);
    (visionBackends.length === 1 && visionBackends[0] === "local-ocr" ? ok : fail)(
      `【85】看图能力只剩本地 OCR 一条后端（实测 ${visionBackends.join("/")}；nuphus-vision / 内置识图工具不许复活）`
    );
    (pick(allOn, "vision").activeId === "local-ocr" ? ok : fail)(
      "【85】总闸开着时看图走本地 OCR（视觉插件已移除，无 BYOK 视觉模型路径）"
    );

    // 反转用例：总闸关掉 ⇒ **依赖 nuphus 的后端**全部不可用（掩码是硬阻断，不是提示词约束）。
    const allOff = reg.resolveCapabilities({ ...base, desktopSwitch: false, browserSwitch: false });
    (pick(allOff, "browser").activeId === null
      && pick(allOff, "desktop").activeId === null
      && pick(allOff, "vision").activeId === null ? ok : fail)(
      "【85】总闸关掉后依赖 nuphus 的后端全不可用（看图只剩 OCR 一条，跟着总闸一起关）"
    );

    // Intel Mac 没有本地 OCR 的平台二进制（ONNX 已放弃 osx-x64）；Apple Silicon 必须相反
    const intelMac = reg.resolveCapabilities({ ...base, platform: "darwin", arch: "x64" });
    (pick(intelMac, "vision").activeId === null && alt(intelMac, "vision", "local-ocr").available === false ? ok : fail)(
      "【85】Intel Mac 上本地 OCR 判为不可用，视觉能力整体判为无可用后端"
    );
    const armMac = reg.resolveCapabilities({ ...base, platform: "darwin", arch: "arm64" });
    (pick(armMac, "vision").activeId === "local-ocr" ? ok : fail)(
      "【85】Apple Silicon 同条件下本地 OCR 可用（与 Intel Mac 结论相反 ⇒ 平台判据真的生效）"
    );

    // 没装的后端不许被报成「可用」；但 nuphus 回落仍应接住浏览器自动化
    (pick(allOn, "browser").activeId === "nuphus-cli-browser" && pick(allOn, "documents").activeId === null ? ok : fail)(
      "【85】没装 Ego Lite 时浏览器回落 nuphus-call；没装 markitdown 时文档转换判无可用后端"
    );
    const withEgo = reg.resolveCapabilities({ ...base, egoBrowser: true, markitdown: true });
    (pick(withEgo, "browser").activeId === "ego-browser" && pick(withEgo, "documents").activeId === "markitdown" ? ok : fail)(
      "【85】装上 Ego Lite / markitdown 以后切到首选通道且文档就绪（与上一条互为反转）"
    );
    const noNuphus = reg.resolveCapabilities({ ...base, nuphusAvailable: false });
    (pick(noNuphus, "browser").activeId === null ? ok : fail)(
      "【85】Ego 与 nuphus 都不可用时浏览器判无可用后端"
    );
  }

  // 唯一来源约束：界面只渲染快照、主进程采集判据复用现有来源（不另读一遍设置/插件）
  const app85 = readAppUi();
  (/capabilitiesSnapshot\(\)/.test(app85) ? ok : fail)(
    "【85】界面走 capabilities:snapshot 取快照（不是自己拼一套判据）"
  );
  const main85 = readMainSource();
  (/devInstructionsInput\(\)/.test(main85) ? ok : fail)(
    "【85】主进程采集判据复用 devInstructionsInput（总闸与插件配置的唯一来源，不另读一遍）"
  );
  // ⛔ 10-30 视觉辅助插件整体移除：探针字段不许复活
  (!/nuphusVisionEnv|visionPlugin/.test(main85) ? ok : fail)(
    "【85】能力探针的 nuphusVisionEnv / visionPlugin 字段不许复活（视觉插件已移除）"
  );
}
}

{
{
  let scan = null;
  try { scan = await import("../../../scripts/lib/config-scan.mjs"); } catch { scan = null; }
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
}

{
{
  let steps87 = null;
  try { steps87 = await import("../../../src/lib/plan-steps.mjs"); } catch { steps87 = null; }
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
}

{
{
  const di88 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  const main88 = readMainSource();
  const agentsMain88 = readFileSync(join(ROOT, "electron", "main", "09-agents-plugins.ts"), "utf8");
  const boot88 = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");

  (!existsSync(join(ROOT, "electron", "builtin-agents.ts")) ? ok : fail)(
    "【88】内置评审子智能体的配置模块已删除（electron/builtin-agents.ts）"
  );
  (!/ensureBuiltinReviewer/.test(main88 + boot88) && !/ensureBuiltinReviewer/.test(agentsMain88) ? ok : fail)(
    "【88】不再种入内置评审子智能体（启动链 / 主进程 / boot 都不许再有 ensureBuiltinReviewer）"
  );
  (!/评审（新鲜上下文）/.test(di88) && !/fresh-context review/.test(di88) ? ok : fail)(
    "【88】指令里不再让模型去派「评审（新鲜上下文）」（对象都没了，命令只会让它白烧一个回合）"
  );
  (/REVIEW_INSTRUCTIONS/.test(di88) && /self-review before handing over/.test(di88)
    && /text \+= REVIEW_INSTRUCTIONS;/.test(di88) ? ok : fail)(
    "【88】交付前自查仍在：改成模型自己复查（⛔ 算了常量却没拼进去 = 死代码）"
  );
}
}

{
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
    !/window\.codex\.relayLogout|relayLogout:/.test(relayUi89) && !/relayLogout/.test(readFileSync(join(ROOT, "electron", "preload.ts"), "utf8")) && !/(?:ipcMain|ipcHost)\.handle\("relay:logout"/.test(mainSrc89)
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
    /(?:ipcMain|ipcHost)\.handle\("relay:overview", async \(_e, id\?: string\)/.test(mainSrc89) && /relayOverview\(account\?\.id\)/.test(relayUi89)
      ? ok("★ 管理面板按「被点开的账号」读余额/套餐/密钥（不再一律读生效账号）")
      : fail("面板仍读生效账号 —— 点开别的账号只会看到别人的数据");
    (relayUi89.match(/!isLiveRow\(account\.id\)/g) || []).length >= 2 && /不是当前生效账号/.test(relayUi89)
      ? ok("★ 非生效账号禁用「使用此套餐/使用」并给出提示（激活动作不许落到别的账号上）")
      : fail("非生效账号仍能直接激活 —— 会作用到当前生效账号上");
  }
}
}

{
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
    // ⛔ 10-03：域改成插件形态后，通道注册走容器注入的 ipcHost.handle（electron/ipc-host.ts）。
    //    这里的计数必须同时认两种写法，否则"搬走 = main.ts 里应消失/域文件里应存在"两条判据都会假红。
    for (const mm of src.matchAll(/(?:ipcMain\.(?:handle|on|removeHandler)|ipcHost\.handle)\(\s*["']([^"']+)["']/g)) {
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
      const inFile = (fSrc.match(new RegExp(`(?:ipcMain\\.(?:handle|on|removeHandler)|ipcHost\\.handle)\\(\\s*["']${prefix}:`, "g")) || []).length;
      (inFile >= count ? ok : fail)(`【90】已拆域 ${prefix}：${file} 应有 ≥ ${count} 个通道（实际 ${inFile}）`);
    } else {
      const actual = mainCounts90.get(prefix) || 0;
      (actual === count ? ok : fail)(`【90】域 ${prefix}（${status}）：main.ts 通道数 ${actual} = 账本 ${count}（不一致 = 账本过期或有人搬了没记账）`);
    }
  }
}
}

{
{
  console.log(C.bold("\n【112】过程折叠块的概要统计（分类纯函数仍在位；**展示已按用户 09-23 要求删除**）与两条折叠规则的分工"));
  let cls = null;
  try { cls = await import("../../../src/lib/tool-call-classify.mjs"); }
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
    // ⛔ 10-06：两个签名多了可选的 renderAfter（运行中实时编辑行的锚点钩子）——判据按「含它也行、
    //    核心默认值必须原样」放宽（limit = 3 / cap = true 仍是硬条件）。
    (/export function CappedToolRun\(\{ label, units, renderUnit,( renderAfter,)? limit = 3 \}/.test(cards112)
      ? ok : fail)("【112】「相同工具连续调用超过 3 条」规则仍在（CappedToolRun 默认 limit = 3）");
    (/hiddenCount = Math\.max\(0, units\.length - limit\)/.test(cards112) ? ok : fail)("【112】超出 limit 的那部分才收进折叠行");
    (/export function CappedToolSequence\(\{ units, renderUnit,( renderAfter,)? cap = true(, unitLimit)? \}/.test(cards112)
      ? ok : fail)("【112】CappedToolSequence 有 cap 开关（默认开启 = 不改变既有行为）");
    (/if \(cap === false\) return/.test(cards112) ? ok : fail)("【112】cap=false 时逐条原序渲染（不再分组截断）");
    (/if \(unitLimit && units\.length > unitLimit\)/.test(cards112) && /<CappedToolRun label="过程"/.test(cards112) ? ok : fail)(
      "【112】直播末段整段上限：工具/命令/编辑/搜索/看图/已结束思考超过 N 条收起（不再只限同一工具）"
    );
  }

  /* ⑥ 样式收口：统计的样式规则已随渲染一起删掉（不留死 CSS）。 */
  (!/\.wb-fold-stats\s*\{/.test(readStyles()) ? ok : fail)("【112】.wb-fold-stats 样式规则已随渲染一起删除（不留死 CSS）");
}
}

{
{
    console.log(C.bold("\n【118】过程折叠：长正文锚点 / 单条过程也收 / 意图词标题 / 命令行剥壳"));
    let cd = null;
    try { cd = await import("../../../src/lib/command-display.mjs"); }
    catch (error) { fail(`【118】command-display.mjs 读不到：${error?.message ?? error}`); }
    const foldPlan = await import("../../../src/lib/turn-fold-plan.mjs");

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
      /* ⛔ 10-29 用户实测（「已运行为啥后面不显示运行了啥命令」）：标题映射的**真值表** ——
         用户截图里这几种都是坏映射（「跑脚本 --version」「跑脚本 -e」「已查看 dir」），逐条钉住。 */
      (cd.commandAction("node --version") === "看 node 版本" ? ok : fail)(
        `【118】裸开关不算脚本名（实得 ${JSON.stringify(cd.commandAction("node --version"))}）`
      );
      (cd.commandAction('node -e "console.log(1)"') === "跑 node 脚本" ? ok : fail)(
        "【118】node 内联脚本给中性动作（不把 -e 当脚本名）"
      );
      (cd.commandAction('node -e "const x=\'a\';fs.writeFileSync(\'b\',\'c\')"') === "写文件" ? ok : fail)(
        "【118】内联脚本里写文件时按「写文件」判（写语义优先；引号里的 `;` 不许拆成两步 ⇒ 否则拼出「跑 node 脚本并写文件」）"
      );
      (cd.commandAction("dir") === "看目录内容" && cd.commandAction("ls -la") === "看目录内容" ? ok : fail)(
        "【118】列目录有中文动作（原来只剩「已查看 dir」）"
      );
      (cd.commandAction("cat package.json") === "读文件 package.json" ? ok : fail)(
        "【118】读文件带上文件名"
      );
      (cd.commandPurpose('"Write-Output \'=== 当前目录 ===\'; Get-Location"') === "当前目录" ? ok : fail)(
        "【118】整段命令被一层引号包住时，用途取里面的标签字面量（不许把整段脚本当标签）"
      );
    }

    /* ③ 折叠口径（真跑 planCompletedFold）—— ⛔⛔ 10-10 用户定稿（原话）：
       「不管回合时间多长，运行过程中有多少步骤，在结束的时候，运行过程必须完全折叠进去，
       只保留汇总结果和汇总消息下面的已修改文件板块」。
       ⇒ **废除长正文锚点**（09-12/09-23 的「≥200 字留在外面」把超长回合的过程切成多段，
       用户 10-10 截图反馈「不会折叠整个运行过程」）—— 折叠组外只留：用户消息 + 最终汇总。
       已知并接受的代价：结尾「长汇报 → 工具 → 一句话收尾」时，长汇报也进折叠组（点开可见）。 */
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
      (bodies.length === 1 && bodies[0] === "bodyFinal" ? ok : fail)(
        `【118】折叠组外只留汇总结果（bodies=${bodies.join(",")}）`
      );
      (folds.length === 1 ? ok : fail)(`【118】整个运行过程收成一块折叠（实得 ${folds.length} 组：${JSON.stringify(folds)}）`);
      (folds[0]?.includes("bodyLong") && folds[0]?.includes("bodyShort") && folds[0]?.includes("toolA") && folds[0]?.includes("toolD") ? ok : fail)(
        "【118】长正文/短过渡/工具/思考全部进折叠组（过程不切碎）"
      );
      const empty = foldPlan.planCompletedFold(
        [unit("toolX", "commandExecution"), unit("bodyEmpty", "agentMessage", "   ")], "none",
      );
      ((empty.find((entry) => entry.kind === "fold")?.units ?? []).some((u) => u.item.id === "bodyEmpty") ? ok : fail)(
        "【118】空正文的 agentMessage 不算汇总结果（仍按过程处理）"
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
      (/\? `fold-completed-\$\{turn\.id\}-\$\{index\}`[\s\S]{0,1600}?defaultOpen=\{keepProcessOpen\}/.test(seq)
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
      /* ★ 10-22 口径变更（用户：「默认仅展示中文名称，隐藏具体命令内容；展开后才看完整命令」）：
         表头不再放命令行（原来锚的是 displayCommand(command) 那一串）⇒ 改判「表头 = 中文动作短语
         + 明确的展开标识」，命令原文只在展开体。⛔ 别把这条断言退回旧口径 —— 那等于把命令行塞回折叠行。 */
      /* 10-22 二改（用户：「『展开』字样不要，鼠标放上去再浮出箭头，移开就隐藏」）：
         折叠行只剩中文动作 + 悬停浮现的箭头。⛔ 别再退回带「展开/收起」文字的老形态。 */
      (/\{headline \|\| verb\}/.test(panel) && /className="cmd-toggle"/.test(panel) && !/cmd-toggle-text/.test(panel) ? ok : fail)(
        "【118】命令卡片折叠行 = 中文动作短语 + 悬停浮现的箭头（无「展开」字样，10-22 二改）"
      );
      (!/cmd-command/.test(panel) ? ok : fail)(
        "【118】折叠行不许再放命令行（`.cmd-command` 已随需求删除，⛔ 别当死代码又加回来）"
      );
      /* ⛔ 展开里的完整命令必须是引擎原文（用户要照着复现）——剥壳只用于展示 */
      (/const command = String\(item\.command \?\? ""\)\.trim\(\);/.test(panel) ? ok : fail)(
        "【118】完整命令仍取引擎原文（剥壳只用于展示）"
      );
    }
  }
}

{
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
    /* ⛔ 10-31：插队分段后「completed 皮肤只给 lead 段」多了一道 `completedSkin` 门
       （非末段不挂回合收尾皮肤 —— 耗时属于整个回合）。两种写法都算：带门与不带门。 */
    const leadTernary = (seqLine.match(/variant=\{(?:index === leadFoldIndex|lead)(?: && completedSkin)? \? "completed" : "summary"\}/g) || []).length;
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
}
}
