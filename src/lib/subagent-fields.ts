/** 子智能体的沙箱 / 审批选项：表单下拉与卡片回显共用一份（⛔ 别在两处各写一套标签）。 */
export const SUBAGENT_SANDBOX_OPTIONS = [
  { value: "read-only", label: "只读" },
  { value: "workspace-write", label: "工作区写入" },
  { value: "danger-full-access", label: "完全访问" },
];

export const SUBAGENT_APPROVAL_OPTIONS = [
  { value: "never", label: "从不" },
  { value: "on-request", label: "按需" },
  { value: "on-failure", label: "失败时" },
  { value: "untrusted", label: "不可信" },
];

export function subagentFieldLabel(options: { value: string; label: string }[], value: string | undefined) {
  return options.find((option) => option.value === value)?.label ?? (value || "未指定");
}
