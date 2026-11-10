import { Card, CardHeader, CardSection, Checkbox, Field, HotkeyInput, Page, Switch } from "@/design-system";
import { useShell } from "@/app/store";
import { AccountCard } from "./AccountCard";

/**
 * Настройки. Только то, что уже работает; новые разделы добавляются вместе с функциями.
 */
export function SettingsPage() {
  const s = useShell();

  return (
    <Page title="Настройки" subtitle="Сохраняются автоматически">
      <div className="grid min-h-0 grid-cols-2 items-start gap-4">
        <Card>
          <CardHeader title="Горячие клавиши" />
          <CardSection className="flex flex-col gap-4">
            <Field label="Проверить предмет под курсором" hint="Работает, когда игра в фокусе">
              {({ id, describedBy }) => (
                <HotkeyInput id={id} aria-describedby={describedBy} value={s.hotkeys.check} onChange={(k) => s.setHotkey("check", k)} />
              )}
            </Field>
            <Field label="Поиск и команды" hint="Внутри окна приложения">
              {({ id, describedBy }) => (
                <HotkeyInput id={id} aria-describedby={describedBy} value={s.hotkeys.palette} onChange={(k) => s.setHotkey("palette", k)} />
              )}
            </Field>
          </CardSection>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <AccountCard />

          <Card>
            <CardHeader title="Интерфейс" />
            <CardSection>
              <Checkbox checked={s.sidebarCollapsed} onCheckedChange={s.setSidebarCollapsed} label="Узкая боковая панель" />
            </CardSection>
          </Card>

          <Card>
            <CardHeader
              title="Режим разработчика"
              aside={<Switch aria-label="Режим разработчика" checked={s.developerMode} onCheckedChange={s.setDeveloperMode} />}
            />
            <CardSection>
              <p className="text-label text-text-secondary">
                Добавляет в навигацию страницы «Режим разработки» и «Витрина»: адрес сервера, симуляция состояний, сырые данные ядра.
                Пока режим выключен, приложение работает с сервером по умолчанию.
              </p>
            </CardSection>
          </Card>
        </div>
      </div>
    </Page>
  );
}
