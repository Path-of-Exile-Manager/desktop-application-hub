import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  Button,
  CURRENCY,
  ItemStateBadge,
  ModList,
  OverlayFrame,
  OverlaySection,
  Price,
  RARITY_TEXT,
  RarityBadge,
  Sockets,
  cx,
  formatAmount,
  type Item,
  type PriceAmount,
} from "@/design-system";

export type OverlayPriceCheckProps = {
  item: Item;
  /** `null` — цены нет; вместо неё — `priceNote`. */
  price: PriceAmount | null;
  conversion?: PriceAmount | null;
  /** Число похожих лотов (витрина). */
  similar?: number;
  /** Подпись под ценой или вместо неё: свежесть, «ближайший вариант», «нет цены». */
  priceNote?: ReactNode;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onClose: () => void;
  onOpenInWindow: () => void;
  /** Без обработчика кнопки «Искать на трейде» нет (предмета нет в справочнике, лига не выбрана). */
  onOpenTrade?: () => void;
  /** Настройки поиска на трейде (опознан ли) — строкой над кнопками. */
  tradeOptions?: ReactNode;
  /** Без обработчика кнопки «В ассистент крафта» нет. */
  onOpenCraft?: () => void;
};

/**
 * Виджет оверлея Price check (экран A4, OvA.dc.html). Порядок сверху вниз (guide.md, п. 4):
 * редкость и имя → базовые свойства → моды → состояние → цена → действия.
 */
export function OverlayPriceCheck({ item, price, conversion, similar, priceNote, pinned, onPinnedChange, onClose, onOpenInWindow, onOpenTrade, tradeOptions, onOpenCraft }: OverlayPriceCheckProps) {
  return (
    <OverlayFrame
      title="Price check"
      pinned={pinned}
      onPinnedChange={onPinnedChange}
      onClose={onClose}
      footer={
        <>
          {onOpenTrade && (
            <Button variant="primary" icon={ExternalLink} block onClick={onOpenTrade}>
              Искать на трейде
            </Button>
          )}
          <Button variant="secondary" block onClick={onOpenInWindow}>
            Подробнее в окне
          </Button>
          {onOpenCraft && (
            <Button variant="ghost" block onClick={onOpenCraft}>
              В ассистент крафта
            </Button>
          )}
        </>
      }
    >
      <OverlaySection className="flex flex-col gap-1.25">
        <div className="flex items-center gap-2">
          <RarityBadge rarity={item.rarity} />
          <span className="text-label text-text-secondary">{item.itemClass}</span>
        </div>
        <p className={cx("text-title-sm font-semibold", RARITY_TEXT[item.rarity])}>{item.name ?? item.baseType}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-label text-text-secondary">
          {item.name && <span>{item.baseType} ·</span>}
          {item.itemLevel !== undefined && (
            <span>
              iLvl <span className="font-mono">{item.itemLevel}</span> ·
            </span>
          )}
          {item.quality ? (
            <span>
              Q <span className="font-mono">+{item.quality}%</span> ·
            </span>
          ) : null}
          {item.properties?.map((p) => (
            <span key={p.label}>
              {p.label === "Energy Shield" ? "ES" : p.label} <span className="font-mono font-semibold text-text-primary">{p.value}</span> ·
            </span>
          ))}
          {item.sockets && <Sockets groups={item.sockets} variant="text" />}
        </p>
      </OverlaySection>
      {item.mods.length > 0 && (
        <OverlaySection>
          <ModList mods={item.mods} />
        </OverlaySection>
      )}
      <OverlaySection className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {item.states?.map((s) => (
            <ItemStateBadge key={s} state={s} />
          ))}
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          {price && <Price price={price} approx size="lg" />}
          {(conversion || similar !== undefined) && (
            <span className="text-label text-text-secondary">
              {conversion && (
                <span className="font-mono">
                  ≈ {formatAmount(conversion.amount)} {CURRENCY[conversion.currency].abbr}
                </span>
              )}
              {conversion && similar !== undefined && " · "}
              {similar !== undefined && `${similar} похожих`}
            </span>
          )}
          {priceNote && <span className="text-label text-text-secondary">{priceNote}</span>}
        </div>
      </OverlaySection>
      {onOpenTrade && tradeOptions && (
        <OverlaySection className="flex items-center justify-between gap-3">
          <span className="text-label text-text-secondary">Поиск на трейде</span>
          {tradeOptions}
        </OverlaySection>
      )}
    </OverlayFrame>
  );
}
