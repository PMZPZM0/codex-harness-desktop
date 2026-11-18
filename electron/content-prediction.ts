import path from "node:path";
import { statSync } from "node:fs";
import { expertSkillsSourceDir } from "./builtin-skills";

/** 以本机随包的工作流文件为准；初始化属于用户当前项目，不能由包的存在推断。 */
export function contentPredictionRow(root = expertSkillsSourceDir()) {
  const id = "cheat-on-content";
  const installTarget = path.join(root, id);
  const required = ["SKILL.md", ...["init", "score", "predict", "retro", "bump"].map(stage => `skills/cheat-${stage}/SKILL.md`)];
  const installed = required.every(file => {
    try {
      const stat = statSync(path.join(installTarget, file));
      return stat.isFile() && stat.size > 0;
    } catch { return false; }
  });
  return { id, name: "知微 · 自媒体流量预测", description: "稿件打分、发布前盲预测与发布后复盘", size: "随包技能", marker: "SKILL.md", installed, installing: false, hidden: true, builtIn: true, noUninstall: true, installTarget,
    fallbackPrompt: `请检查 ${installTarget} 的 SKILL.md 及 skills/cheat-init、cheat-score、cheat-predict、cheat-retro、cheat-bump 下的 SKILL.md。文件齐全时先读取总规则，再检查当前项目的初始化状态。缺文件时请通过本应用的官方安装包修复随包资源，然后重新检测。上游是 https://github.com/XBuilderLAB/cheat-on-content 。首次初始化前确认工作目录。` };
}
