export type WakeMatcherOptions = { phrase?: string; homophones?: Map<string, Set<string>> | null };

export type WakeMatcher = {
  readonly phrase: string;
  readonly chars: string[];
  readonly homophoneGroups: number;
  readonly ready: boolean;
  match(text: unknown): boolean;
};

/**
 * 语音唤醒词匹配（纯逻辑，`scripts/check-preflight.mjs` 直接 import 跑断言）。
 *
 * ## 为什么不能是 `text.includes(phrase)`（09-13 取证结论）
 *
 * 唤醒复用的是**通用流式识别模型**，不是关键词模型（KWS）。实测（`.tmp/wake-vocab-probe.mjs`，
 * 用本机已装模型跑「合成唤醒词 → 唤醒配置识别」）：
 *
 * | 说 | 识别成 | 精确匹配 |
 * |---|---|---|
 * | 小柯小柯 | 小柯小柯 / 小哥小哥 | 1/2 |
 * | 小科小科 | 小柯小柯 | 0/2 |
 * | 小可小可 | 消客小客 / 教科小壳 | 0/2 |
 *
 * 原因有两层：
 * ① **「柯」不在识别模型词表里**（`tokens.txt` 只有 2002 项，有 科/可/客/刻/课，没有 柯）
 *    —— 该模型是字节级 BPE，罕见字只能靠 `<0xNN>` 字节拼出来，代价大 → 模型更愿意吐**同音常用字**；
 * ② 通用模型的输出本来就不稳定（同一段音频两次结果可以不同）。
 *
 * 所以匹配必须是**同音容错**的：唤醒词「小柯小柯」要能被 小科小科 / 小可小可 命中。
 * 同音表不引入任何新依赖 —— 直接用随识别模型一起下载的 **VITS 音色模型自带 `lexicon.txt`**
 * （`柯 ㄎ ㄜ ˉ` / `科 ㄎ ㄜ ˉ` 读音完全相同，去声调后归为一类）。
 *
 * ⚠️ 但同音容错治不了**声母听错**（实测「小柯小柯」被听成「小哥小哥」，哥=ㄍㄜ，与 柯=ㄎㄜ
 * 不同声母）。这种情况**故意不匹配** —— 把 哥 也算同音的话，「小哥」这种日常词会天天误唤醒。
 * 正确的应对是让用户看见「最近听到什么」（诊断），换一个模型能稳定识别、又不与日常词撞车的唤醒词。
 */

/** 归一化：去掉空白与常见中英标点（识别结果常带空格/句号，用户输入也可能带） */
export function normalizeWakeText(text: unknown): string {
  return String(text ?? "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。！？、,.!?~～：:；;“”"'‘’（）()【】\[\]｛｝{}<>《》…—－\-_/\\|+*#@$%^&=`]/g, "");
}

/** 读音键：去掉声调符号、数字声调、空白与分隔符（兼容注音 `ㄎ ㄜ ˉ` 与拼音 `ke1` 两种 lexicon 写法） */
function readingKey(reading: unknown): string {
  return String(reading ?? "")
    .replace(/[\u02C9\u02CA\u02C7\u02CB\u02D9]/g, "") // 注音声调 ˉ ˊ ˇ ˋ ˙
    .replace(/[0-9]/g, "") // 拼音数字声调
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
}

/**
 * 从 VITS `lexicon.txt` 文本构建同音等价表。
 * 只认**单字**条目（多字词条目的读音是拼接的，拿来当同音类会把词也卷进来）。
 * 返回 `Map<字, Set<同音字>>`（不含自身）。
 */
export function buildHomophoneMap(lexiconText: unknown): Map<string, Set<string>> {
  const byReading = new Map();
  for (const line of String(lexiconText ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const spaceAt = trimmed.search(/\s/);
    if (spaceAt <= 0) continue;
    const word = trimmed.slice(0, spaceAt);
    // 单字：长度 1 或一个代理对（生僻字可能是扩展区，占两个 UTF-16 单元）
    const chars = [...word];
    if (chars.length !== 1) continue;
    const key = readingKey(trimmed.slice(spaceAt));
    if (!key) continue;
    if (!byReading.has(key)) byReading.set(key, new Set());
    byReading.get(key).add(chars[0]);
  }
  const map = new Map();
  for (const group of byReading.values()) {
    if (group.size < 2) continue;
    for (const ch of group) {
      if (!map.has(ch)) map.set(ch, new Set());
      for (const other of group) if (other !== ch) map.get(ch).add(other);
    }
  }
  return map;
}

/**
 * 唤醒词匹配器。
 * @param {{ phrase?: string, homophones?: Map<string, Set<string>> | null }} options
 */
export function createWakeMatcher(options: WakeMatcherOptions = {}): WakeMatcher {
  const phrase = normalizeWakeText(options.phrase);
  const target = [...phrase];
  const homophones = options.homophones instanceof Map ? options.homophones : null;

  const same = (a: string, b: string): boolean => {
    if (a === b) return true;
    return Boolean(homophones?.get(a)?.has(b));
  };

  /** 同音等价类数量（诊断用：0 说明 lexicon 没读到，只有精确匹配） */
  let groups = 0;
  if (homophones) {
    const seen = new Set<string>();
    for (const [, set] of homophones) {
      const key = [...set].sort().join("");
      if (key && !seen.has(key)) {
        seen.add(key);
        groups += 1;
      }
    }
  }

  return {
    phrase,
    chars: target,
    homophoneGroups: groups,
    /** 唤醒词为空 = 永不命中（不能让空唤醒词把每一句都当唤醒） */
    ready: target.length > 0,
    /**
     * 识别文本里是否**出现了唤醒词**（同音容错 + 滑窗，允许前后有别的字）。
     * 只看连续的 `phrase.length` 个字符，不做「部分命中」——少一个字也放行的话，
     * 日常说话会大量误唤醒。
     */
    match(text) {
      if (!target.length) return false;
      const heard = [...normalizeWakeText(text)];
      if (heard.length < target.length) return false;
      for (let i = 0; i + target.length <= heard.length; i++) {
        let ok = true;
        for (let j = 0; j < target.length; j++) {
          if (!same(heard[i + j], target[j])) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
      return false;
    },
  };
}

/**
 * 唤醒词可达性提示（诊断）：哪些字**不在识别模型词表**里。
 * 不在词表的字只能靠字节级回退拼出来，识别结果经常写成同音常用字 ——
 * 这正是默认唤醒词「小柯小柯」时好时坏的原因，必须让用户看得见。
 */
export function phraseVocabHint(phrase: unknown, tokensText: unknown): string {
  const chars = [...normalizeWakeText(phrase)];
  if (!chars.length) return "";
  const vocab = new Set(
    String(tokensText ?? "")
      .split("\n")
      .map((line) => line.split(" ")[0])
      .filter(Boolean)
  );
  if (!vocab.size) return "";
  const missing = chars.filter((ch) => !vocab.has(ch));
  if (!missing.length) return "";
  return `「${[...new Set(missing)].join("")}」不在识别模型词表里，识别结果常写成同音字（已按同音匹配兜住；想更稳可以换个常见字的唤醒词）`;
}
