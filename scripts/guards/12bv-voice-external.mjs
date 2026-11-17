/**
 * 12bv-voice-external —— 开源语音模型卡片（11-16 用户令）
 *
 * 用户口径：把 Voicebox / OmniVoice Studio / GPT-SoVITS / CosyVoice 3 / Qwen3-TTS /
 * Chatterbox / Qwen3-TTS / TTS-WebUI / Zonos 做成语音模型界面的卡片，
 * 按需下载；**默认展示 4 张**，更多展开/收起；启用与播报联动（同时只启用一个）。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 * ⛔⛔ 11-17 用户令：**非商用权重的引擎一律不进目录**（IndexTTS2 / F5 / Fish 已移除）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (condition, message) => { checks++; console.log(`  ${condition ? "✓" : "✗"} 【ext】${message}`); if (!condition) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const catalog = read("src/lib/voice-external-engines.mjs");
const main = read("electron/voice/external-engines.ts");
const service = read("electron/voice/voice-service.ts");
const ipc = read("electron/features/voice-ipc/05-voice-external.ts");
const index = read("electron/features/voice-ipc.ts");
const ui = read("src/components/VoiceSettingsSection/VoiceExternalEnginesSection.tsx");
const enginesUi = read("src/components/VoiceSettingsSection/02-tts-engines.tsx");
const modal = read("src/components/VoiceSettingsSection/02-tts-engines.tsx");
const css = read("src/styles/18-openai-dialog.css");
const manifest = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const preload = read("electron/preload.ts");
const dts = read("src/vite-env.d.ts");
const pkg = JSON.parse(read("package.json"));

const IDS = ["gpt-sovits", "cosyvoice3", "qwen3-tts", "chatterbox", "zonos", "voicebox", "voice-studio", "tts-webui"];
const missingIds = IDS.filter((id) => !catalog.includes(`id: "${id}"`));
ok(missingIds.length === 0, `8 个开源项目全部在目录里（缺：${missingIds.join("、") || "无"}）`);

const defaults = catalog.match(/VOICE_EXTERNAL_DEFAULT_IDS = \[([^\]]+)\]/)?.[1] ?? "";
ok((defaults.match(/"/g) ?? []).length === 8, "默认展示 4 张推荐卡片（用户令）；其余走「更多展开」");

ok(["clone", "dialect", "design", "dialog", "studio", "lab"].every((id) => catalog.includes(`id: "${id}"`)),
  "分类 chips 只保留有卡片的分类（克隆 / 方言 / 设计 / 对话 / 工作台 / 实验；移除后不留空 tab）");

ok(!/id: "f5-tts"/.test(catalog) && !/id: "fish-speech"/.test(catalog) && !/id: "indextts2"/.test(catalog)
  && !/commercial: "no"/.test(catalog) && !/commercial: "conditional"/.test(catalog)
  && /id: "voice-studio"[\s\S]*?commercial: "agpl"/.test(catalog),
  "非商用权重的引擎（IndexTTS2 / F5 / Fish）已从目录移除；AGPL（VoiceStudio）保留明确标记");

ok(/GPT-SoVITS-v2pro-20250604\.7z/.test(catalog) && catalog.includes("bytes: 8185086602") && /kind: "archive"/.test(catalog),
  "GPT-SoVITS 下载源锚定官方便携包（ModelScope v2pro，8,185,086,602 字节）");

ok(/zipUrl: `https:\/\/codeload\.github\.com\/FunAudioLLM\/CosyVoice\/zip\/\$\{COSYVOICE_COMMIT\}`/.test(catalog)
  && /COSYVOICE_COMMIT = "[0-9a-f]{40}"/.test(catalog)
  && ["flow.pt", "llm.pt", "hift.pt", "speech_tokenizer_v3.onnx"].every((f) => catalog.includes(`"${f}"`)),
  "CosyVoice3 源码钉死提交 + 模型文件清单（flow/llm/hift/tokenizer）");

ok(main.includes("7z.exe") && main.includes("uv.exe") && main.includes("python.exe"),
  "安装器复用随包 7z / uv / 引擎自带 runtime");
ok(main.includes("127.0.0.1") && !/shell:\s*true/.test(main) && main.includes("windowsHide: true"),
  "外部服务只监听 127.0.0.1；spawn 不开 shell");
ok(main.includes("for (const other of Object.keys(SERVICES)) if (other !== id) stopService(other);") && main.includes("state.active = id"),
  "同一时间只允许启用一个外部引擎（切换先停旧的）");
ok(main.includes("stopAllExternalEngines") && main.includes('app.on("will-quit"'),
  "应用退出时停掉外部引擎进程");
ok(main.includes("killProcessTree") && main.includes('"taskkill"') && main.includes('"/T"'),
  "按进程树终止外部服务（Windows 上只 kill 直接子进程会留下占端口的孙进程）");
ok(main.includes("harness_adapter.py") && /HTTPServer\(\('127\.0\.0\.1'/.test(main),
  "CosyVoice 适配器自带、只绑本机");
ok(main.includes("harness_requirements.txt") && main.includes("openai-whisper") && main.includes("setuptools==69.5.1"),
  "CosyVoice 依赖修正：剥 extra-index / setuptools 69 / whisper 无隔离构建（实测三个坑）");
ok(main.includes("renameSync(extractedRoot, appDir)"),
  "CosyVoice 源码解压后收敛到短路径（Windows 260 字符上限）");
ok(/format === 3 && bits === 32/.test(main),
  "WAV 解析支持 32 位浮点（CosyVoice/torchaudio 输出）与 16 位 PCM（GPT-SoVITS）");
ok(main.includes("ensureLongReference") && main.includes("3.4 - duration"),
  "GPT-SoVITS 参考音频不足 3 秒自动补静音（不改原文件）");
ok(main.includes("speed_factor") && main.includes("/tts?"),
  "GPT-SoVITS 合成走官方 /tts（文本/参考音频/语速）");

const extIndex = service.indexOf("externalEngineSpeak(clean");
ok(extIndex > -1 && extIndex < service.indexOf("const remote = remoteTtsConfig(settings)"),
  "播报/通话合成优先级：启用的外部引擎 > MOSS > 本机（未启用返回 null）");
ok(service.includes("activeExternalEngine()") && service.includes("warmExternalEngine()"),
  "预热/首句：启用了外部引擎时预热它的服务");

{
  const channels = ["voice:external-list", "voice:external-install", "voice:external-cancel", "voice:external-remove", "voice:external-enable", "voice:external-open", "voice:external-reveal"];
  const methodOf = (ch) => "voice" + ch.replace("voice:", "").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  const missing = channels.filter((ch) => !ipc.includes(`"${ch}"`) || !index.includes(`"${ch}"`) || !manifest.includes(`"${ch}"`) || !registry.includes(`"${ch}"`) || !preload.includes(methodOf(ch)) || !dts.includes(methodOf(ch)));
  ok(missing.length === 0, `七条外部引擎通道在 域/manifest/registry/preload/d.ts 四处一致（缺：${missing.join("、") || "无"}）`);
}

ok(ui.includes("VOICE_EXTERNAL_DEFAULT_IDS") && ui.includes("!expanded ? recommended : filtered"),
  "卡片默认只渲染 4 张推荐；展开后才渲染全部");
ok(ui.includes("更多展开") && ui.includes("收起") && ui.includes("voice-ext-chip"),
  "有「更多展开（还有 N 个）」与「收起」，分类 chips 可筛选");
ok(ui.includes("data-external-card") && ui.includes("voice-ext-badge"),
  "卡片带 data-external-card（验收锚）与许可徽标");
ok(modal.includes("VoiceExternalEnginesSection"), "卡片接进「基础模型配置」弹窗（不另开页面）");
ok(css.includes(".voice-ext-grid") && css.includes("repeat(2, minmax(0, 1fr))") && css.includes(".voice-ext-chip"),
  "卡片双列布局 + 窄屏单列 + 分类 chips 样式");

ok(!existsSync(join(ROOT, "resources", "voice-engines")) && !existsSync(join(ROOT, "resources", "tts-engines")),
  "引擎不进安装包（全部下载到 userData/voice-engines）");

/* 11-17：移除三个非商用权重后，可安装的克隆引擎只剩 Chatterbox / Qwen3（GPT-SoVITS / CosyVoice 各自装法）。 */
const pythonIds = ["chatterbox", "qwen3-tts"];
ok(pythonIds.every((id) => new RegExp(`id: "${id}"[\\s\\S]*?kind: "python"[\\s\\S]*?adapter: "${id}"`).test(catalog)),
  "Chatterbox / Qwen3 都有 Python 安装描述（kind=python + adapter）");
ok(!/INDEXTTS_COMMIT/.test(catalog) && !/IndexTeam\/IndexTTS-2/.test(catalog) && !/F5TTS_v1_Base/.test(catalog),
  "非商用引擎的安装源与权重清单已一并删干净（不留死配置）");
ok(catalog.includes('repo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base"'), "Qwen3 用 0.6B-Base（含 speech_tokenizer）");
ok(/t3_mtl23ls_v2\.safetensors/.test(catalog) && /s3gen\.pt/.test(catalog) && /Cangjie5_TC\.json/.test(catalog),
  "Chatterbox 多语模型文件齐全（ve / t3 v2 / s3gen / grapheme / conds / Cangjie5）");
ok(/id: "zonos"[\s\S]*?install: null/.test(catalog) && /官方只支持 Linux\/macOS/.test(catalog),
  "Zonos 官方不支持 Windows：保留信息卡，不假装可装");
ok(!catalog.includes("首批暂未接入"), "已接入的卡片不再出现「首批暂未接入」字样");

/* 硬件门槛（11-16 用户令「注释好，那些需要高配置电脑」）：8 张卡都要有 demand/hardware；
   高配两张（Zonos / Voicebox）必须打 high，卡片与详情都要显示。 */
const hardwareBlock = catalog.slice(catalog.indexOf("const HARDWARE"), catalog.indexOf("export function isHighDemand"));
ok((hardwareBlock.match(/demand:/g) ?? []).length >= 8, "8 张卡片都有硬件门槛标注（demand + hardware）");
ok(/zonos[\s\S]*?demand: "high"/.test(hardwareBlock)
  && /voicebox[\s\S]*?demand: "high"/.test(hardwareBlock),
  "Zonos / Voicebox 标为 high（8GB 显卡跑不动）");
ok(ui.includes("isHighDemand") && ui.includes("需高配") && ui.includes("硬件要求") && ui.includes("voice-ext-hint"),
  "卡片 meta 有「需高配」、详情有「硬件要求」、顶部有选型提示");
ok(css.includes(".voice-ext-demand") && css.includes(".voice-ext-hint"),
  "「需高配」徽标与提示行有样式");

/* 单引擎口径（11-16 用户：「只能启用一个」）：外部引擎接管时本机不能同时显示「使用中」。 */
ok(ui.includes("onActiveChange") && ui.includes("同一时间只生效一个") && ui.includes("已自动停用"),
  "外部引擎区块把「当前启用」上报父组件，并写明开启新引擎会自动停用旧的");
ok(enginesUi.includes("externalActive") && enginesUi.includes("onActiveChange={setExternalActive}")
  && enginesUi.includes("!ttsRemote && !externalActive")
  && enginesUi.includes("selected && ready && enabled && !externalActive"),
  "本机卡把 externalActive 纳入判定：接管时不显示「使用中」");
ok(enginesUi.includes("接管中") && enginesUi.includes("外部引擎优先") && css.includes(".is-takeover"),
  "基础模型卡显示「X 接管中」、本机引擎卡显示「外部引擎优先（兜底）」");
ok(enginesUi.includes("voiceExternalEnable(externalActive.id, false)"),
  "启用本机 / 切回本机 / 启用 MOSS 时都会停用外部引擎（全局面只留一个合成引擎）");

ok(['"gpt-sovits":', '"cosyvoice3":', 'chatterbox:', '"qwen3-tts":'].every((part) => main.includes(part)),
  "四个可接入引擎各有独立端口，且已移除引擎的端口配置一并清掉");
ok(main.includes("PY_ADAPTERS") && pythonIds.every((id) => main.includes(`"${id}"`))
  && !/"f5-tts"/.test(main) && !/indextts2/.test(main),
  "通用适配器集合只剩 Chatterbox / Qwen3（移除引擎的模板与端口不留死代码）");
ok(main.includes("--torch-backend=") && main.includes("torch==2.8.0"),
  "安装器用 uv --torch-backend 装 CUDA 版 torch（避免装成 CPU 版）");
ok(main.includes("hf-mirror.com") && main.includes("HF_ENDPOINT"),
  "HuggingFace 请求走镜像（国内不可直连），并且注入到服务进程");
ok(main.includes("modelscope.cn/api/v1/models/") && main.includes("resolve/master/"),
  "ModelScope 清单/文件下载走官方 API（含大小，可续传）");
ok(main.includes("ADAPTER_HTTP_HEAD") && main.includes("ADAPTER_HTTP_MAIN") && main.includes("String.raw"),
  "Python 适配器模板共用 HTTP 壳（String.raw 保证 Python 正则不被 TS 转义）");
ok(main.includes("ChatterboxMultilingualTTS.from_local") && main.includes("language_id=lang") && /torch==2\.6\.0/.test(catalog),
  "Chatterbox 适配器走本地多语（中文 language_id=zh）+ torch 2.6（PyPI 包锁版本）");
ok(main.includes("Qwen3TTSModel.from_pretrained") && main.includes("generate_voice_clone") && main.includes("attn_implementation='sdpa'"),
  "Qwen3 适配器用 Base 克隆 + SDPA（不强依赖 flash-attn）");
ok((main.match(/ADAPTER_HTTP_HEAD \+ String\.raw/g) ?? []).length === 2 && /HTTPServer\(\('127\.0\.0\.1'/.test(main)
  && !/F5_ADAPTER|INDEXTTS_ADAPTER/.test(main),
  "两个 Python 适配器都复用只绑 127.0.0.1 的 HTTP 壳（移除引擎的模板已删）");
ok(main.includes("SERVICE_TIMEOUT") && main.includes("chatterbox: 600_000") && !/indextts2/.test(main),
  "大模型冷启动超时放宽到 10 分钟（首次加载 30–60 秒不会再被误判失败）");
/* 11-16 用户实测「启用了，关不掉」：启动中开关被禁用 ⇒ 加载慢时无法关闭。 */
ok(/disabled=\{toggling === configEngine\.id\}/.test(ui) && !/toggling === [a-z]+\.id \|\| [a-z]+\.service === "starting"/.test(ui)
  && ui.includes("模型加载中（可随时关闭）"),
  "启动中也能关闭引擎（不再因 service=starting 把开关禁用）");
ok(main.includes("服务进程已退出") && main.includes("if (service.state !== \"starting\") return;")
  && main.includes('if (String(service.state) === "stopped") return;'),
  "服务崩溃立刻失败（不再干等 10 分钟）；启动中关闭后不会被迟到的 ready 改回运行态");
ok(ui.includes("voice-ext-service-error") && css.includes(".voice-ext-service-error"),
  "启用后服务起不来时卡片显示原因（不再只有「已启用」）");

/* ── 11-17 用户实测两连：「模型一直加载中」「每个语音模型没有音色选择」 ── */
const builtin = read("electron/voice/builtin-voices.ts");
ok(/kind: "download" \| "downloadDone" \| "service"/.test(main) && /function emitService/.test(main)
  && /emitService\(id, service\)/.test(main) && /type === "service"/.test(ui)
  && /setInterval\(\(\) => refresh\(\), 2000\)/.test(ui),
  "服务状态 starting→running/error 主动推给界面 + 启动中 2s 轮询（不再永远停在「启动中」）");
ok(/ensureBuiltinVoices/.test(builtin) && /BUILTIN_REF_TEXT/.test(builtin)
  && /ensureBuiltinVoiceRefs/.test(service) && /synthesizeLocal/.test(service),
  "内置参考音色由本机模型说话人生成（ensureBuiltinVoices + synthesizeLocal，⛔ 生成不走外部引擎）");
ok(/@native/.test(main) && /NATIVE_VOICE_ENGINES/.test(main) && /ref_audio != '@native'/.test(main)
  && /nativeVoice: NATIVE_VOICE_ENGINES\.has/.test(main),
  "Chatterbox 用模型自带默认音色（conds.pt）走原生项，其余引擎走参考样本");
ok(/voice:external-voices/.test(manifest) && /voice:external-voices/.test(registry)
  && /voiceExternalVoices/.test(preload) && /voiceExternalVoices/.test(dts) && /voice:external-voices/.test(index),
  "引擎音色表通道四处贯通（manifest/registry/preload/vite-env + 卸载清单）");
ok(/engineVoice/.test(service) && /resolveReference/.test(main) && /builtin:/.test(main) && /profile:/.test(main),
  "外部引擎按引擎卡选的音色解析（native / builtin / profile，空值回落 profileId）");
ok(/voiceOptionsFor/.test(ui) && /chooseVoice/.test(ui) && /内置音色 ·/.test(ui) && /默认音色（引擎自带）/.test(ui)
  && /voice-ext-voice-loading/.test(css)
  && /<VoiceExternalEnginesSection[^>]*settings=\{settings\}[^>]*apply=\{apply\}/.test(enginesUi),
  "引擎音色下拉（原生默认音色 / 内置参考样本 / 我的音色）写回 tts.engineVoice");
/* 11-17 用户令：「音色选择就放到每个语音模型卡片里面，语音模型卡片做二级弹窗预览里面设置」 */
ok(/SettingsDialog/.test(ui) && /voice-ext-config-open/.test(ui) && /configEngine &&/.test(ui)
  && /setConfigId\(engine\.id\)/.test(ui) && /voice-ext-config/.test(css),
  "每张引擎卡 → 二级弹窗里配置（启用 / 安装 / 目录 / 卸载 / 音色 / 许可详情）");
/* 11-17 用户实测「弹窗掉到设置弹窗下面了」：同为 900 档会被外层盖住 ⇒ 引擎配置弹窗显式抬到 950。 */
ok(/size="md-auto"\s*\n\s*elevated/.test(ui) && /is-elevated/.test(read("src/styles/34-devtools-cards.css"))
  && /elevated\?: boolean/.test(read("src/components/SettingsDialog.tsx")),
  "二级弹窗内部的引擎配置弹窗抬到 950 档（is-elevated），不再被外层设置弹窗盖住");

/* 11-17 用户令：弹窗里写清「怎么用」；卡片布局统一（等高、文字限行、底部一行对齐）。 */
ok(/const USAGE = \{/.test(catalog) && /usage: USAGE\[entry\.id\]/.test(catalog)
  && /voice-ext-usage/.test(ui) && /怎么用/.test(ui) && /voice-ext-steps/.test(css),
  "每个引擎都有「怎么用」步骤（目录单一真相源）并写进配置弹窗");
ok(/voice-ext-foot/.test(ui) && /voice-ext-status/.test(ui) && /\.voice-ext-card \{\s*height: 100%/.test(css)
  && /-webkit-line-clamp: 2/.test(css) && /\.voice-ext-foot\s*\{[^}]*margin-top: auto/.test(css),
  "引擎卡等高 + 简介/许可限两行 + 底部「状态左 / 配置右」一行对齐");

ok(String(pkg.scripts?.check ?? "").includes("12bv-voice-external"), "守卫 12bv 已加入 package.json 的 check 链");

console.log(`\n【ext】${fails === 0 ? "通过" : "失败"}（${checks} 条${fails ? `，${fails} 条未通过` : ""}）`);
if (fails) process.exitCode = 1;
