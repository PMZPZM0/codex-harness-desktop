import { useEffect, useState } from "react";

export type ChannelBot = {
  enabled: boolean; host: "127.0.0.1" | "0.0.0.0"; port: number; workspace: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access"; appId: string;
  hasAppSecret?: boolean; hasVerificationToken?: boolean; hasEncryptKey?: boolean;
  running?: boolean; endpoint?: string; bindings?: number;
  logs?: { at: number; level: "info" | "error"; message: string }[];
};

export type ChannelDraft = {
  enabled: boolean;
  host: "127.0.0.1" | "0.0.0.0";
  port: string;
  workspace: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
};

export function useChannelBot() {
  const [channelBot, setChannelBot] = useState<ChannelBot | null>(null);
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>({ enabled: false, host: "127.0.0.1", port: "8787", workspace: localStorage.getItem("workspace") ?? "", sandbox: "workspace-write", appId: "", appSecret: "", verificationToken: "", encryptKey: "" });
  const [channelAction, setChannelAction] = useState<"save" | "test" | null>(null);
  const [channelStatus, setChannelStatus] = useState("");

  useEffect(() => {
    void window.codex.getChannelBot()
      .then((result) => {
        setChannelBot(result);
        setChannelDraft({ enabled: result.enabled, host: result.host, port: String(result.port), workspace: result.workspace, sandbox: result.sandbox, appId: result.appId, appSecret: "", verificationToken: "", encryptKey: "" });
      })
      .catch(() => undefined);
  }, []);

  async function saveChannelBot() {
    setChannelAction("save");
    setChannelStatus("");
    try {
      const saved = await window.codex.saveChannelBot(channelDraft);
      setChannelBot(saved);
      setChannelDraft((current) => ({ ...current, appSecret: "", verificationToken: "", encryptKey: "" }));
      setChannelStatus(saved.running ? `运行中 · ${saved.endpoint}` : "配置已保存，机器人未启用");
    } catch (error: any) {
      setChannelStatus(`保存失败：${error.message}`);
    } finally {
      setChannelAction(null);
    }
  }

  async function testChannelBot() {
    setChannelAction("test");
    setChannelStatus("");
    try {
      const result = await window.codex.testChannelBot(channelDraft);
      setChannelStatus(`飞书凭据有效 · ${result.latencyMs} ms`);
    } catch (error: any) {
      setChannelStatus(`连接失败：${error.message}`);
    } finally {
      setChannelAction(null);
    }
  }

  async function chooseChannelWorkspace() {
    const value = await window.codex.chooseDirectory();
    if (value) setChannelDraft((current) => ({ ...current, workspace: value }));
  }

  return {
    channelBot,
    setChannelBot,
    channelDraft,
    setChannelDraft,
    channelAction,
    channelStatus,
    setChannelStatus,
    saveChannelBot,
    testChannelBot,
    chooseChannelWorkspace,
  };
}
