import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, MessageSquare, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { SettingsPageHero } from "./SettingsPageHero";

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
  /* 10-27 用户令：「四个正方形卡片太丑了，Codex 回复风格尾部选项里面加上这四个选项，不需要过多文字赘述」
     ⇒ 大卡片整块去掉，改成标题行右侧的胶囊分段控件；说明只留在 title 悬停里，界面上只有档位名。 */
  { value: "inquiry", title: "需求询问", desc: "动手前先按 grill-me 技能问清目标 / 边界 / 验收，问完再做" },
  { value: "challenge", title: "敢于反驳", desc: "按 challenge-requirements 技能审需求：有错先指出并给依据与更优方案；你坚持就照做并写清风险" },
  { value: "pragmatic", title: "务实", desc: "直接给结论和代码，少铺垫" },
  { value: "friendly", title: "友好", desc: "解释更详细，主动交代思路与取舍" },
  { value: "none", title: "默认", desc: "跟随模型默认风格，不额外注入语气指令" },
];

/**
 * 个性化设置页：回复风格 + 自定义指令。
 * 自定义指令写到 Codex 原生的 $CODEX_HOME/AGENTS.md，引擎每个会话开始时自动注入
 * （user 级指令层），并与项目仓库里的 AGENTS.md 分层合并；保存后自动重启引擎。
 *
 * 10-27 用户令：「个性化里面的用户称呼可以删了，还有语气自适应也删了，跟用户中心和控制台的ahd重复了」——
 * 称呼已并入「用户中心 → 基本资料」，语气自适应的开关挪到「控制台 → 回复风格」，本页不再重复。
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
        setInstructions(next.customInstructions ?? "");
        initial.current = next;
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoaded(true); });
    void runVerify();
    return () => { alive = false; };
  }, [runVerify]);

  const dirty = instructions.trim() !== (initial.current.customInstructions ?? "");

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      /* ⛔ 只传 customInstructions：昵称改到「用户中心」后这里就**不碰** nickname 了。
         writePersonalization 是 partial 语义（字段 undefined = 保留原值），
         所以昵称不会被这页保存误清掉。 */
      const next = await window.codex.savePersonalization({ customInstructions: instructions.trim() });
      setConfig(next);
      initial.current = next;
      // 保存完立刻回读 AGENTS.md，确认真的写进去了再提示成功
      const check = await window.codex.verifyPersonalization().catch(() => null);
      if (check) setVerify(check);
      if (!check?.exists) onNotice("已保存，但引擎主目录还没生成——先去「模型」页配置一个供应商，个性化才会写入");
      else if (check.inSync) onNotice(next.customInstructions ? "个性化已写入 AGENTS.md 并重启引擎，下次对话生效" : "已清空个性化设置，AGENTS.md 已同步移除");
      else onNotice("已保存，但引擎的 AGENTS.md 还没对上——点「重新校验」确认，或重启应用");
    } catch (error: any) {
      onNotice(`保存个性化失败：${error?.message ?? error}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section stack personalization-page settings-exp-page">
      <SettingsPageHero icon={<Sparkles size={20} />} title="个性化" subtitle="回复风格与自定义指令：让 Codex 用你顺手的写法说话，并永远遵守你的约定。" hint="改完下一次对话生效" />

      {/* 分组规则（10-11 重排）：一处设置 = 一张组卡；组卡自带标题行（.settings-subhead）与 1px 边界，
          组间只用一个间距值 ⇒ 不再靠标题的零散 margin 撑版式。 */}

      <div className="personalization-group card-style">
        <div className="settings-subhead">
          <MessageSquare size={13} />回复风格
          <div className="segmented-tabs personalization-style-tabs" role="group" aria-label="回复风格">
            {stylePresets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={personality === preset.value ? "active" : ""}
                aria-pressed={personality === preset.value}
                title={preset.desc}
                onClick={() => onPersonalityChange(preset.value)}
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="personalization-group card-instructions">
        <div className="settings-subhead"><Wrench size={13} />自定义指令<span className="settings-subhead-hint">每次对话都生效，优先级高于风格默认</span></div>
        <textarea
          className="personalization-instructions"
          value={instructions}
          spellCheck={false}
          maxLength={8000}
          aria-label="自定义指令"
          placeholder={"例如：\n· 回复一律用简体中文，代码注释用中文\n· 修改前先说明影响范围，再动手\n· 不要自动执行 git push"}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <div className="personalization-actions">
          <span className="personalization-counter">{instructions.length} / 8000</span>
          <button type="button" className="primary-setting" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? <span className="spinner" aria-hidden /> : <Check size={14} />}保存并重启引擎
          </button>
        </div>
      </div>

      {/* 校验条独立成块：它汇报的是「自定义指令」的落盘结果，不并入上面任何一组。 */}
      <div className={`personalization-verify ${verify ? (verify.inSync ? "ok" : "warn") : ""}`} role="status">
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
          <p>自定义指令写入 Codex 原生的 <code>AGENTS.md</code>（引擎主目录），每个会话开始时引擎自动把它注入对话——和你在项目仓库里放的 <code>AGENTS.md</code> 是同一条原生指令链，项目级约定会自动叠加在上面。纯 Markdown 落盘，随便写路径和引号都不会破坏配置。回复风格走 <code>thread/start</code> 的 personality，切换后下一个回合生效。上面的校验条是回读真实文件得出的，不是「保存成功」的乐观提示。</p>
        </div>
      </div>

      {loaded && config.customInstructions ? (
        <p className="settings-status">当前已保存自定义指令</p>
      ) : null}
    </section>
  );
}
