import {
  Button,
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
  price: PriceAmount;
  conversion: PriceAmount;
  similar: number;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onClose: () => void;
  onOpenInWindow: () => void;
  onOpenCraft: () => void;
};

/**
 * Виджет оверлея Price check (экран A4, OvA.dc.html). Порядок сверху вниз (guide.md, п. 4):
 * редкость и имя → базовые свойства → моды → состояние → цена → действия.
 */
export function OverlayPriceCheck({ item, price, conversion, similar, pinned, onPinnedChange, onClose, onOpenInWindow, onOpenCraft }: OverlayPriceCheckProps) {
  return (
    <OverlayFrame
      title="Price check"
      pinned={pinned}
      onPinnedChange={onPinnedChange}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" block onClick={onOpenInWindow}>
            Подробнее в окне
          </Button>
          <Button variant="ghost" block onClick={onOpenCraft}>
            В ассистент крафта
          </Button>
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
      <OverlaySection>
        <ModList mods={item.mods} />
      </OverlaySection>
      <OverlaySection className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {item.states?.map((s) => (
            <ItemStateBadge key={s} state={s} />
          ))}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Price price={price} approx size="lg" />
          <span className="text-label text-text-secondary">
            <span className="font-mono">≈ {formatAmount(conversion.amount)} div</span> · {similar} похожих
          </span>
        </div>
      </OverlaySection>
    </OverlayFrame>
  );
}
