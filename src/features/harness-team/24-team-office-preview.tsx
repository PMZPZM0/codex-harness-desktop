/**
 * 团队模式 · 办公室预览入口（11-08 用户令：「还有办公室预览接进来」）
 *
 * ⛔⛔ 铁律：**入口节点与预览组件都复用**，本文件只做"取值 + 接线"：
 *   · 节点 = `OfficeRailNode`（专家团成员轨 / 普通会话调度轨 / 中枢群成员轨 / 这里，四处同一个）；
 *   · 预览 = `TeamOfficePreview`（像素办公室 + 缩放 + 点角色开会话，全在主对话那一条链上）。
 *   各写一份的话图标/位置/交互马上会漂开 —— 10-05 用户就是为此报的「两处不一致」。
 *
 * 数据边界（与中枢会话同口径）：群里的人 = 办公室里的工位。
 *   正在跑（本群 live 里 status=running）→ busy（坐下敲键盘 + 气泡）；
 *   其余 → idle（待机屏保）。⛔ 不按 members 的静态角色编状态。
 *
 * 落点：群头操作区、**收起/展开成员栏键的左边**（11-08 用户截图令：
 * 「把办公室预览图标放到设置按键这一排的展开折叠左边」；群头操作区才是"对这个群的操作"）。
 */
import { useMemo, useState } from "react";
import { OfficeRailNode } from "../experts-teams";
import { TeamOfficePreview } from "../team-office";
import type { TeamGroup } from "./01-team-types";
import type { LiveRun } from "./02-team-store";

export function TeamOfficeEntry({ group, live, busy, onOpenThread }: {
  group: TeamGroup;
  live?: LiveRun[];
  busy?: string[];
  onOpenThread?: (threadId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  /* 工位 = 群里的人（含群主）。状态只认运行态：live 里有正在跑的回合 / busy 名单里。 */
  const groupMembers = useMemo(() => {
    const running = new Set((live ?? []).filter((run) => run.status === "running").map((run) => run.memberId));
    for (const id of busy ?? []) running.add(id);
    return group.members.map((member) => {
      const liveRun = (live ?? []).find((run) => run.memberId === member.id && run.status === "running");
      return {
        id: member.id,
        name: String(member.name ?? "成员"),
        role: member.kind === "bot" ? "伙伴" : "成员",
        status: running.has(member.id) ? "busy" : "idle",
        threadId: liveRun?.threadId,
      };
    });
  }, [group.members, live, busy]);

  return (
    <>
      <div className="team-group__office">
        <OfficeRailNode
          onOpen={() => setOpen(true)}
          title="办公室预览：群里正在干活的成员实时映射成像素办公室，点角色打开会话"
        />
      </div>
      {open && (
        <TeamOfficePreview
          /* ⛔ 必须给一个**真 id**：TeamOfficePreview 开头是 `if (!teamId) return null`（团队模式那张卡
             靠 teamId 判断要不要画）。群这条走的是 `groupMembers` 分支 ⇒ 传群 id 即可（查不到团队
             就落到"群工位"那一路，与中枢会话传 bossGroupId 完全同构）。 */
          teamId={group.id}
          teams={[]}
          runningByMember={{}}
          lastByMember={{}}
          groupMembers={groupMembers}
          openThread={(threadId) => {
            setOpen(false);
            onOpenThread?.(threadId);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
