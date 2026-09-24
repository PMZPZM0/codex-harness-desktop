/**
 * 设置页 · ssh（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Copy, Download, KeyRound, PenLine, Play, Plus, PowerOff, Search, Server, Star, TerminalSquare, Trash2, Upload, Wifi } from "lucide-react";
import { BatchActions, CheckCard, SearchField, SegmentedTabs, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { Spinner } from "../../components/CardShell";

export type SshSettingsSectionProps = { setSshEditorTest: any; setSshDraft: any; emptySshDraft: any; sshQuery: any; setSshQuery: any; sshFilter: any; setSshFilter: any; sshServers: any; exportSshEntries: any; sshBatchBusy: any; importSshEntries: any; sshVisible: any; sshChecked: any; setSshChecked: any; toggleSshBatch: any; testSshBatch: any; removeSshEntries: any; sshBusyId: any; sshTestingId: any; sshCheckedSet: any; sshToggleChecked: any; toggleSshFavorite: any; toggleSshEntry: any; setSshTerminal: any; testSshEntry: any; setSshExecTarget: any; duplicateSshEntry: any };

export function SshSettingsSection(props: SshSettingsSectionProps) {
  const { setSshEditorTest, setSshDraft, emptySshDraft, sshQuery, setSshQuery, sshFilter, setSshFilter, sshServers, exportSshEntries, sshBatchBusy, importSshEntries, sshVisible, sshChecked, setSshChecked, toggleSshBatch, testSshBatch, removeSshEntries, sshBusyId, sshTestingId, sshCheckedSet, sshToggleChecked, toggleSshFavorite, toggleSshEntry, setSshTerminal, testSshEntry, setSshExecTarget, duplicateSshEntry } = props;
  return (
    <>
      <section className="settings-section stack ssh-page">
                    <div className="settings-copy channel-heading">
                      <div>
                        <h2>SSH 服务器<PageInfo text={<>集中管理远程主机：保存连接与凭据，分组打标签，配置跳板机与登录后命令；可逐台或批量启用/停用、测试连通性、直接开终端或下发一次性命令。凭据仅保存在本机配置目录（ssh-servers.json）。</>} /></h2>
                      </div>
                      <div className="settings-heading-actions">
                        <button className="primary-setting" onClick={() => { setSshEditorTest(null); setSshDraft(emptySshDraft()); }}><Plus size={14} />新建连接</button>
                      </div>
                    </div>
                    <div className="ssh-toolbar">
                      <SearchField value={sshQuery} onChange={setSshQuery} placeholder="搜索名称 / 主机 / 标签 / 备注" width={240} />
                      <SegmentedTabs
                        value={sshFilter}
                        onChange={(value) => setSshFilter(value as "all" | "on" | "off" | "star")}
                        options={[
                          { value: "all", label: "全部", count: sshServers.length },
                          { value: "on", label: "已启用", count: sshServers.filter((server: any) => server.enabled).length },
                          { value: "off", label: "已停用", count: sshServers.filter((server: any) => !server.enabled).length },
                          { value: "star", label: "收藏", count: sshServers.filter((server: any) => server.favorite).length },
                        ]}
                      />
                      <span className="ssh-toolbar-spacer" />
                      <button className="secondary-setting" title="导出为 JSON（不含密码与私钥）" disabled={!sshServers.length} onClick={() => void exportSshEntries(false)}><Download size={14} />导出</button>
                      <button className="secondary-setting" title="从 JSON 文件导入连接" disabled={sshBatchBusy} onClick={() => void importSshEntries()}><Upload size={14} />导入</button>
                    </div>
                    {sshServers.length > 0 && <div className="ssh-bulk-bar">
                      <SelectAllToggle
                        total={sshVisible.length}
                        selected={sshChecked.filter((id: any) => sshVisible.some((server: any) => server.id === id)).length}
                        unit="台"
                        onSelectAll={() => setSshChecked(sshVisible.map((server: any) => server.id))}
                        onClear={() => setSshChecked([])}
                      />
                      <BatchActions
                        hint={sshChecked.length ? `已选 ${sshChecked.length} 台` : "勾选卡片后可批量操作"}
                        actions={[
                          { label: "批量启用", icon: <Play size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void toggleSshBatch(true) },
                          { label: "批量停用", icon: <PowerOff size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void toggleSshBatch(false) },
                          { label: "测试连通", icon: <Wifi size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void testSshBatch() },
                          { label: "导出所选", icon: <Download size={13} />, disabled: !sshChecked.length, title: "含凭据导出，便于迁移到另一台机器", onClick: () => void exportSshEntries(true) },
                          { label: "删除", icon: <Trash2 size={13} />, tone: "danger", disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void removeSshEntries(sshChecked) },
                        ]}
                      />
                    </div>}
                    <div className="ssh-server-list">
                      {sshVisible.map((server: any) => {
                        const busy = sshBusyId === server.id || sshTestingId === server.id;
                        const checked = sshCheckedSet.has(server.id);
                        const info = server.lastServerInfo;
                        const lastTest = server.lastTestAt ? new Date(server.lastTestAt).toLocaleString() : "";
                        const systemLabel = [info?.os, info?.uname].filter(Boolean).join(" · ");
                        return <article className={`ssh-server-card ${server.enabled ? "" : "is-off"} ${checked ? "is-checked" : ""}`} key={server.id}>
                          <div className="ssh-server-head">
                            <CheckCard checked={checked} label={`选择 ${server.name}`} title={checked ? `取消选择 ${server.name}` : `勾选 ${server.name}，纳入批量操作`} onChange={() => sshToggleChecked(server.id)} />
                            <span className={`ssh-status-dot ${server.lastTestOk === undefined ? "unknown" : server.lastTestOk ? "ok" : "fail"} ${sshTestingId === server.id ? "testing" : ""}`} title={server.lastTestOk === undefined ? "未测试" : server.lastTestOk ? "最近一次测试连通" : "最近一次测试失败"} />
                            <div className="ssh-server-title">
                              <strong>{server.name}</strong>
                              <small><code>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""}</code></small>
                            </div>
                            {server.group ? <span className="ssh-tag ssh-tag-group">{server.group}</span> : null}
                            {(server.tags ?? []).slice(0, 3).map((tag: any) => <span className="ssh-tag" key={tag}>{tag}</span>)}
                            <button className={`ssh-star ${server.favorite ? "on" : ""}`} title={server.favorite ? "取消收藏" : "收藏到顶部筛选"} onClick={() => void toggleSshFavorite(server)}><Star size={13} /></button>
                            <span className={`ssh-auth-badge ${server.authType}`}><KeyRound size={12} />{server.authType === "password" ? "密码" : "私钥"}</span>
                            <ToggleSwitch checked={server.enabled} disabled={busy} label={`${server.name} 启用开关`} title={server.enabled ? "停用后不参与自动连接，配置保留" : "启用这台服务器"} onChange={(next) => void toggleSshEntry(server, next)} />
                          </div>
                          <div className="ssh-server-meta">
                            {lastTest
                              ? <span className={`ssh-test-result ${server.lastTestOk ? "ok" : "fail"}`}>
                                  {server.lastTestOk
                                    ? `连通 · ${server.lastTestLatencyMs ?? "?"}ms · ${lastTest}`
                                    : `失败 · ${server.lastTestError || "未知错误"} · ${lastTest}`}
                                </span>
                              : <span className="ssh-test-result">尚未测试</span>}
                            {server.lastTestOk && systemLabel ? <span title={`${info?.hostname ? `主机名 ${info.hostname}` : ""}${info?.uptime ? ` · 已运行 ${info.uptime}` : ""}`}>{systemLabel}</span> : null}
                            {server.lastFingerprint ? <span className="ssh-fingerprint" title={`主机密钥指纹 ${server.lastFingerprint}`}>指纹 {server.lastFingerprint.replace(/^SHA256:/, "").slice(0, 12)}…</span> : null}
                            {server.jumpHost?.host ? <span className="ssh-tag ssh-tag-jump">跳板机 {server.jumpHost.host}</span> : null}
                            {server.remotePath ? <span>初始目录 {server.remotePath}</span> : null}
                            {server.notes ? <span className="ssh-notes" title={server.notes}>{server.notes}</span> : null}
                          </div>
                          <div className="ssh-server-actions">
                            <button className="secondary-setting" disabled={busy} onClick={() => setSshTerminal(server)}><TerminalSquare size={14} />打开终端</button>
                            <button className="secondary-setting" disabled={busy} onClick={() => void testSshEntry(server)}>{sshTestingId === server.id ? <Spinner /> : <Wifi size={14} />}测试连接</button>
                            <button className="secondary-setting" disabled={busy} onClick={() => setSshExecTarget(server)}><Play size={14} />运行命令</button>
                            <span className="ssh-actions-spacer" />
                            <button className="secondary-setting" disabled={busy} onClick={() => { setSshEditorTest(null); setSshDraft({ ...server }); }}><PenLine size={14} />编辑</button>
                            <button className="secondary-setting" disabled={busy} onClick={() => void duplicateSshEntry(server)}><Copy size={14} />复制</button>
                            <button className="secondary-setting ssh-delete" disabled={busy} onClick={() => void removeSshEntries([server.id])}><Trash2 size={14} />删除</button>
                          </div>
                        </article>;
                      })}
                      {!sshServers.length && <div className="ssh-server-empty">
                        <Server size={28} />
                        <strong>还没有 SSH 服务器</strong>
                        <p>新建连接并填入主机、用户名与认证方式，保存后即可启用/停用、测试连通性，或直接打开终端与下发命令。</p>
                        {/* 顶部工具栏的「+ 新建连接」是主入口；空状态这里只给提示文字，避免两个新建按钮让用户疑惑 */}
                      </div>}
                      {sshServers.length > 0 && !sshVisible.length && <div className="ssh-server-empty ssh-empty-filter">
                        <Search size={24} />
                        <strong>没有匹配的连接</strong>
                        <p>换个关键字，或把筛选切换回「全部」。</p>
                      </div>}
                    </div>
                  </section>
    </>
  );
}
