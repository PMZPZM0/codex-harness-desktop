import { healCliCommand } from "../../src/lib/cli-command.mjs";

/**
 * 校验群成员的 CLI 命令模板（11-28 安全审计 F-01；所有入口共用）。
 *
 * 为什么不能只在校验保存处做：`cliCommand` 有两条写入路径 ——
 *   ① 渲染层 IPC `boss-groups:member`（成员卡手填 / 模型调 group_add_member 后的转发）；
 *   ② `runner.ts` 的 `input.from === "cli"` 分支（模型调 group_add_member 拉 CLI agent 时**直接**写成员）。
 * 只在 ① 校验等于留旁路。⇒ 两侧都用 `safeCliTemplate`（heal + 校验），
 * 执行点也用同一个包装 —— 顺带覆盖「校验上线前就已经存进库里的旧模板」。
 *
 * 规则：必须含 `{prompt}`；去掉占位符后不得含能改变命令结构的元字符。
 * ⛔ 只拒不改：猜元字符意图去"净化"必然猜错，宁可直接报错让调用方写规范模板。
 * ⛔ 不做成 healCliCommand 的内部校验：heal 在「加载存档」时也会被调，
 *    在那里抛错会让整个群**加载失败**（一个坏成员拖死全部）。
 */
export function assertSafeCliTemplate(template: string): void {
  const command = String(template ?? "").trim();
  if (!command) return;
  if (!command.includes("{prompt}")) {
    throw new Error("cliCommand 必须包含 {prompt} 占位符（它接收任务全文）；不写这个参数就会走宿主的标准模板");
  }
  if (/[;&|`$()<>\n\r]/.test(command.split("{prompt}").join(""))) {
    throw new Error("cliCommand 只能是「程序 + 参数」形式的模板：不能含 ; & | ` $ ( ) < > 或换行（这些能改变命令结构）");
  }
}

/** heal + 校验（不合规就抛）。所有「要用模板拼命令」的地方都走它，替代裸 healCliCommand。 */
export function safeCliTemplate(template: string | null | undefined): string {
  const healed = healCliCommand(template ?? "");
  assertSafeCliTemplate(healed);
  return healed;
}
