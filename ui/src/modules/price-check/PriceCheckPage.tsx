import { useState } from "react";
import { ClipboardPaste, ScanSearch } from "lucide-react";
import { Banner, Button, Card, CardSection, EmptyState, Hotkey, Page, toast } from "@/design-system";
import { useShell } from "@/app/store";
import { inputBlocked, useGameStatus } from "@/app/game";
import { appraiseClipboard, useAppraisal, type Appraisal } from "@/app/appraise";
import { appraisalToItem } from "@/app/item-view";
import { useCurrentLeague } from "@/app/leagues";
import { inTauri } from "@/app/window";
import type { TradeSearchSpec } from "@/components/trade/spec";
import { ItemCard } from "./ItemCard";
import { LotsCard } from "./LotsCard";
import { PriceCard } from "./PriceCard";
import { TradeSearchCard } from "./TradeSearchCard";
import { useLiveSearch } from "./useLiveSearch";
import { WeaponDamageCard } from "./WeaponDamage";

/**
 * Пойманный предмет в три колонки: предмет и поиск на трейде (моды с галочками и MIN/MAX), цена,
 * лоты на рынке по этому поиску. Правки поиска и выдача — для этого предмета; новый предмет
 * начинает с умолчаний ядра.
 */
function CheckedItem({ appraisal }: { appraisal: Appraisal }) {
  const league = useCurrentLeague();
  const defaults = appraisal.tradeSpec;
  const [edited, setEdited] = useState<{ owner: Appraisal; spec: TradeSearchSpec } | null>(null);
  const spec = edited?.owner === appraisal ? edited.spec : defaults;
  const live = useLiveSearch(appraisal);
  const hasFilters = !!spec && spec.mods.length > 0;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,1.15fr)] gap-4">
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        <ItemCard item={appraisalToItem(appraisal)} hideMods={hasFilters} className="shrink-0" />
        {spec && defaults && (
          <TradeSearchCard
            spec={spec}
            defaults={defaults}
            onChange={(next) => setEdited({ owner: appraisal, spec: next })}
            league={league?.id}
            searching={live.loading}
            onSearch={() => league && live.search(spec, league.id)}
            className="min-h-0 flex-1"
          />
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        <PriceCard appraisal={appraisal} />
        <WeaponDamageCard appraisal={appraisal} />
      </div>
      {spec ? (
        <LotsCard live={live} className="min-w-0" />
      ) : (
        <Card className="min-w-0">
          <CardSection>
            <p className="text-body text-text-secondary">Предмета нет в справочнике — искать на трейде нечего.</p>
          </CardSection>
        </Card>
      )}
    </div>
  );
}

/**
 * Модуль Price check (app-shell.md, экран A1): последний оценённый предмет — карточка и цена.
 * Предмет приходит из ядра: горячая клавиша в игре, кнопка «Из буфера обмена» или режим разработки.
 */
export function PriceCheckPage() {
  const hotkeys = useShell((s) => s.hotkeys);
  const { last: appraisal, at } = useAppraisal();
  const game = useGameStatus();
  const caught = at ? new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : null;

  function fromClipboard() {
    appraiseClipboard().catch((e) => toast({ status: "warning", title: "Не удалось оценить", description: String(e) }));
  }

  return (
    <Page
      title="Price check"
      subtitle={appraisal && caught ? `Пойман в ${caught}` : undefined}
      actions={
        <Button icon={ClipboardPaste} onClick={fromClipboard} disabled={!inTauri}>
          Из буфера обмена
        </Button>
      }
    >
      {game?.state === "notRunning" && (
        <Banner status="danger" title="Окно игры не найдено — горячие клавиши сейчас не работают">
          Запустите Path of Exile — приложение найдёт окно само. Предмет можно скопировать в игре (Ctrl+Alt+C) и нажать «Из буфера обмена».
        </Banner>
      )}
      {game?.state === "unsupported" && (
        <Banner status="warning" title="Запущен Path of Exile 2">
          poe-manager работает только с Path of Exile 1.
        </Banner>
      )}
      {game?.state === "running" && inputBlocked(game) && (
        <Banner status="warning" title="Игра запущена от администратора — горячие клавиши не дойдут до неё">
          Запустите игру без прав администратора или poe-manager — от имени администратора.
        </Banner>
      )}

      {appraisal ? (
        <CheckedItem appraisal={appraisal} />
      ) : (
        <EmptyState icon={ScanSearch} title="Предмет ещё не пойман">
          Наведите на предмет в игре и нажмите <Hotkey keys={hotkeys.check} className="align-middle" />
        </EmptyState>
      )}
    </Page>
  );
}
