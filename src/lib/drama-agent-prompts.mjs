/**
 * 「交给 Agent」的提示词构造（纯函数）。
 *
 * 为什么放基座而不是域里：这段文本决定引擎会不会去读正确的文件、写对正确的路径，
 * 属于**可回归的契约**，必须能被守卫直接 import 跑真值表
 * （断言"提示词里含分镜表路径 / 含镜头号 / 含产物落点约定"）。
 *
 * ⛔ 这里不替用户发消息：只把文本交给宿主填进输入框，发不发由用户决定。
 */

function pick(payload, keys, fallback = "") {
  for (const key of keys) {
    const value = payload && payload[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return fallback;
}

const STORYBOARD_SHAPE = [
  '{\n  "title": "片名", "aspect": "9:16", "fps": 24, "style": "全片统一画风",\n',
  '  "characters": [{ "id": "A", "name": "角色名", "look": "写死的外貌描写", "ref": "定妆照文件名", "voice": "音色名" }],\n',
  '  "scenes": [{ "id": "S1", "place": "地点", "time": "时间/光线",\n',
  '    "shots": [{ "id": "S1-01", "cast": ["A"], "shot_size": "中景", "prompt": "首帧画面提示词", "motion": "动作与运镜", "line": "台词", "speaker": "A", "duration": 4 }] }]\n}',
].join("");

/**
 * 按节点类型生成给 Agent 的任务描述。认不出的类型返回空串（调用方据此不显示按钮）。
 *
 * @param {{ kind: string, payload: Record<string, any>, storyboardPath?: string, boardName?: string }} ctx
 * @returns {string}
 */
export function dramaAgentPrompt(ctx) {
  const kind = String((ctx && ctx.kind) || "");
  const payload = (ctx && ctx.payload) || {};
  const boardPath = String((ctx && ctx.storyboardPath) || ".drama-canvas/storyboards/main.json");
  const boardName = String((ctx && ctx.boardName) || "main");

  if (kind === "script") {
    const style = pick(payload, ["style"]);
    const aspect = pick(payload, ["aspect"], "9:16");
    const text = pick(payload, ["text"], "（剧本卡上还没写内容）");
    return [
      "把这个短剧剧本拆成分镜表，写进工作区文件，不要只回消息。",
      "",
      `目标文件：${boardPath}（JSON，UTF-8，若目录不存在请先建）`,
      `画幅：${aspect}${style ? `；统一风格：${style}` : ""}`,
      "",
      "结构必须是：",
      STORYBOARD_SHAPE,
      "",
      "要求：",
      "1. 每个角色给一个短 id（A/B/C），`look` 写死一段外貌描写，后面所有镜头照抄不改；",
      "2. 每镜的 `prompt` 只写景别、场景、姿态、光线，角色用「参考图里的某人」这类指代，别重复描述五官；",
      "3. `motion` 只写动作与运镜；台词进 `line`，并在 `speaker` 里填说话人的角色 id；",
      "4. 单镜 3–6 秒，按短视频节奏，总时长控制在能一口气看完的长度；",
      "5. 写完用一句话告诉我：片名、场次数、镜头数、预估总时长。",
      "",
      "剧本：",
      text,
    ].join("\n");
  }

  if (kind === "shot") {
    const shotId = pick(payload, ["id"], "（未编号镜头）");
    const prompt = pick(payload, ["prompt"], "（还没写首帧提示词）");
    const motion = pick(payload, ["motion"]);
    const line = pick(payload, ["line"]);
    return [
      `处理分镜表 ${boardPath} 里的镜头 ${shotId}。`,
      "",
      `首帧提示词：${prompt}`,
      motion ? `动作与运镜：${motion}` : "",
      line ? `台词：${line}` : "",
      "",
      "步骤：",
      "1. 用 generate_image 按上面的提示词生成首帧；",
      `2. 把产物路径写回 ${boardPath} 里镜头 ${shotId} 的 first_frame 字段（工作区相对路径）；`,
      "3. 若能拿到配音，把时长写进 duration，并告诉我这一镜的实际时长。",
      "",
      "⛔ 只动这一镜，别改别的镜头。",
    ].filter((line) => line !== "").join("\n");
  }

  if (kind === "timeline") {
    return [
      "按分镜顺序把这部短剧合成成片。",
      "",
      `分镜表：${boardPath}（${boardName}）`,
      "",
      "步骤：",
      "1. 读分镜表，按 scenes → shots 的顺序逐镜取 video（没有视频的镜头跳过并列出）；",
      "2. 用 ffmpeg 逐镜合轨（视频 + 对应 audio）、拼接、统一画幅与帧率；",
      "3. 成片写到工作区，路径写回分镜表的 output.video；",
      "4. 告诉我成片路径、总时长，以及哪几镜缺失被跳过。",
      "",
      "⛔ 不要静默丢镜头：跳过哪一镜必须列出来。",
    ].join("\n");
  }

  if (kind === "agent") {
    return pick(payload, ["task"], "（这张 Agent 任务卡还没写任务描述）");
  }

  if (kind === "character" || kind === "location") {
    const name = pick(payload, ["name"], "（未命名）");
    const look = pick(payload, ["look", "description"]);
    const what = kind === "character" ? "定妆照" : "场景图";
    return [
      `为「${name}」生成${what}，并把路径写回分镜表 ${boardPath}。`,
      "",
      look ? `设定：${look}` : "（卡片上还没写设定，先问我一句再生成）",
      "",
      kind === "character"
        ? "生成后用 generate_image 的产物路径填进 characters 里这个角色的 ref 字段 —— 后面每一镜都要拿它当参考图。"
        : "生成后把路径填进对应的场景记录里。",
    ].join("\n");
  }

  return "";
}

/** 分镜表在工作区里的相对路径（提示词里给引擎看的样子）。
 * @param {string} name
 * @returns {string} */
export function dramaBoardRelativePath(name) {
  const safe = String(name || "main").replace(/[\\/:*?"<>|]/g, "_").replace(/\.json$/i, "") || "main";
  return `.drama-canvas/storyboards/${safe}.json`;
}
