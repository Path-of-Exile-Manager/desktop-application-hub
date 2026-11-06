import type { ReactNode } from "react";
import { PanelRightClose, ScanSearch, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "../components/Button";
import { EmptyState } from "../components/Feedback";
import { Hotkey } from "../components/Kbd";
import { ItemStateBadge } from "../game/ModBadges";
import { ModList } from "../game/ModLine";
import { Price, PriceConversion } from "../game/Price";
import { RarityBadge, RARITY_TEXT } from "../game/Rarity";
import { maxLinks } from "../game/Sockets";
import type { Item, PriceAmount } from "../game/types";

export type SendTarget = { id: string; label: string; icon: LucideIcon };

export type CurrentItemPanelProps = {
  /** Последний пойманный предмет. `null` — ещё ничего не поймано. */
  item: Item | null;
  /** «пойман в 14:32». */
  caught?: ReactNode;
  price?: PriceAmount;
  conversion?: PriceAmount;
  /** Модули, в которые можно передать предмет. */
  targets: SendTarget[];
  /** Открытый сейчас модуль — его кнопка неактивна с пометкой «открыт». */
  activeModuleId?: string;
  onSend: (moduleId: string) => void;
  onHide: () => void;
  /** Горячая клавиша проверки — для подсказки в пустом состоянии. */
  checkHotkey?: string[];
};

/**
 * Панель «Текущий предмет» (components.md, п. 20): ширина 300, блоки через разделители:
 * сводка с ценой → моды одной строкой → «Передать в модуль».
 */
export function CurrentItemPanel({ item, caught, price, conversion, targets, activeModuleId, onSend, onHide, checkHotkey = ["Ctrl", "D"] }: CurrentItemPanelProps) {
  return (
    <aside aria-label="Текущий предмет" className="flex w-panel-width shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle pr-2 pl-4">
        <h2 className="text-label font-semibold tracking-caps text-text-secondary uppercase">Текущий предмет</h2>
        <IconButton icon={PanelRightClose} label="Скрыть панель" onClick={onHide} className="size-7" />
      </header>

      {!item ? (
        <EmptyState icon={ScanSearch} title="Предмет не пойман">
          Наведите на предмет в игре и нажмите <Hotkey keys={checkHotkey} className="align-middle" />
        </EmptyState>
      ) : (
        <>
          <section className="flex flex-col gap-1.5 border-b border-border-subtle p-4">
            <div className="flex items-center gap-2">
              <RarityBadge rarity={item.rarity} />
              {caught && <span className="text-label text-text-secondary">{caught}</span>}
            </div>
            <p className={cx("truncate text-title-sm font-semibold", RARITY_TEXT[item.rarity])}>{item.name ?? item.baseType}</p>
            <p className="truncate text-label text-text-secondary">
              {item.name && <>{item.baseType} · </>}
              {item.itemLevel !== undefined && (
                <>
                  iLvl <span className="font-mono">{item.itemLevel}</span>
                </>
              )}
              {item.sockets && maxLinks(item.sockets) >= 5 && <> · {maxLinks(item.sockets)}L</>}
            </p>
            {price && (
              <div className="mt-1 flex items-center gap-2">
                <Price price={price} approx size="lg" />
                {conversion && <PriceConversion price={conversion} className="text-label" />}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col gap-2 border-b border-border-subtle px-4 py-3">
            <ModList mods={item.mods} size="sm" />
            {item.states?.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {item.states.map((s) => (
                  <ItemStateBadge key={s} state={s} />
                ))}
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-1.5 px-4 py-3">
            <h3 className="text-label text-text-secondary">Передать в модуль</h3>
            {targets.map((t) => {
              const open = t.id === activeModuleId;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={open}
                  onClick={() => onSend(t.id)}
                  className={cx(
                    "flex h-8.5 items-center gap-2 rounded-md border border-border-default px-2.5 text-label font-medium transition-colors",
                    open ? "cursor-default bg-bg-raised text-text-muted" : "text-text-primary hover:bg-bg-hover",
                  )}
                >
                  <Icon aria-hidden size={16} className="shrink-0" />
                  <span className="flex-1 text-left">{t.label}</span>
                  {open && <span className="text-caption text-text-muted">открыт</span>}
                </button>
              );
            })}
          </section>
        </>
      )}
    </aside>
  );
}
