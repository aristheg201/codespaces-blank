!include "LogicLib.nsh"

!macro customInstallmode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Bạn có muốn xóa toàn bộ dữ liệu game Bestiary đã tải về (mods, config, resourcepacks, Java runtime và cài đặt launcher) không?$\r$\n$\r$\nChọn No để giữ dữ liệu cho lần cài đặt sau." \
      IDNO keep_bestiary_data

    DetailPrint "Đang xóa dữ liệu game Bestiary..."
    RMDir /r "$LOCALAPPDATA\BestiaryLauncher"
    RMDir /r "$APPDATA\BestiaryLauncher"

    keep_bestiary_data:
  ${EndIf}
!macroend
