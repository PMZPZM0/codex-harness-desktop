import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, MessageSquare, RefreshCw, ShieldCheck, TriangleAlert, UserRound, Wrench } from "lucide-react";

type PersonalizationConfig = { nickname?: string; customInstructions?: string };

/** personalization:verify 的回读结果：直接读真实落盘的 AGENTS.md，不是「我以为写成功了」 */
type VerifyResult = {
  exists: boolean;
  expects: boolean;
  applied: boolean;
  inSync: boolean;
  preview: string;
  agentsPath: string;
};

const stylePresets = [
  { value: "pragmatic", title: "务实", desc: "直接给结论和代码，少铺垫。适合赶进度的工程任务。", sample: "结论：把 offsetTop 换成相对滚动容器的坐标即可。" },
  { value: "friendly", title: "友好", desc: "解释更详细耐心，会主动交代思路与取舍。适合边做边学。", sample: "我先说结论，再解释为什么：这个问题的根因是…" },
  { value: "none", title: "默认", desc: "跟随模型默认风格，不额外注入语气指令。", sample: "（不注入风格指令，使用模型默认表达）" },
];

/**
 * 个性化设置页：称呼 + 回复风格 + 自定义指令。
 * 称呼与自定义指令写到 Codex 原生的 $CODEX_HOME/AGENTS.md，引擎每个会话开始时自动注入
 * （user 级指令层），并与项目仓库里的 AGENTS.md 分层合并；保存后自动重启引擎。
 */
export function PersonalizationPage({
  personality,
  onPersonalityChange,
  onNotice,
}: {
  personality: string;
  onPersonalityChange: (value: string) => void;
  onNotice: (message: string) => void;
}) {
  const [config, setConfig] = useState<PersonalizationConfig>({});
  const [nickname, setNickname] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const initial = useRef<PersonalizationConfig>({});

  const runVerify = useCallback(async () => {
    setVerifying(true);
    try { setVerify(await window.codex.verifyPersonalization()); }
    catch { setVerify(null); }
    finally { setVerifying(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    void window.codex
      .readPersonalization()
      .then((next) => {
        if (!alive) return;
        setConfig(next);
        setNickname(next.nickname ?? "");
        setInstructions(next.customInstructions ?? "");
        initial.current = next;
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoaded(true); });
    void runVerify();
    return () => { alive = false; };
  }, [runVerify]);

  const dirty = nickname.trim() !== (initial.current.nickname ?? "") || instructions.trim() !== (initial.current.customInstructions ?? "");

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const next = await window.codex.savePersonalization({ nickname: nickname.trim(), customInstructions: instructions.trim() });
      setConfig(next);
      initial.current = next;
      // 同步左下角账户名缓存（App.tsx 启动时会以 nickname 为权威源覆盖）
      localStorage.setItem("username", next.nickname ?? "");
      // 保存完立刻回读 AGENTS.md，确认真的写进去了再提示成功
      const check = await window.codex.verifyPersonalization().catch(() => null);
      if (check) setVerify(check);
      if (!check?.exists) onNotice("已保存，但引擎主目录还没生成——先去「模型」页配置一个供应商，个性化才会写入");
      else if (check.inSync) onNotice(next.nickname || next.customInstructions ? "个性化已写入 AGENTS.md 并重启引擎，下次对话生效" : "已清空个性化设置，AGENTS.md 已同步移除");
      else onNotice("已保存，但引擎的 AGENTS.md 还没对上——点「重新校验」确认，或重启应用");
    } catch (error: any) {
      onNotice(`保存个性化失败：${error?.message ?? error}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section stack personalization-page">
      <div className="settings-copy">
        <h2>个性化</h2>
        <p>决定 Codex 怎么称呼你、用什么语气说话、以及永远要遵守的约定。保存后写入引擎指令并自动重启，下一次对话生效。</p>
      </div>

      <div className="settings-subhead"><UserRound size={13} />称呼<span className="settings-subhead-hint">留空则不指定</span></div>
      <div className="personalization-field">
        <input
          value={nickname}
          maxLength={60}
          placeholder="例如：老王 / Alice / 老板"
          onChange={(event) => setNickname(event.target.value)}
        />
        <span className="personalization-field-hint">{nickname.trim() ? `Codex 会称呼你「${nickname.trim()}」` : "未设置称呼"}</span>
      </div>

      <div className="settings-subhead"><MessageSquare size={13} />回复风格<span className="settings-subhead-hint">原输入框里的「务实」入口已移到这里</span></div>
      <div className="personalization-style-grid" role="group" aria-label="回复风格">
        {stylePresets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={`personalization-style-card ${personality === preset.value ? "active" : ""}`}
            aria-pressed={personality === preset.value}
            onClick={() => onPersonalityChange(preset.value)}
          >
            <span className="personalization-style-head">
              <strong>{preset.title}</strong>
              {personality === preset.value ? <em><Check size={11} /></em> : null}
            </span>
            <span className="personalization-style-desc">{preset.desc}</span>
            <span className="personalization-style-sample">{preset.sample}</span>
          </button>
        ))}
      </div>

      <div className="settings-subhead"><Wrench size={13} />自定义指令<span className="settings-subhead-hint">每次对话都生效，优先级高于风格默认</span></div>
      <textarea
        className="personalization-instructions"
        value={instructions}
        spellCheck={false}
        maxLength={8000}
        placeholder={"例如：\n· 回复一律用简体中文，代码注释用中文\n· 修改前先说明影响范围，再动手\n· 不要自动执行 git push"}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <div className="personalization-actions">
        <span className="personalization-counter">{instructions.length} / 8000</span>
        <button type="button" className="primary-setting" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <span className="spinner" aria-hidden /> : <Check size={14} />}保存并重启引擎
        </button>
      </div>

      <div className={`personalization-verify ${verify ? (verify.inSync ? "ok" : "warn") : ""}`}>
        {verifying ? <RefreshCw size={14} className="spin" />
          : verify?.inSync ? <ShieldCheck size={14} />
          : <TriangleAlert size={14} />}
        <div className="personalization-verify-body">
          <strong>
            {!verify ? "引擎指令校验中…"
              : !verify.exists ? "引擎主目录还没生成"
              : !verify.expects ? (verify.applied ? "AGENTS.md 里仍有旧内容，点保存清掉" : "未设置个性化，引擎只有基础工程指令")
              : verify.applied ? "已确认写入 AGENTS.md，Codex 每次对话都会读到"
              : "还没写进 AGENTS.md，点「保存并重启引擎」"}
          </strong>
          {verify?.exists && verify.applied ? <pre className="personalization-verify-preview">{verify.preview}</pre> : null}
          {verify ? <span className="personalization-verify-path">{verify.agentsPath}</span> : null}
        </div>
        <button type="button" className="secondary-setting" disabled={verifying} onClick={() => void runVerify()}>
          <RefreshCw size={13} />重新校验
        </button>
      </div>

      <div className="personalization-note">
        <Info size={14} />
        <div>
          <strong>这些内容怎么生效</strong>
          <p>称呼与自定义指令写入 Codex 原生的 <code>AGENTS.md</code>（引擎主目录），每个会话开始时引擎自动把它们注入对话——和你在项目仓库里放的 <code>AGENTS.md</code> 是同一条原生指令链，项目级约定会自动叠加在上面。纯 Markdown 落盘，随便写路径和引号都不会破坏配置。回复风格走 <code>thread/start</code> 的 personality，切换后下一个回合生效。上面的校验条是回读真实文件得出的，不是「保存成功」的乐观提示。</p>
        </div>
      </div>

      {loaded && (config.nickname || config.customInstructions) ? (
        <p className="settings-status">当前已保存：{config.nickname ? `称呼「${config.nickname}」` : "无称呼"}{config.customInstructions ? " · 有自定义指令" : " · 无自定义指令"}</p>
      ) : null}
    </section>
  );
}
