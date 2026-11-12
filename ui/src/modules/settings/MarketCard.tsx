import { Card, CardHeader, CardSection, Field, Slider, Switch } from "@/design-system";
import { useMarket } from "@/app/market";
import { useShell } from "@/app/store";
import type { MarketStatus } from "@/generated/MarketStatus";

// Настройки → «Помощь в оценке билдов» (shared/docs/build-price-tracking.md, T6): переключатель,
// бюджет поисков в час и что искатель делает сейчас.

const time = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function describe(status: MarketStatus): string {
  switch (status.state) {
    case "disabled":
      return "Выключено";
    case "signedOut":
      return "Нужен вход в аккаунт";
    case "notAllowed":
      return "У аккаунта нет права отслеживать цены билдов";
    case "idle":
      return "Ждёт заданий";
    case "searching":
      return "Ищет на сайте торговли";
    case "paused":
      return status.pausedUntil ? `Пауза до ${time(status.pausedUntil)} — лимит сайта торговли` : "Пауза — лимит сайта торговли";
    case "offline":
      return "Нет связи с сервером";
  }
}

/** Видна только тем, у кого есть право `builds.track`. */
export function MarketCard() {
  const status = useMarket((m) => m.status);
  const enabled = useShell((s) => s.marketHelp);
  const budget = useShell((s) => s.marketBudget);
  const setEnabled = useShell((s) => s.setMarketHelp);
  const setBudget = useShell((s) => s.setMarketBudget);
  if (status?.allowed !== true) return null;

  return (
    <Card>
      <CardHeader title="Помощь в оценке билдов" aside={<Switch aria-label="Помогать оценивать билды" checked={enabled} onCheckedChange={setEnabled} />} />
      <CardSection className="flex flex-col gap-4">
        <p className="text-label text-text-secondary">
          Приложение в фоне ищет на сайте торговли вещи отслеживаемых билдов — ваших и друзей — с вашего адреса, без входа на сайт, и отправляет цены на сервер.
          Ваши собственные поиски в браузере всегда в приоритете: если сайт близок к лимиту, приложение ждёт.
        </p>
        <Field label="Поисков в час" hint="Лимит сайта — около 100 в час на адрес, вместе с вашими поисками">
          {() => <Slider aria-label="Поисков в час" min={0} max={60} step={5} value={budget} onValueChange={setBudget} disabled={!enabled} />}
        </Field>
        <p className="text-label text-text-secondary">
          {describe(status)} · за час {status.searchesLastHour}, за сутки {status.searchesToday}
          {status.lastError && <span className="block text-status-warning-fg">{status.lastError}</span>}
        </p>
      </CardSection>
    </Card>
  );
}