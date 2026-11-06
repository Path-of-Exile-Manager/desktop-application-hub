; Хуки установщика NSIS (tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; Связь с расширением браузера: приложение при каждом запуске регистрирует хост Native Messaging
; (crates/browser-bridge/src/register.rs). При удалении убираем ключ Chrome и манифест хоста,
; иначе Chrome будет пытаться запустить уже удалённый exe.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.poemanager.bridge"
  RMDir /r "$LOCALAPPDATA\com.poemanager.desktop\native-messaging"
!macroend
