import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge, Button, Card, CardHeader, CardSection, cx, Dialog, ItemIcon, RARITY_TEXT, StatusBadge, usePriceText, type Rarity } from "@/design-system";
import { iconUrl, itemName, type CatalogItem } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { priceVariants, type Price } from "@/app/prices";
import { variantLabel, type WatchEntry } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { TradeButton } from "@/components/trade/TradeButton";
import { variantSpec } from "@/components/trade/spec";
import { PriceDetails } from "@/modules/price-check/PriceCard";

// Просмотр записи Watchlist: предмет из справочника (база, требования, свойства вида) и подробная
// цена, как в Price check, плюс цены других вариантов того же предмета. Текста предмета из игры у
// записи нет — моды не показываются.

const KIND_LABEL: Record<CatalogItem["kind"], string> = {
  EQUIPMENT: "Снаряжение",
  FLASK: "Флакон",
  TINCTURE: "Настойка",
  JEWEL: "Самоцвет",
  GEM: "Камень",
  CURRENCY: "Валюта",
  FRAGMENT: "Фрагмент",
  MAP: "Карта",
  CARD: "Гадальная карта",
  OTHER: "Прочее",
  UNKNOWN: "Предмет",
};

const GEM_COLOR: Record<string, string> = { RED: "красный", GREEN: "зелёный", BLUE: "синий", WHITE: "белый" };

/** Редкость для цвета имени: у уникального — уникальная, у камня — камень, у валюты — валюта. */
function rarityOf(item: CatalogItem): Rarity {
  if (item.rarity === "UNIQUE") return "unique";
  switch (item.kind) {
    case "GEM":
      return "gem";
    case "CURRENCY":
    case "FRAGMENT":
      return "currency";
    case "CARD":
      return "divination";
    default:
      return "normal";
  }
}

/** Свойства по виду предмета: требования, цвет камня, тир карты, размер стопки… */
function facts(item: CatalogItem): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [{ label: "Размер", value: `${item.size.w}×${item.size.h}` }];
  const d = item.details;
  switch (d.kind) {
    case "EQUIPMENT": {
      const r = d.requirements;
      if (r?.level) out.push({ label: "Уровень", value: String(r.level) });
      const attrs = [r?.str && `Сил ${r.str}`, r?.dex && `Ловк ${r.dex}`, r?.int && `Инт ${r.int}`].filter(Boolean);
      if (attrs.length) out.push({ label: "Требования", value: attrs.join(" · ") });
      break;
    }
    case "GEM":
      out.push({ label: "Тип", value: d.isSupport ? "поддержка" : "умение" });
      out.push({ label: "Цвет", value: GEM_COLOR[d.color] ?? d.color });
      out.push({ label: "Макс. уровень", value: String(d.maxLevel) });
      break;
    case "CURRENCY":
    case "CARD":
      out.push({ label: "Стопка", value: `до ${d.stackSize}` });
      break;
    case "FRAGMENT":
      if (d.stackSize) out.push({ label: "Стопка", value: `до ${d.stackSize}` });
      break;
    case "MAP":
      if (d.tier) out.push({ label: "Тир", value: String(d.tier) });
      break;
  }
  return out;
}

const tagsOf = (item: CatalogItem): string[] => ("tags" in item.details ? item.details.tags.filter((t) => t !== "default") : []);

/** Другие варианты цены того же предмета (без текущего), дорогие сверху. */
function OtherVariants({ variants, current }: { variants: Price[]; current: string }) {
  const text = usePriceText();
  const others = variants.filter((v) => v.variantKey !== current).sort((a, b) => b.chaosValue - a.chaosValue);
  if (others.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Другие варианты" aside={others.length} />
      <CardSection>
        <dl className="grid grid-cols-[minmax(0,1fr)_max-content] gap-x-4 gap-y-1.5 text-label">
          {others.slice(0, 12).map((v) => (
            <div key={v.variantKey} className="contents">
              <dt className="truncate text-text-secondary">{variantLabel(v.variantKey)}</dt>
              <dd className="text-right font-mono text-text-primary">
                {text(v.chaosValue)}
                {!v.reliable && <span className="text-status-warning-fg"> · мало данных</span>}
              </dd>
            </div>
          ))}
        </dl>
        {others.length > 12 && <p className="mt-2 text-caption text-text-secondary">и ещё {others.length - 12}</p>}
      </CardSection>
    </Card>
  );
}

export function WatchDetailsDialog({ entry, item, onClose }: { entry: WatchEntry; item: CatalogItem; onClose: () => void }) {
  const league = useCurrentLeague();
  const otherLeague = entry.leagueId !== null && entry.leagueId !== league?.id;
  const [variants, setVariants] = useState<Price[] | null>(null);
  const [base, setBase] = useState<CatalogItem | null>(null);

  useEffect(() => {
    if (otherLeague) return setVariants([]);
    priceVariants(entry.itemId).then(setVariants);
  }, [entry.itemId, otherLeague]);

  useEffect(() => {
    if (!inTauri || !item.baseId) return;
    invoke<CatalogItem | null>("catalog_item", { id: item.baseId }).then(setBase);
  }, [item.baseId]);

  const price = variants?.find((v) => v.variantKey === entry.variantKey) ?? null;
  const tags = tagsOf(item);
  const description = item.details.kind === "CURRENCY" ? item.details.description : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={itemName(item)}
      description={`${variantLabel(entry.variantKey)}${entry.leagueId ? ` · ${entry.leagueId}` : ""}`}
      className="w-180"
      footer={
        <>
          <TradeButton spec={() => variantSpec(entry.itemId, entry.variantKey)} league={entry.leagueId ?? league?.id}>
            Искать на трейде
          </TradeButton>
          <Button onClick={onClose}>Закрыть</Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardSection className="flex items-start gap-4">
              <ItemIcon variant="thumb" size={[item.size.w, item.size.h]} src={iconUrl(item.iconSha256)} alt={itemName(item)} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className={cx("text-body-lg font-semibold", RARITY_TEXT[rarityOf(item)])}>{itemName(item)}</p>
                {item.name.ru && item.name.ru !== item.name.en && <p className="text-label text-text-secondary">{item.name.en}</p>}
                {base && <p className="text-label text-text-secondary">{itemName(base)}</p>}
                <p className="text-label text-text-secondary">
                  {KIND_LABEL[item.kind]} · {item.classId}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.rarity === "UNIQUE" && <Badge tone="muted">уникальный</Badge>}
                  {item.unique?.isReplica && <Badge tone="muted">реплика</Badge>}
                  {item.releaseState === "LEGACY" && <StatusBadge status="warning">больше не выпадает</StatusBadge>}
                  {item.releaseState === "UNRELEASED" && <StatusBadge status="warning">не выпущен</StatusBadge>}
                </div>
              </div>
            </CardSection>
            <CardSection>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
                {facts(item).map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-text-secondary">{f.label}</dt>
                    <dd className="text-text-primary">{f.value}</dd>
                  </div>
                ))}
              </dl>
              {description && <p className="mt-3 text-label text-text-secondary">{description}</p>}
              {tags.length > 0 && <p className="mt-3 font-mono text-caption text-text-secondary">{tags.join(" · ")}</p>}
              {item.unique && item.unique.variants.length > 0 && (
                <p className="mt-3 text-label text-text-secondary">Варианты по PoB: {item.unique.variants.join(", ")}</p>
              )}
            </CardSection>
            {entry.note && (
              <CardSection>
                <p className="text-label text-text-secondary">Заметка</p>
                <p className="text-body whitespace-pre-wrap text-text-primary">{entry.note}</p>
              </CardSection>
            )}
          </Card>
          {variants && <OtherVariants variants={variants} current={entry.variantKey} />}
        </div>

        <Card className="min-w-0">
          <CardHeader title={league ? `Цена · ${league.name}` : "Цена"} />
          {variants === null ? (
            <CardSection>
              <p className="text-label text-text-secondary">загрузка…</p>
            </CardSection>
          ) : price ? (
            <PriceDetails price={price} league={league?.id} />
          ) : (
            <CardSection>
              <p className="text-body text-text-secondary">
                {otherLeague ? `Запись для лиги ${entry.leagueId} — цены есть только для лиги в шапке.` : "В текущей лиге на этот вариант цены нет."}
              </p>
            </CardSection>
          )}
        </Card>
      </div>
    </Dialog>
  );
}
