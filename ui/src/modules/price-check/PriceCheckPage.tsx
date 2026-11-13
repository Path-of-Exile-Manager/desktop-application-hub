import { ClipboardPaste, ScanSearch } from "lucide-react";
import { Banner, Button, EmptyState, Hotkey, Page, toast } from "@/design-system";
import { useShell } from "@/app/store";
import { inputBlocked, useGameStatus } from "@/app/game";
import { appraiseClipboard, useAppraisal } from "@/app/appraise";
import { appraisalToItem } from "@/app/item-view";
import { inTauri } from "@/app/window";
import { ItemCard } from "./ItemCard";
import { PriceCard } from "./PriceCard";
import { WeaponDamageCard } from "./WeaponDamage";

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
        <div className="flex min-h-0 flex-wrap items-start gap-4">
          <div className="flex min-w-0 grow basis-90 flex-col gap-4">
            <ItemCard item={appraisalToItem(appraisal)} />
            <WeaponDamageCard appraisal={appraisal} />
          </div>
          <PriceCard appraisal={appraisal} className="min-w-0 grow basis-110" />
        </div>
      ) : (
        <EmptyState icon={ScanSearch} title="Предмет ещё не пойман">
          Наведите на предмет в игре и нажмите <Hotkey keys={hotkeys.check} className="align-middle" />
        </EmptyState>
      )}
    </Page>
  );
}
