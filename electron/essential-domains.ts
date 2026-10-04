/**
 * 不可停用的域（10-04 阶段 6）—— **单一真相源**。
 *
 * ⛔ 为什么必须有一份显式名单：停用是"下次启动不挂载"，而域的通道是渲染层唯一的调用入口。
 *   用户停掉一个域 ⇒ 那个功能的所有 invoke 抛 `No handler registered`（表现为组件空白 /
 *   catch 成空数组 / 永远"加载中"）。所以有些域**不能**给用户停：
 *
 *   · user / capabilities —— 身份与能力清单本身（停用它，设置页与状态栏都拿不到数据）
 *   · app / dialog / fs    —— 文件对话框、可信根校验、诊断/存储管理（停用它，
 *                            "重开模型文件""清理缓存"这类基础操作就没了）
 *   · engine / codex / thread-runtime / threads —— 引擎与会话主链路
 *                            （停用它 = 应用不能对话）
 *   · runtime / shell / external —— 工具链安装、文件定位、外链（其他功能的前置）
 *
 * ⛔ 这不是"重要程度排序"，是**功能依赖**：被依赖者停掉 ⇒ 依赖它的功能连带失效，
 *   而用户看到的只是"某个按钮不工作了"，极难归因。宁可少给几个开关。
 *
 * ⚠️ 新增域时若它属于上述任一类，必须同步加进来 —— 守卫【269】会查组合表里
 *    标了 `essential: true` 的域与本名单一致（两处不许各写一份）。
 */

/** 不可停用的域 id。 */
export const ESSENTIAL_DOMAINS: readonly string[] = [
  // 身份 / 能力
  "user", "capabilities",
  // 宿主基础能力（对话框、可信根校验、诊断与存储）
  "app", "dialog", "fs",
  // 引擎与会话主链路
  "engine", "codex", "thread-runtime", "threads",
  // 其他功能的前置
  "runtime", "shell", "external",
];

/** 该域是否不可停用。 */
export function isEssentialDomain(id: string): boolean {
  return ESSENTIAL_DOMAINS.includes(id);
}
