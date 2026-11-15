import { Card, CardHeader, CardSection, Field, Slider, Switch } from "@/design-system";
import { useMarket } from "@/app/market";
import { useShell } from "@/app/store";
import type { MarketStatus } from "@/generated/MarketStatus";

// Настройки → «Помощь в оценке цен» (shared/docs/build-price-tracking.md, T6;
// shared/docs/cluster-crafting.md, C8): переключатель, бюджет поисков в час и что искатель делает сейчас.

const time = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function describe(status: MarketStatus): string {
  switch (status.state) {
    case "disabled":
      return "Выключено";
    case "signedOut":
      return "Нужен вход в аккаунт";
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

/** Видна всем вошедшим: задания пула выдаются любому аккаунту. */
export function MarketCard() {
  const status = useMarket((m) => m.status);
  const enabled = useShell((s) => s.marketHelp);
  const budget = useShell((s) => s.marketBudget);
  const setEnabled = useShell((s) => s.setMarketHelp);
  const setBudget = useShell((s) => s.setMarketBudget);
  if (!status || status.state === "signedOut") return null;

  return (
    <Card>
      <CardHeader title="Помощь в оценке цен" aside={<Switch aria-label="Помогать оценивать цены" checked={enabled} onCheckedChange={setEnabled} />} />
      <CardSection className="flex flex-col gap-4">
        <p className="text-label text-text-secondary">
          Приложение в фоне ищет на сайте торговли вещи отслеживаемых билдов и кластерные самоцветы для «Выгодных кластеров» — с вашего адреса, без входа на сайт, — и
          отправляет цены на сервер. Ваши собственные поиски в браузере всегда в приоритете: если сайт близок к лимиту, приложение ждёт.
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