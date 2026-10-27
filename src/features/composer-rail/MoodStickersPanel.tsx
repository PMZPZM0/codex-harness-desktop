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
import { useState } from "react";
import { Check } from "lucide-react";

type Sticker = { emoji: string; label: string; gloss: string; group: "正向" | "负向" | "中性" };

/** 内置一套：正向 / 负向 / 中性三组，覆盖日常开发里最常想表达的那几种情绪。 */
const STICKERS: Sticker[] = [
  { emoji: "👍", label: "认可", gloss: "认可，这个做法对", group: "正向" },
  { emoji: "🎉", label: "搞定", gloss: "成了，可以收工", group: "正向" },
  { emoji: "🚀", label: "继续冲", gloss: "这个方向对，继续往下做", group: "正向" },
  { emoji: "🙏", label: "拜托", gloss: "拜托了，这次务必稳一点", group: "正向" },
  { emoji: "💡", label: "有想法", gloss: "我有个新想法，先听完再动手", group: "正向" },
  { emoji: "😤", label: "不满", gloss: "我不满意，这次结果不对", group: "负向" },
  { emoji: "🤔", label: "存疑", gloss: "我怀疑这里有问题，先说明理由", group: "负向" },
  { emoji: "😑", label: "又来了", gloss: "同一个问题又出现，别再犯", group: "负向" },
  { emoji: "🫠", label: "崩了", gloss: "出事了，先停手说清楚发生了什么", group: "负向" },
  { emoji: "⏳", label: "等太久", gloss: "太慢了，先给我一个阶段结果", group: "负向" },
  { emoji: "👀", label: "看到了", gloss: "看到了，先不表态，继续说", group: "中性" },
  { emoji: "🤝", label: "成交", gloss: "就按这个来，开工", group: "中性" },
  { emoji: "🧪", label: "先验证", gloss: "先做个最小验证，别急着全量改", group: "中性" },
  { emoji: "📌", label: "记下来", gloss: "这条记下来，后面还要用", group: "中性" },
];

export function MoodStickersPanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const groups: Sticker["group"][] = ["正向", "负向", "中性"];

  const pick = (sticker: Sticker) => {
    const text = `${sticker.emoji}（${sticker.gloss}）`;
    onInsert(text);
    setJustAdded(sticker.emoji);
    window.setTimeout(() => setJustAdded((current) => (current === sticker.emoji ? null : current)), 900);
  };

  return (
    <div className="stickers">
      <p className="stickers-hint">点一下加到输入框（表情 + 括号释义），可以接着打字一起发出去；括号里的字是给 Codex 看的。</p>
      {groups.map((group) => (
        <section key={group} className="stickers-group">
          <h4>{group}</h4>
          <div className="stickers-grid">
            {STICKERS.filter((sticker) => sticker.group === group).map((sticker) => (
              <button
                key={sticker.emoji}
                type="button"
                className={`sticker${justAdded === sticker.emoji ? " is-added" : ""}`}
                title={`${sticker.label} —— ${sticker.gloss}`}
                aria-label={`${sticker.label}：${sticker.gloss}`}
                onClick={() => pick(sticker)}
              >
                <span className="sticker-emoji">{sticker.emoji}</span>
                <span className="sticker-label">{sticker.label}</span>
                {justAdded === sticker.emoji ? <span className="sticker-ok"><Check size={11} /></span> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="stickers-foot">发出后 Codex 读到的是「表情 + 中文释义」，不需要额外配置。</p>
    </div>
  );
}
