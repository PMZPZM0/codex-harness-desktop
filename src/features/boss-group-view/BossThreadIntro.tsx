/**
 * BOSS 会话的**专属欢迎界面**（10-25 用户令第二轮改版）。
 *
 * ⛔ 骨架**沿用普通会话欢迎页**（`.welcome-state`：大图标 → 渐变大字标题 → 小字副标题，
 *    居中排布）—— 用户原话：「普通会话的欢迎界面，那个就挺好看的，你稍微优化一下就好了」。
 *    ⇒ 这里**不另起炉灶**，只在三处做区分：
 *      · 图标：普通会话是灰蓝色 `</>` 水印 ⇒ 这里换成**琥珀色皇冠**；
 *      · 标题渐变：普通会话是品牌蓝 `--link` ⇒ 这里用**琥珀 `--ic-amber`**；
 *      · 内容：普通会话讲通用待办 ⇒ 这里讲**群编排**（拉群 → 干活 → 验收打回）。
 *    ⛔ **不做成大卡片**（用户令：「不要复用大卡片样式」）—— 靠留白分层，不靠盒子。
 *
 * ⛔ 快捷键标签走 `boss-shortcut.ts`（**单一真相源**，与侧栏行尾 kbd 徽标同源）。
 * ⛔ 「选择项目地址」按钮走 `boss-dir-dialog-store.mjs`（**全局开关**）：点侧栏「BOSS 会话」
 *    ⇒ 先落在这个欢迎界面上，再由这里把项目地址对话框叫出来。
 */
import { Crown, Keyboard } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { bossShortcutLabel } from "./boss-shortcut";
import { consumeBossDirAutoOpen, getBossDirDialogState, openBossDirDialog, subscribeBossDirDialog } from "./boss-dir-dialog-store.mjs";

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
      <p className="boss-welcome-sub">这个会话当调度台用：说需求就行，拉群、派活、盯进度、验收打回，全在这儿闭环。</p>

      <div className="boss-welcome-actions">
        <button type="button" className="boss-welcome-primary" onClick={() => openBossDirDialog()}>
          {dir ? "更换项目地址" : "选择项目地址并开始"}
        </button>
        <span className="boss-welcome-keys">
          <Keyboard size={12} />
          新建 BOSS 会话
          <kbd className="boss-welcome-kbd">{bossShortcutLabel()}</kbd>
        </span>
      </div>

      {dir ? <p className="boss-welcome-dir">项目地址：<code>{dir}</code></p> : null}
    </div>
  );
}
