/** 07-turn-fold 各段共用的只读上下文（原 07-turn-fold.mjs 里 run() 开头的一组声明，逐字搬运）。
 *  ⛔ 拆段后每段是独立模块 ⇒ 这些「读文件 / 切片」的小工具必须单独成文件，否则后段引用会 ReferenceError。 */
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

export { stripC, mainC, toolchainC, terminalC, remoteC, updaterC, voiceSettingsC, voiceSectionC, hotkeyMatchC, macCfg, prepMac, verifyTools, sliceFn };
