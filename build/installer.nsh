; Codex Harness Desktop 自定义 NSIS 安装钩子
; 覆盖安装时先清掉旧版自动化工具目录：0.0.4 及更早版本的 npm-global 只有空壳
; （node_modules 被 electron-builder 硬排除），直接覆盖安装会残留旧结构导致
; 新包的 node_modules 与旧 shim 混装。安装前整目录重置，保证与包内容一致。

!macro customInit
  ; 安装前清理旧版工具残留（只动安装目录内 harness 自己管理的 tools 子目录，
  ; 不碰用户数据：userData 在 %APPDATA%\Codex Harness Desktop，与安装目录无关）
  DetailPrint "清理旧版内置工具目录…"
  RMDir /r "$INSTDIR\resources\tools\npm-global"
  RMDir /r "$INSTDIR\resources\tools\pw-browsers"
  RMDir /r "$INSTDIR\resources\tools\cloak-cache"
!macroend

!macro customInstall
  DetailPrint "内置工具已随包安装（nuphus / playwright-cli / cloakbrowser / Chromium 内核）"
!macroend
