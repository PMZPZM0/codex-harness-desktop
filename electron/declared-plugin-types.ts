/** 声明式插件的数据类型（10-04 B 档）。与 electron/declared-plugins.ts 分离，让渲染层也能复用。 */

/** 插件往某个插槽位挂的一份内容。 */
export type DeclaredPluginSlot = {
  /** 已登记的插槽位 id（见 KNOWN_SLOTS） */
  slot: string;
  /** 同插槽内排序，小的靠前 */
  order: number;
  /** 紧凑位的按钮文案（≤40 字符） */
  label: string;
  /** 悬浮提示（≤40 字符） */
  title: string;
  /**
   * 点一下调哪条**已有** IPC 通道（空串 = 不调）。
   * ⛔ 只能是 manifest 里已存在的通道 —— 声明式插件不得新增通道。
   */
  invoke: string;
  /** 通道参数（纯 JSON，原样传给 invoke） */
  args?: Record<string, unknown>;
  /** 或直接渲染一段静态文本（≤2000 字符） */
  text: string;
};

/** 一份插件清单。 */
export type DeclaredPlugin = {
  /** 全局唯一，小写字母开头 */
  id: string;
  name: string;
  version: string;
  description: string;
  /** 默认是否启用（缺省 true） */
  enabled: boolean;
  /** 来源由宿主判定，不信文件里的自述 */
  source: "builtin" | "user";
  slots: DeclaredPluginSlot[];
};

/** domains:declared-plugins 通道的返回形状。 */
export type DeclaredPluginsResult = {
  plugins: DeclaredPlugin[];
  /** 被跳过的无效清单（外部输入不可信 ⇒ 必须能报告而不是静默） */
  issues: { file: string; id: string; reason: string }[];
  /** 两个目录的绝对路径（UI 要显示"放哪"） */
  builtinDir: string;
  userDir: string;
  /** 用户当前是否禁用了某些插件（id 集合；缺省 = 启用） */
  disabledIds: string[];
  knownSlots: string[];
};