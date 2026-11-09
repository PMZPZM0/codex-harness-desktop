/**
 * 群设置 · 卡片里的「真实内容示意」（11-09 用户令，附截图：
 *   「这些卡片里面能不能显示真实的会话内容，现在这种，看不出来啊，区分不出来」）。
 *
 * ⛔ 上一版是几条灰圆角条（`.team-settings__layout-demo i`）—— 四个选项长得一模一样，
 *   只能靠下面的小字猜，等于没示意。这里改用**真头像 + 真句子 + 真气泡形状**，
 *   一眼能看出「谁在左谁在右」「过程收没收起来」「回复是平铺还是收进气泡」。
 *
 * ⛔ 只做示意：不接任何 state / IPC / 真实消息（设置页是静态预览，点卡片才改配置）。
 * ⛔ 文案固定（不随机、不取真实群数据）—— 卡片高度必须稳定，否则点一下卡片会跳。
 */
import { ChevronRight, MessagesSquare } from "lucide-react";

type Side = "left" | "right";

/** 一条迷你消息：头像 + 名字 + 气泡（形状/配色与群消息一致，尺寸缩小）。
 *  ⛔ 自己那条**不画头像**：迷你尺寸里「头像一个字 + 名字一个字」会变成「我 我」，
 *     看着像重复渲染（用户截图实测）。伙伴那条保留头像（与群里一致：头像 + 名字）。 */
function Bubble({ side, who, text }: { side: Side; who: string; text: string }) {
  return (
    <span className={`tsd-row is-${side}`}>
      {side === "left" && <span className="tsd-face" aria-hidden>{who.slice(0, 1)}</span>}
      <span className="tsd-body">
        <b className="tsd-who">{who}</b>
        <span className="tsd-bubble">{text}</span>
      </span>
    </span>
  );
}

/** 过程折叠条（真实形态：一行标题 + 箭头，点开才展开步骤）。 */
function Fold({ text }: { text: string }) {
  return (
    <span className="tsd-fold">
      <ChevronRight size={10} />
      <span>{text}</span>
    </span>
  );
}

/** 消息排版：split = 我靠右、伙伴靠左；left = 同一列。 */
export function LayoutPreview({ mode }: { mode: "split" | "left" }) {
  return (
    <span className="tsd-stage" aria-hidden>
      <Bubble side={mode === "split" ? "right" : "left"} who="我" text="@观澜 看看今天的头条" />
      <Bubble side="left" who="观澜" text="收到，我整理前 10 条" />
    </span>
  );
}

/** 回复模式：process = 运行中能看见过程；placeholder = 只挂「头像+名字+处理中」。 */
export function ReplyPreview({ mode }: { mode: "process" | "placeholder" }) {
  return (
    <span className="tsd-stage" aria-hidden>
      <Bubble side="right" who="我" text="@观澜 看看今天的头条" />
      {mode === "process" ? <Fold text="过程 · 5 步" /> : (
        <span className="tsd-pending">
          <span className="tsd-face">观</span>
          <span>观澜 · 处理中…</span>
        </span>
      )}
      <Bubble side="left" who="观澜" text="前 10 条整理好了" />
    </span>
  );
}

/** 群消息形式：chat = 时间平铺；topic = 回复收进我的气泡、点开才看。 */
export function FormPreview({ mode }: { mode: "chat" | "topic" }) {
  return (
    <span className="tsd-stage" aria-hidden>
      <Bubble side="right" who="我" text="@观澜 看看今天的头条" />
      {mode === "chat" ? (
        <Bubble side="left" who="观澜" text="前 10 条整理好了" />
      ) : (
        <span className="tsd-topic">
          <MessagesSquare size={10} />
          <strong>3 条回复</strong>
          <small>今天热搜第 1 是…</small>
          <span className="tsd-topic-arrow">›</span>
        </span>
      )}
    </span>
  );
}

/** 对话流：simple = 收在折叠块里（点标题展开）；detail = 运行中直接铺开每一步。 */
export function FlowPreview({ mode }: { mode: "simple" | "detail" }) {
  return (
    <span className="tsd-stage" aria-hidden>
      {mode === "simple" ? <Fold text="过程 · 5 步（收起）" /> : (
        <span className="tsd-steps">
          <i>思考 · 2 秒</i>
          <i>读取 榜单.md</i>
          <i>执行 汇总脚本</i>
        </span>
      )}
      <Bubble side="left" who="观澜" text="前 10 条整理好了" />
    </span>
  );
}
