import { useRef, useState } from "react";

export type FilePreview = { path: string; content: string; language: string; kind: "text" | "image" };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"]);

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
    try {
      // 走本地 IPC 读文件（比转发引擎的 fs/readFile 可靠：非任务上下文不依赖引擎、返回结构稳定）
      const result = await window.codex.readFile(path);
      const binary = atob(result.dataBase64 ?? "");
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const content = new TextDecoder().decode(bytes);
      const preview: FilePreview = { path, content: content.slice(0, 200_000), language: extension, kind: "text" };
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
