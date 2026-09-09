import { useRef, useState } from "react";

export type FilePreview = { path: string; content: string; language: string; kind: "text" | "image" | "binary" | "pdf" };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"]);
// 二进制格式：点开只会得到乱码，直接给占位卡（Office / 压缩包 / 可执行 / 媒体 / 字体 / 数据库 …）
const BINARY_EXTENSIONS = new Set([
  // Office / 文档容器（xls 老格式是 OLE2 复合文档，xlsx/docx/pptx 是 zip 包）
  "xls", "xlsx", "xlsb", "xlsm", "doc", "docx", "docm", "dot", "dotx", "ppt", "pptx", "pptm", "pps", "ppsx", "odt", "ods", "odp", "wps", "et", "dps",
  // 压缩包 / 磁盘镜像
  "zip", "rar", "7z", "gz", "tgz", "bz2", "xz", "tar", "iso", "img", "dmg",
  // 可执行 / 库 / 目标文件
  "exe", "dll", "so", "dylib", "bin", "msi", "apk", "com", "sys", "class", "jar", "war", "pyc", "pyo", "o", "obj", "lib", "a", "wasm",
  // 媒体（时间线无法预览音视频，交给占位）
  "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "mp3", "wav", "flac", "aac", "ogg", "m4a",
  // 字体 / 数据库 / 设计源文件
  "ttf", "otf", "woff", "woff2", "eot", "db", "sqlite", "sqlite3", "mdb", "accdb", "psd", "ai", "xd", "sketch", "dwg",
]);

/** 魔数嗅探：扩展名不认识的文件，读回内容后按文件头/NUL 字节兜底判二进制。 */
function looksBinary(bytes: Uint8Array): boolean {
  const signatures: number[][] = [
    [0x50, 0x4b],                     // PK（zip 容器：xlsx/docx/pptx/jar…）
    [0x4d, 0x5a],                     // MZ（exe/dll）
    [0x25, 0x50, 0x44, 0x46],         // %PDF
    [0xd0, 0xcf, 0x11, 0xe0],         // OLE2 复合文档（xls/doc/ppt 老格式、msi）
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
    [0x52, 0x61, 0x72, 0x21],         // Rar!
    [0x1f, 0x8b],                     // gzip
    [0x42, 0x5a, 0x68],               // bzip2
    [0x7f, 0x45, 0x4c, 0x46],         // ELF（linux 可执行）
    [0x53, 0x51, 0x4c, 0x69],         // SQLite
    [0x00, 0x00, 0x01, 0x00],         // ico
  ];
  if (signatures.some((sig) => sig.every((byte, index) => bytes[index] === byte))) return true;
  // 文本文件不含 NUL 字节：前 4K 出现 NUL 即视为二进制
  const limit = Math.min(bytes.length, 4096);
  for (let index = 0; index < limit; index++) if (bytes[index] === 0) return true;
  return false;
}

/** UTF-8 解码后替换字符（U+FFFD）占比过高 → 大概率是 GBK/GB18030 编码的中文文本，重解一次。 */
function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const sample = utf8.slice(0, 4000);
  const replacement = (sample.match(/\uFFFD/g) ?? []).length;
  if (replacement / Math.max(1, sample.length) > 0.02) {
    try { return new TextDecoder("gbk").decode(bytes); } catch { return utf8; }
  }
  return utf8;
}

type Options = {
  workspace: string;
  onNotice: (message: string) => void;
};

export function useFilePreview({ workspace, onNotice }: Options) {
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  // WorkBuddy 式多文件标签：按打开顺序记录路径，切标签走缓存免重读
  const [fileTabs, setFileTabs] = useState<string[]>([]);
  const [fileEditing, setFileEditing] = useState(false);
  const [fileDraft, setFileDraft] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  // 已加载内容缓存：切换标签零延迟；关闭标签时释放
  const cacheRef = useRef<Map<string, FilePreview>>(new Map());
  // 最近一次请求的路径：慢响应回来时校验，防止连点多个文件后被旧响应覆盖
  const activeReqRef = useRef("");

  async function openFile(path: string) {
    activeReqRef.current = path;
    setFileTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    const cached = cacheRef.current.get(path);
    if (cached) {
      setFilePreview(cached);
      setFileEditing(false);
      return;
    }
    const extension = path.split(".").pop()?.toLowerCase() ?? "text";
    if (IMAGE_EXTENSIONS.has(extension)) {
      const preview: FilePreview = { path, content: "", language: extension, kind: "image" };
      cacheRef.current.set(path, preview);
      setFilePreview(preview);
      setFileEditing(false);
      return;
    }
    // PDF：不读文件内容，iframe 走 harness-image 协议（net.fetch file:// 会给出
    // application/pdf 的 content-type，Chromium 内置查看器直接渲染）
    if (extension === "pdf") {
      const preview: FilePreview = { path, content: "", language: "pdf", kind: "pdf" };
      cacheRef.current.set(path, preview);
      setFilePreview(preview);
      setFileEditing(false);
      return;
    }
    // 已知二进制格式（Office/压缩包/可执行/媒体…）：读都不会读，直接占位——
    // 塞进 TextDecoder 只会得到一堆乱码（09-08 反馈：xls 预览全是乱码）
    if (BINARY_EXTENSIONS.has(extension)) {
      const preview: FilePreview = { path, content: "", language: extension, kind: "binary" };
      cacheRef.current.set(path, preview);
      setFilePreview(preview);
      setFileEditing(false);
      return;
    }
    try {
      // 走本地 IPC 读文件（比转发引擎的 fs/readFile 可靠：非任务上下文不依赖引擎、返回结构稳定）
      const result = await window.codex.readFile(path);
      const binary = atob(result.dataBase64 ?? "");
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      // 未知扩展名兜底：文件头/NUL 嗅探出二进制同样给占位，不渲染乱码
      if (looksBinary(bytes)) {
        const preview: FilePreview = { path, content: "", language: extension, kind: "binary" };
        cacheRef.current.set(path, preview);
        if (activeReqRef.current !== path) return;
        setFilePreview(preview);
        setFileEditing(false);
        return;
      }
      const content = decodeText(bytes).slice(0, 200_000);
      const preview: FilePreview = { path, content, language: extension, kind: "text" };
      cacheRef.current.set(path, preview);
      if (activeReqRef.current !== path) return; // 用户已切走，丢弃过期响应
      setFilePreview(preview);
      setFileEditing(false);
    } catch (error: any) {
      // 剥掉 Electron 包装噪音（Error invoking remote method 'xxx':），只留可读原因
      const message = String(error?.message ?? error).replace(/^Error invoking remote method '[^']+':\s*/i, "");
      if (activeReqRef.current === path) onNotice(`读取文件失败：${message}`);
      // 失败的标签不保留，避免残留一个永远空白的 tab
      setFileTabs((prev) => prev.filter((entry) => entry !== path));
    }
  }

  function closeTab(path: string) {
    const next = fileTabs.filter((entry) => entry !== path);
    setFileTabs(next);
    cacheRef.current.delete(path);
    if (filePreview?.path === path) {
      const fallback = next[next.length - 1];
      setFilePreview(fallback ? cacheRef.current.get(fallback) ?? null : null);
      setFileEditing(false);
    }
  }

  async function saveFilePreview() {
    if (!filePreview || !workspace) return;
    setSavingFile(true);
    try {
      await window.codex.writeFile(filePreview.path, fileDraft, workspace);
      const updated: FilePreview = { ...filePreview, content: fileDraft };
      cacheRef.current.set(filePreview.path, updated);
      setFilePreview(updated);
      setFileEditing(false);
      onNotice(`已保存 ${filePreview.path.split(/[\\/]/).pop()}`);
    } catch (error: any) {
      onNotice(`保存失败：${error.message}`);
    } finally {
      setSavingFile(false);
    }
  }

  return {
    filePreview,
    setFilePreview,
    fileTabs,
    closeTab,
    fileEditing,
    setFileEditing,
    fileDraft,
    setFileDraft,
    savingFile,
    openFile,
    saveFilePreview,
  };
}
