/**
 * 12bv-voice-external —— 开源语音模型卡片（11-16 用户令）
 *
 * 用户口径：把 Voicebox / OmniVoice Studio / GPT-SoVITS / CosyVoice 3 / Qwen3-TTS /
 * IndexTTS2 / Chatterbox / F5-TTS / Fish Speech / TTS-WebUI / Zonos 做成语音模型界面的卡片，
 * 按需下载；**默认展示 4 张**，更多展开/收起；启用与播报联动（同时只启用一个）。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 * ⛔ 非商用权重（F5 / Fish / IndexTTS-2.0）必须在卡片上有徽标；不随包。
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
const modal = read("src/components/VoiceSettingsSection/02-tts-engines.tsx");
const css = read("src/styles/18-openai-dialog.css");
const manifest = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const preload = read("electron/preload.ts");
const dts = read("src/vite-env.d.ts");
const pkg = JSON.parse(read("package.json"));

const IDS = ["gpt-sovits", "cosyvoice3", "indextts2", "f5-tts", "qwen3-tts", "chatterbox", "fish-speech", "zonos", "voicebox", "voice-studio", "tts-webui"];
const missingIds = IDS.filter((id) => !catalog.includes(`id: "${id}"`));
ok(missingIds.length === 0, `11 个开源项目全部在目录里（缺：${missingIds.join("、") || "无"}）`);

const defaults = catalog.match(/VOICE_EXTERNAL_DEFAULT_IDS = \[([^\]]+)\]/)?.[1] ?? "";
ok((defaults.match(/"/g) ?? []).length === 8, "默认展示 4 张推荐卡片（用户令）；其余走「更多展开」");

ok(["clone", "dialect", "design", "dub", "dialog", "longform", "podcast", "studio", "lab"].every((id) => catalog.includes(`id: "${id}"`)),
  "分类 chips 覆盖中文克隆 / 方言 / 声音设计 / 配音 / 对话 / 长文本 / 播客 / 工作台 / 实验");

ok(/id: "f5-tts"[\s\S]*?commercial: "no"/.test(catalog)
  && /id: "fish-speech"[\s\S]*?commercial: "no"/.test(catalog)
  && /id: "indextts2"[\s\S]*?commercial: "conditional"/.test(catalog)
  && /id: "voice-studio"[\s\S]*?commercial: "agpl"/.test(catalog),
  "非商用权重（F5 / Fish / IndexTTS-2.0）与 AGPL（VoiceStudio）有明确许可标记");

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

/* 第二批（11-16）：通用 Python 安装器 + 四个引擎真接入（Fish / Zonos 保持信息卡） */
const pythonIds = ["f5-tts", "chatterbox", "qwen3-tts", "indextts2"];
ok(pythonIds.every((id) => new RegExp(`id: "${id}"[\\s\\S]*?kind: "python"[\\s\\S]*?adapter: "${id}"`).test(catalog)),
  "F5 / Chatterbox / Qwen3 / IndexTTS2 都有 Python 安装描述（kind=python + adapter）");
ok(/INDEXTTS_COMMIT = "[0-9a-f]{40}"/.test(catalog) && /modelscope", repo: "IndexTeam\/IndexTTS-2"/.test(catalog),
  "IndexTTS2 源码钉死提交 + ModelScope 权重清单");
ok(catalog.includes('repo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base"'), "Qwen3 用 0.6B-Base（含 speech_tokenizer）");
ok(/t3_mtl23ls_v2\.safetensors/.test(catalog) && /s3gen\.pt/.test(catalog) && /Cangjie5_TC\.json/.test(catalog),
  "Chatterbox 多语模型文件齐全（ve / t3 v2 / s3gen / grapheme / conds / Cangjie5）");
ok(/F5TTS_v1_Base\/model_1250000\.safetensors/.test(catalog) && /vocos-mel-24khz/.test(catalog),
  "F5 预下载主模型 + Vocos 声码器（不依赖运行时联网）");
ok(/id: "zonos"[\s\S]*?install: null/.test(catalog) && /官方只支持 Linux\/macOS/.test(catalog),
  "Zonos 官方不支持 Windows：保留信息卡，不假装可装");
ok(/id: "fish-speech"[\s\S]*?install: null/.test(catalog) && /4B，8GB 显卡容易 OOM/.test(catalog),
  "Fish Speech 4B 需更大显存：保留信息卡并写明原因");
ok(!catalog.includes("首批暂未接入"), "已接入的卡片不再出现「首批暂未接入」字样");

ok(['"gpt-sovits":', '"cosyvoice3":', '"f5-tts":', 'chatterbox:', '"qwen3-tts":', 'indextts2: 19885'].every((part) => main.includes(part)),
  "六个引擎各有独立端口（19880–19885）");
ok(main.includes("PY_ADAPTERS") && pythonIds.every((id) => main.includes(`"${id}"`)),
  "通用适配器集合覆盖四个新引擎");
ok(main.includes("--torch-backend=") && main.includes("torch==2.8.0"),
  "安装器用 uv --torch-backend 装 CUDA 版 torch（避免装成 CPU 版）");
ok(main.includes("hf-mirror.com") && main.includes("HF_ENDPOINT"),
  "HuggingFace 请求走镜像（国内不可直连），并且注入到服务进程");
ok(main.includes("modelscope.cn/api/v1/models/") && main.includes("resolve/master/"),
  "ModelScope 清单/文件下载走官方 API（含大小，可续传）");
ok(main.includes("ADAPTER_HTTP_HEAD") && main.includes("ADAPTER_HTTP_MAIN") && main.includes("String.raw"),
  "四个适配器模板共用 HTTP 壳（String.raw 保证 Python 正则不被 TS 转义）");
ok(main.includes('from f5_tts.api import F5TTS') && main.includes("vocoder_local_path"),
  "F5 适配器加载本地 ckpt / vocab / Vocos");
ok(main.includes("ChatterboxMultilingualTTS.from_local") && main.includes("language_id=lang") && /torch==2\.6\.0/.test(catalog),
  "Chatterbox 适配器走本地多语（中文 language_id=zh）+ torch 2.6（PyPI 包锁版本）");
ok(main.includes("Qwen3TTSModel.from_pretrained") && main.includes("generate_voice_clone") && main.includes("attn_implementation='sdpa'"),
  "Qwen3 适配器用 Base 克隆 + SDPA（不强依赖 flash-attn）");
ok(main.includes("from indextts.infer_v2 import IndexTTS2") && main.includes("use_deepspeed=False"),
  "IndexTTS2 适配器跳过 DeepSpeed（Windows 装不上）");
ok((main.match(/ADAPTER_HTTP_HEAD \+ String\.raw/g) ?? []).length === 4 && /HTTPServer\(\('127\.0\.0\.1'/.test(main),
  "四个适配器都复用只绑 127.0.0.1 的 HTTP 壳");
ok(main.includes("SERVICE_TIMEOUT") && main.includes("chatterbox: 600_000") && main.includes("indextts2: 600_000"),
  "大模型冷启动超时放宽到 10 分钟（首次加载 30–60 秒不会再被误判失败）");
ok(ui.includes("voice-ext-service-error") && css.includes(".voice-ext-service-error"),
  "启用后服务起不来时卡片显示原因（不再只有「已启用」）");

ok(String(pkg.scripts?.check ?? "").includes("12bv-voice-external"), "守卫 12bv 已加入 package.json 的 check 链");

console.log(`\n【ext】${fails === 0 ? "通过" : "失败"}（${checks} 条${fails ? `，${fails} 条未通过` : ""}）`);
if (fails) process.exitCode = 1;
