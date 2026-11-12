import { Card, CardHeader, CardSection, Checkbox, Field, HotkeyInput, Page, PRICE_MODES, Select, Switch, type PriceMode } from "@/design-system";
import { usePriceMode } from "@/app/price-mode";
import { useShell } from "@/app/store";
import { AccountCard } from "./AccountCard";
import { UpdatesCard } from "./UpdatesCard";

/**
 * Настройки. Только то, что уже работает; новые разделы добавляются вместе с функциями.
 */
export function SettingsPage() {
  const s = useShell();
  const priceMode = usePriceMode((p) => p.mode);
  const setPriceMode = usePriceMode((p) => p.setMode);

  return (
    <Page title="Настройки" subtitle="Сохраняются автоматически">
      <div className="grid min-h-0 grid-cols-2 items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
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

          <UpdatesCard />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AccountCard />

          <Card>
            <CardHeader title="Интерфейс" />
            <CardSection className="flex flex-col gap-4">
              <Field label="Валюта цен" hint="То же, что выбор рядом с лигой в шапке; действует и в оверлее">
                {({ id }) => (
                  <Select
                    id={id}
                    value={priceMode}
                    onValueChange={(v) => setPriceMode(v as PriceMode)}
                    options={(Object.keys(PRICE_MODES) as PriceMode[]).map((m) => ({ value: m, label: PRICE_MODES[m].label, hint: PRICE_MODES[m].hint }))}
                    className="w-60"
                  />
                )}
              </Field>
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
