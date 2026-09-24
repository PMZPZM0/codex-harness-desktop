/**
 * 设置页 · archive（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */

export type ArchiveSettingsSectionProps = { ArchivePage: any; setNotice: any; setSettingsOpen: any; openThread: any; openAppConfirm: any; refreshThreads: any };

export function ArchiveSettingsSection(props: ArchiveSettingsSectionProps) {
  const { ArchivePage, setNotice, setSettingsOpen, openThread, openAppConfirm, refreshThreads } = props;
  return (
    <>
      <ArchivePage
                    onNotice={setNotice}
                    onOpenThread={(id: any) => { setSettingsOpen(false); void openThread(id); }}
                    onConfirm={openAppConfirm}
                    onThreadRestored={(id: any) => {
                      setSettingsOpen(false);
                      // 先刷新列表再打开：恢复的会话此刻还不在 threads 里，直接 openThread 时
                      // resume 失败的兜底（threads.find）会找不到条目 → 空白会话
                      void (async () => {
                        await refreshThreads().catch(() => undefined);
                        await openThread(id);
                      })();
                    }}
                  />
    </>
  );
}
