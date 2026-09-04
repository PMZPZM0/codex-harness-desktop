import { useState } from "react";

export type FilePreview = { path: string; content: string; language: string; kind: "text" | "image" };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"]);

type Options = {
  workspace: string;
  onNotice: (message: string) => void;
};

export function useFilePreview({ workspace, onNotice }: Options) {
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [fileEditing, setFileEditing] = useState(false);
  const [fileDraft, setFileDraft] = useState("");
  const [savingFile, setSavingFile] = useState(false);

  async function openFile(path: string) {
    try {
      const extension = path.split(".").pop()?.toLowerCase() ?? "text";
      if (IMAGE_EXTENSIONS.has(extension)) {
        setFilePreview({ path, content: "", language: extension, kind: "image" });
        setFileEditing(false);
        return;
      }
      // 走本地 IPC 读文件（比转发引擎的 fs/readFile 可靠：非任务上下文不依赖引擎、返回结构稳定）
      const result = await window.codex.readFile(path);
      const binary = atob(result.dataBase64 ?? "");
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const content = new TextDecoder().decode(bytes);
      setFilePreview({ path, content: content.slice(0, 200_000), language: extension, kind: "text" });
      setFileEditing(false);
    } catch (error: any) {
      // 剥掉 Electron 包装噪音（Error invoking remote method 'xxx':），只留可读原因
      const message = String(error?.message ?? error).replace(/^Error invoking remote method '[^']+':\s*/i, "");
      onNotice(`读取文件失败：${message}`);
    }
  }

  async function saveFilePreview() {
    if (!filePreview || !workspace) return;
    setSavingFile(true);
    try {
      await window.codex.writeFile(filePreview.path, fileDraft, workspace);
      setFilePreview({ ...filePreview, content: fileDraft });
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
    fileEditing,
    setFileEditing,
    fileDraft,
    setFileDraft,
    savingFile,
    openFile,
    saveFilePreview,
  };
}
