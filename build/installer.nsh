; Codex Harness Desktop 自定义 NSIS 安装钩子
; 覆盖安装时先清掉旧版自动化工具目录：0.0.4 及更早版本的 npm-global 只有空壳
; （node_modules 被 electron-builder 硬排除），直接覆盖安装会残留旧结构导致
; 新包的 node_modules 与旧 shim 混装。安装前整目录重置，保证与包内容一致。

; ${GetParameters} / ${GetOptions}（customInit 里识别应用内更新的 --updated 参数）。
; 模板本身经 multiUser.nsh 已 include 过 FileFunc，这里显式写一次消除宏展开顺序依赖
; （FileFunc.nsh 自带 include guard，重复引入无副作用）。
!include "FileFunc.nsh"

; ⛔⛔ preInit（早于模板的 ALLOW_ONLY_ONE_INSTALLER_INSTANCE 运行中检查 —— 用户实测：
;   覆盖安装时弹「Codex Harness Desktop 无法关闭，请手动关闭它，然后单击重试以继续」，
;   重启电脑后仍复现。两个成因都被这行覆盖：
;   ① 托盘应用「关闭窗口=最小化到托盘」把 AppAlive 的 WM_CLOSE 吞了；
;   ② 解包阶段文件被占（AppAlive 的 kill 只在进程名匹配得上时生效）。
;   按进程名强杀（含 /T 子进程树：宠物浮窗/远程服务/协议桥同树）；没在跑时 taskkill 报错无妨。
;   ⚠️ 若应用是**以管理员权限**跑的，非提权安装器仍杀不动 → 右键「以管理员身份运行」安装器。
!macro preInit
  DetailPrint "正在关闭已运行的 Codex Harness Desktop…"
  ; 11-20 用户实测「点重启 → 安装窗刚出来就闪退 → 再也没装上」：
  ;   一次 taskkill + 800ms 不够 —— 主进程被 /F 杀掉后，引擎子进程树（codex / 语音 worker /
  ;   远程隧道）退出要几百毫秒，文件仍被占用，覆盖安装直接失败（安装器静默退出，用户只看到闪退）。
  ;   ⇒ 连杀两次、中间留出树退出的时间，再等 1.2s 才进解包阶段。
  nsExec::ExecToStack 'taskkill /F /T /IM "Codex Harness Desktop.exe"'
  Pop $0
  Pop $1
  Sleep 400
  nsExec::ExecToStack 'taskkill /F /T /IM "Codex Harness Desktop.exe"'
  Pop $0
  Pop $1
  Sleep 1200
!macroend

!macro customInit
  ; 11-16 oneClick 迁移保护：旧版是 assisted 安装，可能选过「所有用户」（HKLM）。
  ; oneClick 默认按当前用户装到 %LOCALAPPDATA%\Programs；若直接装，会和旧的全机安装
  ; 并存成两份（桌面两个图标、更新后打开的还是旧版）。
  ;   · 管理员运行 ⇒ 原地覆盖旧的全机目录；
  ;   · 非管理员 ⇒ 明确提示先卸载旧版（不静默装第二份）。
  ;
  ; ⛔⛔ 11-20 用户实测「点重启就闪退、再无法更新」的第二个阻塞点就在这里：
  ;   更新器发起的覆盖安装是**静默**的（--updated /S），没人看得见 MessageBox；
  ;   而这里 MessageBox 之后直接 Quit ⇒ 安装器自己退出、版本没变，用户只看到应用闪退，
  ;   下次启动还会被判成「上次安装失败」。⇒ 静默模式下**不许拦路**，改为继续装到用户目录
  ;   （宁可有旧版残留，也不能让更新整块失败）；交互式安装仍保留提示 + 退出。
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    ${If} ${UAC_IsAdmin}
      StrCpy $INSTDIR $0
    ${Else}
      ; ⛔⛔ 11-21 闭环修复：判据不能只看 ${Silent}。
      ;   oneClick 安装器为了显示进度页是**非静默**的（installSection.nsh 的 `${IfNot} ${Silent}`），
      ;   而应用内更新 spawn 安装器时不带 /S ⇒ 从这里点「安装」时 ${Silent} 恒假 ⇒ 只要机器上
      ;   留着旧版的全机安装（11-16 之前是 assisted 安装，用户可能选过「所有用户」），就会弹
      ;   「请先卸载旧版」并 Quit —— 用户看到的就是「点了安装没反应 / 闪退，版本没变」。
      ;   ⇒ 应用内更新发起时命令行带 `--updated`（update-service 的 spawn），用它识别更新路径，
      ;     与静默安装同等放行（装到当前用户目录，宁可留旧版也不能让更新整块失败）。
      ${GetParameters} $R9
      ${GetOptions} $R9 "--updated" $R8
      ${If} ${Silent}
        DetailPrint "静默更新：检测到旧版为全机安装（$0），本次按当前用户安装"
      ${Else}
        ${IfNot} ${Errors}
          DetailPrint "应用内更新：检测到旧版为全机安装（$0），本次按当前用户安装"
        ${Else}
          MessageBox MB_ICONEXCLAMATION|MB_OK "检测到旧版是按「所有用户」安装的：$0$\r$\n请先卸载旧版，或以管理员身份运行本次安装，避免出现两份安装。"
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; 安装前清理旧版工具残留（只动安装目录内 harness 自己管理的 tools 子目录，
  ; 不碰用户数据：userData 在 %APPDATA%\Codex Harness Desktop，与安装目录无关）
  DetailPrint "清理旧版内置工具目录…"
  RMDir /r "$INSTDIR\resources\tools\npm-global"
  RMDir /r "$INSTDIR\resources\tools\pw-browsers"
  RMDir /r "$INSTDIR\resources\tools\cloak-cache"
!macroend

!macro customInstall
  ; 09-24 更正：自 09-16 起 cloakbrowser 与 Chromium/Playwright 内核都是**首次使用时按需下载**，
  ; 只有 nuphus 与 playwright-cli 随包。旧文案声称四者全部随包，会让人以为装完就能离线用。
  DetailPrint "内置工具：nuphus / playwright-cli 已随包；cloakbrowser 与浏览器内核在首次使用时按需下载"
!macroend