import { ScanSearch } from "lucide-react";
import { Banner, EmptyState, Hotkey, Page } from "@/design-system";
import { useShell } from "@/app/store";
import { inputBlocked, useGameStatus } from "@/app/game";
import { ItemCard } from "./ItemCard";

/**
 * Модуль Price check (app-shell.md, экран A1).
 * Показывает только настоящие данные: пойманный предмет и состояние игры.
 * Оценка цены и похожие лоты появятся вместе с данными от бэкенда (пример раскладки — в витрине).
 */
export function PriceCheckPage() {
  const { currentItem: item, caughtAt, hotkeys } = useShell();
  const game = useGameStatus();

  return (
    <Page title="Price check" subtitle={item && caughtAt ? `Пойман в ${caughtAt}` : undefined}>
      {game?.state === "notRunning" && (
        <Banner status="danger" title="Окно игры не найдено — горячие клавиши сейчас не работают">
          Запустите Path of Exile — приложение найдёт окно само.
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

      {item ? (
        <div className="flex min-h-0 flex-wrap items-start gap-4">
          <ItemCard item={item} className="min-w-0 grow basis-90" />
        </div>
      ) : (
        <EmptyState icon={ScanSearch} title="Предмет ещё не пойман">
          Наведите на предмет в игре и нажмите <Hotkey keys={hotkeys.check} className="align-middle" />
        </EmptyState>
      )}
    </Page>
  );
}
