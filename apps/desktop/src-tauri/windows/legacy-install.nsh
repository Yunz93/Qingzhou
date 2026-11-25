!define QINGZHOU_LEGACY_GUID "b217ef67-1b56-53a8-ae48-833d59642d92"
!define QINGZHOU_LEGACY_INSTALL "Software\${QINGZHOU_LEGACY_GUID}"
!define QINGZHOU_LEGACY_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\${QINGZHOU_LEGACY_GUID}"
Var QingzhouLegacyRoot

!macro NSIS_HOOK_PREINSTALL
  ; The previous in-app updater invokes this installer silently, then reopens the same executable.
  ${If} ${Silent}
    ReadRegStr $QingzhouLegacyRoot HKCU "${QINGZHOU_LEGACY_INSTALL}" "InstallLocation"
    ${If} $QingzhouLegacyRoot == ""
      StrCpy $QingzhouLegacyRoot "$LOCALAPPDATA\Programs\Qingzhou"
    ${EndIf}
    ${If} ${FileExists} "$QingzhouLegacyRoot\Qingzhou.exe"
    ${AndIf} ${FileExists} "$QingzhouLegacyRoot\resources\app.asar"
      StrCpy $INSTDIR "$QingzhouLegacyRoot"
      SetOutPath "$INSTDIR"
    ${Else}
      StrCpy $QingzhouLegacyRoot ""
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $QingzhouLegacyRoot != ""
  ${AndIf} $QingzhouLegacyRoot == $INSTDIR
    ; Application data lives outside the install directory. Remove only old runtime assets.
    Delete /REBOOTOK "$INSTDIR\resources\app.asar"
    Delete /REBOOTOK "$INSTDIR\resources\approval.ts"
    RMDir /r /REBOOTOK "$INSTDIR\resources\app.asar.unpacked"
    RMDir /r /REBOOTOK "$INSTDIR\resources\pi"
    RMDir /r /REBOOTOK "$INSTDIR\resources\tools"
    RMDir /r /REBOOTOK "$INSTDIR\resources\web"
    RMDir "$INSTDIR\resources"
    RMDir /r /REBOOTOK "$INSTDIR\locales"
    Delete /REBOOTOK "$INSTDIR\chrome_100_percent.pak"
    Delete /REBOOTOK "$INSTDIR\chrome_200_percent.pak"
    Delete /REBOOTOK "$INSTDIR\d3dcompiler_47.dll"
    Delete /REBOOTOK "$INSTDIR\dxcompiler.dll"
    Delete /REBOOTOK "$INSTDIR\dxil.dll"
    Delete /REBOOTOK "$INSTDIR\ffmpeg.dll"
    Delete /REBOOTOK "$INSTDIR\icudtl.dat"
    Delete /REBOOTOK "$INSTDIR\libEGL.dll"
    Delete /REBOOTOK "$INSTDIR\libGLESv2.dll"
    Delete /REBOOTOK "$INSTDIR\resources.pak"
    Delete /REBOOTOK "$INSTDIR\snapshot_blob.bin"
    Delete /REBOOTOK "$INSTDIR\v8_context_snapshot.bin"
    Delete /REBOOTOK "$INSTDIR\vk_swiftshader.dll"
    Delete /REBOOTOK "$INSTDIR\vk_swiftshader_icd.json"
    Delete /REBOOTOK "$INSTDIR\vulkan-1.dll"
    Delete /REBOOTOK "$INSTDIR\Uninstall Qingzhou.exe"
    DeleteRegKey HKCU "${QINGZHOU_LEGACY_UNINSTALL}"
  ${EndIf}
!macroend
