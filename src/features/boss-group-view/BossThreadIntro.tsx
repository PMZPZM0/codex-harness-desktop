/**
 * BOSS 会话的**专属欢迎界面**（10-25 用户令第二轮改版）。
 *
 * ⛔ 骨架**沿用普通会话欢迎页**（`.welcome-state`：大图标 → 渐变大字标题 → 小字副标题，
 *    **居中**排布）—— 用户原话：「普通会话的欢迎界面，那个就挺好看的，你稍微优化一下就好了」
 *    +「欢迎界面的文案要跟普通会话的欢迎界面一样居中啊」。
 *    ⇒ 这里**不另起炉灶**，只在三处做区分：
 *      · 图标：普通会话是灰蓝色 `</>` 水印 ⇒ 这里换成**琥珀色皇冠**；
 *      · 标题渐变：普通会话是品牌蓝 `--link` ⇒ 这里用**琥珀 `--ic-amber`**；
 *      · 内容：普通会话讲通用待办 ⇒ 这里讲**群编排**（拉群 → 干活 → 验收打回）。
 *    ⛔ **不做成大卡片**（用户令：「不要复用大卡片样式」）—— 靠留白分层，不靠盒子。
 *
 * ⛔ 「选择项目地址」按钮走 `boss-dir-dialog-store.mjs`（**全局开关**）：点侧栏「BOSS 会话」
 *    ⇒ 先落在这个欢迎界面上，再由这里把项目地址对话框叫出来。
 * ⛔ 快捷键提示**不放这里**（用户原话：「新建会话+快捷这个提示你也放这里，太LOW 了…
 *    小字提示太LOW 了，我不喜欢，一点个性没有」）⇒ 快捷键只留在侧栏按钮行尾的 kbd 徽标上，
 *    欢迎界面改成**有信息量的引导**（做什么 / 下一步点哪儿 / 这条会话的规矩）。
 */
import { Crown } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { consumeBossDirAutoOpen, getBossDirDialogState, openBossDirDialog, subscribeBossDirDialog } from "./boss-dir-dialog-store.mjs";

/** 欢迎界面上要讲清的三件事（不是装饰，是「下一步怎么做」）。 */
const GUIDE = [
  ["说目标", "提一句要什么，我按岗位拉专家、专家团、本机 CLI agent 进群"],
  ["看结果", "成员各自开会话干活，成品汇总回这条会话，审不过我打回重做"],
  ["认规矩", "这条会话一直用下去，不每轮新建；记忆与目录都跟普通会话分开"],
];

export function BossThreadIntro({ cwd = "" }: { cwd?: string }) {
  /* 已选定的项目地址：⛔ **按会话隔离**（10-25 用户令：BOSS 会话可创建多个，互不干扰）：
     · `cwd`（会话自己的 cwd，来自会话记录）优先 ⇒ 已建立的会话各显示各的目录；
     · 会话还没建出来时（刚选完地址、还没发第一句）回落到 store 里的 pending 目录。
     ⛔ 不用「全局单个目录」——那样 A 会话选了 /a、B 会话选了 /b，切回 A 会显示 /b（串项）。 */
  const dirState = useSyncExternalStore(subscribeBossDirDialog, getBossDirDialogState);
  const dir = cwd || dirState.dir;

  /* ⛔ 10-25 用户实测第二轮：「点 BOSS 会话，先出来这个弹窗，不会跳转到 BOSS 欢迎界面，
     再跳这个弹窗」⇒ 顺序必须是 **先看到欢迎界面、再弹对话框**。
     ⇒ 侧栏按钮只置「自动弹出」标记，这里（欢迎界面已渲染出来）消费它再开弹窗。 */
  useEffect(() => {
    if (consumeBossDirAutoOpen()) openBossDirDialog();
  }, []);

  return (
    <div className="boss-welcome">
      <div className="boss-welcome-mark"><Crown size={64} strokeWidth={0.7} /></div>
      <h1 className="boss-welcome-title">BOSS 会话</h1>
      <p className="boss-welcome-sub">这个会话当调度台用：拉群、派活、盯进度、验收打回，全在这儿闭环。</p>

      <ol className="boss-welcome-guide">
        {GUIDE.map(([title, text], index) => (
          <li key={title}>
            <span className="boss-welcome-step">{index + 1}</span>
            <b>{title}</b>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <div className="boss-welcome-actions">
        <button type="button" className="boss-welcome-primary" onClick={() => openBossDirDialog()}>
          {dir ? "换个项目地址" : "选个项目地址，开工"}
        </button>
        {dir ? <span className="boss-welcome-dir">当前地址 <code>{dir}</code></span> : null}
      </div>
    </div>
  );
}
