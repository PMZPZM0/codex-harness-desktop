import fs from "node:fs/promises";
import path from "node:path";

/**
 * 自定义斜杠命令服务（复刻 WorkBuddy/CodeBuddy 的 commands/*.md 机制）。
 *
 * 存放位置：
 *  - 个人全局：$CODEX_HOME/commands/*.md
 *  - 项目级：  <cwd>/.codex/commands/*.md
 * 子目录用冒号层级命名：frontend/build.md -> /frontend:build
 *
 * 每个文件是带可选 YAML frontmatter 的 Markdown：
 *   description      —— 命令简介（列表与补全时展示）
 *   argument-hint    —— 参数提示，如 "[test-file]"
 *   allowed-tools    —— 允许使用的工具，如 "Bash(git:*), Read"
 *   model            —— 指定执行模型
 *   disable-model-invocation —— true 时只允许 /name 手动触发
 *
 * 正文支持模板语法：
 *   $1/$2/.../ $ARGUMENTS  位置参数与全部参数
 *   @path                  引用并注入文件内容
 *   !`cmd`                 行内 shell 命令（展开时转为执行指令，由模型执行）
 */
export type CommandSource = "global" | "project";

export type CustomCommandMeta = {
  description: string;
  argumentHint: string;
  allowedTools: string;
  model: string;
  disableModelInvocation: boolean;
};

export type CustomCommandEntry = CustomCommandMeta & {
  /** 命令名（不含斜杠），子目录用冒号：frontend:build */
  name: string;
  filePath: string;
  source: CommandSource;
  /** 相对命令目录的路径，如 frontend/build.md */
  relativePath: string;
  /** 正文（frontmatter 之后的内容） */
  body: string;
  /** 完整原始文件内容 */
  raw: string;
  updatedAt: number;
};

const EMPTY_META: CustomCommandMeta = {
  description: "",
  argumentHint: "",
  allowedTools: "",
  model: "",
  disableModelInvocation: false,
};

/** 从原始 Markdown 里剥掉开头的 YAML frontmatter（--- ... ---） */
function parseFrontmatter(raw: string): { meta: CustomCommandMeta; body: string } {
  const meta: CustomCommandMeta = { ...EMPTY_META };
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta, body: raw.trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case "description": meta.description = value; break;
      case "argument-hint": meta.argumentHint = value; break;
      case "allowed-tools": meta.allowedTools = value; break;
      case "model": meta.model = value; break;
      case "disable-model-invocation": meta.disableModelInvocation = value === "true" || value === "yes" || value === "1"; break;
    }
  }
  return { meta, body: raw.slice(match[0].length).trim() };
}

/** 校验命令名：字母数字开头，可含中划线/下划线，冒号分隔层级 */
export function isValidCommandName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*(?::[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(name);
}

/** 命令名 -> 相对文件路径（冒号转目录分隔符） */
function commandNameToRelative(name: string): string {
  return name.split(":").join(path.sep) + ".md";
}

/** 相对文件路径 -> 命令名（目录分隔符转冒号，去掉 .md） */
function relativeToCommandName(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "").split(/[\\/]/).join(":");
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** 组装 .md 文件内容（frontmatter 只写非空字段） */
export function buildCommandFile(input: {
  description: string;
  argumentHint: string;
  allowedTools: string;
  model: string;
  body: string;
}): string {
  const lines: string[] = ["---"];
  if (input.description) lines.push(`description: ${quote(input.description)}`);
  if (input.argumentHint) lines.push(`argument-hint: ${quote(input.argumentHint)}`);
  if (input.allowedTools) lines.push(`allowed-tools: ${quote(input.allowedTools)}`);
  if (input.model) lines.push(`model: ${quote(input.model)}`);
  lines.push("---", "");
  lines.push(input.body.trim());
  return lines.join("\n") + "\n";
}

/** 递归扫描目录下的 .md 文件，返回相对路径列表（保持稳定顺序） */
async function walkMarkdown(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await walkMarkdown(full);
      for (const child of children) out.push(path.join(entry.name, child));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

async function readEntry(dir: string, relativePath: string, source: CommandSource): Promise<CustomCommandEntry | null> {
  const filePath = path.join(dir, relativePath);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  let updatedAt = 0;
  try {
    updatedAt = (await fs.stat(filePath)).mtimeMs;
  } catch { /* ignore */ }
  return {
    ...meta,
    name: relativeToCommandName(relativePath),
    filePath,
    source,
    relativePath: relativePath.split(path.sep).join("/"),
    body,
    raw,
    updatedAt,
  };
}

/** 列出全部自定义命令（全局 + 项目），项目级排前面（优先级更高） */
export async function listCustomCommands(codexHome: string, cwd?: string): Promise<CustomCommandEntry[]> {
  const results: CustomCommandEntry[] = [];
  const dirs: { dir: string; source: CommandSource }[] = [];
  if (cwd) dirs.push({ dir: path.join(cwd, ".codex", "commands"), source: "project" });
  dirs.push({ dir: path.join(codexHome, "commands"), source: "global" });
  for (const { dir, source } of dirs) {
    const relatives = await walkMarkdown(dir);
    for (const relative of relatives) {
      const entry = await readEntry(dir, relative, source);
      if (entry) results.push(entry);
    }
  }
  return results;
}

export async function readCustomCommand(filePath: string, codexHome: string, cwd?: string): Promise<CustomCommandEntry | null> {
  const norm = path.normalize(filePath);
  let baseDir: string | null = null;
  let source: CommandSource = "global";
  if (cwd) {
    const projectDir = path.join(cwd, ".codex", "commands");
    if (norm.startsWith(path.normalize(projectDir) + path.sep)) {
      baseDir = projectDir;
      source = "project";
    }
  }
  if (!baseDir) {
    const globalDir = path.join(codexHome, "commands");
    if (!norm.startsWith(path.normalize(globalDir) + path.sep)) return null; // 不在命令目录内，拒绝读取
    baseDir = globalDir;
  }
  const relative = path.relative(baseDir, norm);
  return readEntry(baseDir, relative, source);
}

export type SaveCommandInput = {
  /** 命令名（不含斜杠，冒号分层） */
  name: string;
  source: CommandSource;
  description?: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
  body: string;
  /** 编辑重命名时传旧 filePath，用于删除旧文件 */
  prevFilePath?: string;
  codexHome: string;
  cwd?: string;
};

/** 保存（新建或更新）自定义命令，返回新条目 */
export async function saveCustomCommand(input: SaveCommandInput): Promise<CustomCommandEntry> {
  const name = input.name.trim();
  if (!isValidCommandName(name)) {
    throw new Error(`命令名不合法：${name}。只能包含字母/数字/中划线/下划线，层级用冒号分隔（如 git:commit）。`);
  }
  if (input.source === "project" && !input.cwd) {
    throw new Error("项目级命令需要当前工作区路径。");
  }
  const baseDir = input.source === "project" && input.cwd
    ? path.join(input.cwd, ".codex", "commands")
    : path.join(input.codexHome, "commands");
  const relative = commandNameToRelative(name);
  const filePath = path.join(baseDir, relative);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = buildCommandFile({
    description: input.description ?? "",
    argumentHint: input.argumentHint ?? "",
    allowedTools: input.allowedTools ?? "",
    model: input.model ?? "",
    body: input.body ?? "",
  });
  await fs.writeFile(filePath, content, "utf8");
  if (input.prevFilePath && path.resolve(input.prevFilePath) !== path.resolve(filePath)) {
    await fs.rm(input.prevFilePath, { force: true });
  }
  const entry = await readEntry(baseDir, relative, input.source);
  if (!entry) throw new Error("命令保存后读取失败。");
  return entry;
}

export async function deleteCustomCommand(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

/**
 * 把命令正文展开成可直接发送的 prompt：
 *  - $1/$2/.../$ARGUMENTS 参数替换
 *  - @path 注入文件内容（文件存在才替换）
 *  - !`cmd` 行转成执行指令文本（不在此处执行，交给模型）
 */
export async function expandCommandTemplate(entry: CustomCommandEntry, argument: string, cwd?: string): Promise<string> {
  let text = entry.body;
  const args = argument.split(/\s+/).filter(Boolean);
  text = text.replace(/\$ARGUMENTS/g, argument);
  text = text.replace(/\$(\d+)/g, (_match, index: string) => args[Number(index) - 1] ?? "");
  // @file 引用：仅在文件存在时注入
  text = await replaceFileRefs(text, cwd);
  // !`cmd` 行：转为执行指令
  text = text.replace(/^!`([^`\n]+)`\s*$/gm, "请先执行命令 `$1`，并把它的输出作为上下文继续。");
  return text.trim();
}

async function replaceFileRefs(text: string, cwd?: string): Promise<string> {
  const tokens = text.match(/@([^\s$@]+)/g) ?? [];
  for (const token of tokens) {
    const ref = token.slice(1);
    if (!ref) continue;
    const abs = path.isAbsolute(ref) ? ref : cwd ? path.join(cwd, ref) : ref;
    try {
      const content = await fs.readFile(abs, "utf8");
      text = text.split(token).join(`（文件 ${ref} 内容：\n\`\`\`\n${content.slice(0, 20000)}\n\`\`\`）`);
    } catch { /* 文件不存在就保留原样 */ }
  }
  return text;
}
