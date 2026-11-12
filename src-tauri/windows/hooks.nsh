; Хуки установщика NSIS (tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; Связь с расширением браузера: приложение при каждом запуске регистрирует хост Native Messaging
; (crates/browser-bridge/src/register.rs). При удалении убираем ключ Chrome и манифест хоста,
; иначе Chrome будет пытаться запустить уже удалённый exe.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.poemanager.bridge"
  RMDir /r "$LOCALAPPDATA\com.poemanager.desktop\native-messaging"
!macroend

; Обновление и переустановка: Chrome держит наш exe запущенным как мост (режим ретранслятора) и через ~10 с после
; разрыва запускает его снова. Установщик Tauri закрывает процессы приложения при старте, но мост может успеть
; вернуться до копирования файлов — тогда запись exe падает с «Error opening file for writing».
; Поэтому перед самым копированием ещё раз завершаем все экземпляры (само приложение к этому моменту уже закрыто).
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 300
!macroend