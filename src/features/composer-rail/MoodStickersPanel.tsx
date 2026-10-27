/**
 * 心情表情弹层（10-27）。
 *
 * 用户：「表情包图标，这里的表情包可以发给Codex的，你内置一套心情表情包对应代码，
 * 发出去Codex要知道啥意思，选择表情先到输入框，可以跟输入框内容一起发出」。
 *
 * 做法（用户选定「带括号释义」）：点一下把 `😤（不满：结果不对）` 追加进输入框 ——
 * 表情给人看、括号里的中文释义给模型看，**不用改引擎提示词**；用户发出前可以删掉括号。
 * 释义写得像一句人话（「我不满意」「这个方向对」），比「emoji: angry」更容易被模型正确理解。
 */

type Sticker = { emoji: string; label: string; gloss: string; group: "正向" | "负向" | "中性" };

/** 内置一套：正向 / 负向 / 中性三组，覆盖日常开发里最常想表达的那几种情绪。 */
const STICKERS: Sticker[] = [
  /* 10-27 用户：「现在表情太少了，丰富一下」⇒ 14 → 48，仍按 正向 / 负向 / 中性 三组，
     每组里按「最常用 → 少见」排，常用的一眼就能点到。 */
  { emoji: "👍", label: "认可", gloss: "认可，这个做法对", group: "正向" },
  { emoji: "🎉", label: "搞定", gloss: "成了，可以收工", group: "正向" },
  { emoji: "🚀", label: "继续冲", gloss: "这个方向对，继续往下做", group: "正向" },
  { emoji: "🙏", label: "拜托", gloss: "拜托了，这次务必稳一点", group: "正向" },
  { emoji: "💡", label: "有想法", gloss: "我有个新想法，先听完再动手", group: "正向" },
  { emoji: "👏", label: "漂亮", gloss: "干得漂亮", group: "正向" },
  { emoji: "🔥", label: "给力", gloss: "这个很给力，就按它来", group: "正向" },
  { emoji: "✅", label: "通过", gloss: "验收通过", group: "正向" },
  { emoji: "👌", label: "没问题", gloss: "没问题，可以交", group: "正向" },
  { emoji: "💪", label: "加油", gloss: "继续加油，别停", group: "正向" },
  { emoji: "🥳", label: "庆祝", gloss: "终于成了，庆祝一下", group: "正向" },
  { emoji: "🤩", label: "惊艳", gloss: "效果超出预期", group: "正向" },
  { emoji: "😎", label: "稳", gloss: "这波很稳", group: "正向" },
  { emoji: "🫡", label: "收到", gloss: "收到，就按这个执行", group: "正向" },
  { emoji: "⭐", label: "加分", gloss: "这一手加分", group: "正向" },
  { emoji: "🧠", label: "聪明", gloss: "这个思路聪明", group: "正向" },
  { emoji: "😤", label: "不满", gloss: "我不满意，这次结果不对", group: "负向" },
  { emoji: "🤔", label: "存疑", gloss: "我怀疑这里有问题，先说明理由", group: "负向" },
  { emoji: "😑", label: "又来了", gloss: "同一个问题又出现，别再犯", group: "负向" },
  { emoji: "🫠", label: "崩了", gloss: "出事了，先停手说清楚发生了什么", group: "负向" },
  { emoji: "⏳", label: "等太久", gloss: "太慢了，先给我一个阶段结果", group: "负向" },
  { emoji: "😡", label: "生气", gloss: "我非常不满意，先别继续做", group: "负向" },
  { emoji: "🤦", label: "无语", gloss: "这个错误不该犯", group: "负向" },
  { emoji: "🙃", label: "反讽", gloss: "这算做完了？再看一遍", group: "负向" },
  { emoji: "😮‍💨", label: "心累", gloss: "绕太久了，回到正题", group: "负向" },
  { emoji: "🥲", label: "勉强", gloss: "勉强能看，但有明显问题", group: "负向" },
  { emoji: "🚩", label: "有问题", gloss: "这里埋了坑，先说风险", group: "负向" },
  { emoji: "🔁", label: "重做", gloss: "方向错了，重做一遍", group: "负向" },
  { emoji: "🧱", label: "卡住", gloss: "卡住了，帮我解这个点", group: "负向" },
  { emoji: "❗", label: "重点", gloss: "这条是重点，别漏", group: "负向" },
  { emoji: "👀", label: "看到了", gloss: "看到了，先不表态，继续说", group: "中性" },
  { emoji: "🤝", label: "成交", gloss: "就按这个来，开工", group: "中性" },
  { emoji: "🧪", label: "先验证", gloss: "先做个最小验证，别急着全量改", group: "中性" },
  { emoji: "📌", label: "记下来", gloss: "这条记下来，后面还要用", group: "中性" },
  { emoji: "🤷", label: "你定", gloss: "你来决定，我不纠结", group: "中性" },
  { emoji: "🕐", label: "稍等", gloss: "我这边稍等一下", group: "中性" },
  { emoji: "📝", label: "记一下", gloss: "先写下来，回头一起改", group: "中性" },
  { emoji: "🔍", label: "再看看", gloss: "再查一下，别急着下结论", group: "中性" },
  { emoji: "🎯", label: "就这个", gloss: "就按这个目标做", group: "中性" },
  { emoji: "🔧", label: "修一下", gloss: "先修这个，其它往后放", group: "中性" },
  { emoji: "📦", label: "打包", gloss: "做完出个可运行的版本", group: "中性" },
  { emoji: "☕", label: "歇会", gloss: "先停一下，我看看", group: "中性" },
  { emoji: "🤖", label: "交给你", gloss: "这个交给你处理", group: "中性" },
  { emoji: "🫵", label: "你来", gloss: "这一步你来定方案", group: "中性" },
  { emoji: "👋", label: "再见", gloss: "先到这，回头继续", group: "中性" },
  { emoji: "📊", label: "看数据", gloss: "先给我看数据再说", group: "中性" },
  { emoji: "🔗", label: "看链接", gloss: "参考这个链接里的做法", group: "中性" },
  { emoji: "🗂️", label: "归档", gloss: "这条先归档，不做了", group: "中性" },
];

export function MoodStickersPanel({ onInsert, onDone }: { onInsert: (text: string) => void; onDone?: () => void }) {
  const groups: Sticker["group"][] = ["正向", "负向", "中性"];

  /* 10-27 用户改口：「选择到输入框不要带文字，一个表情就行了」⇒ 只插 emoji。
     含义靠**悬停提示 + 引擎侧图例**（AGENTS.md 里那张表）传达，不往输入框里塞括号。 */
  const pick = (sticker: Sticker) => {
    onInsert(sticker.emoji);
    /* 10-27 用户：「选择了表情，表情界面自动隐藏，不要还一直显示」⇒ 选完直接收起弹层 */
    onDone?.();
  };

  return (
    <div className="stickers">
      <p className="stickers-hint">点一下插到输入框（只插表情），可以接着打字一起发；悬停看含义。</p>
      {groups.map((group) => (
        <section key={group} className="stickers-group">
          <h4>{group}</h4>
          <div className="stickers-grid">
            {STICKERS.filter((sticker) => sticker.group === group).map((sticker) => (
              <button
                key={sticker.emoji}
                type="button"
                className="sticker"
                title={`${sticker.label} —— ${sticker.gloss}`}
                aria-label={`${sticker.label}：${sticker.gloss}`}
                onClick={() => pick(sticker)}
              >
                <span className="sticker-emoji">{sticker.emoji}</span>
                <span className="sticker-label">{sticker.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="stickers-foot">含义已写进引擎指令，Codex 认得出这些表情。</p>
    </div>
  );
}
