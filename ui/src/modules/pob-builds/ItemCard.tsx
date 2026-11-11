import { useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Badge, Button, Dialog, ItemHeader, ItemProperties, ItemStateBadge, Sockets, Tooltip, type Item, type ItemState, type SocketColor } from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { openTrade } from "@/app/user-data";
import { TradeFilters } from "@/components/trade/TradeFilters";
import { applyOverride, diffOverride, modCounts, specError, tradeQuery, type SpecOverride, type TradeSearchSpec } from "@/components/trade/spec";
import type { PobItem } from "@/generated/PobItem";
import type { PobStageRow } from "@/generated/PobStageRow";
import { fail } from "./dialogs";

// Карточка строки экрана сборки (план shared/docs/pob-trader.md, P8): предмет как в PoB, фильтры
// поиска (TradeFilters) с правками поверх умолчаний ядра, «Трейд». Правки сохраняются в записи
// билда (`filterOverrides[ключ строки]`) — только изменённые поля.

const RARITY: Record<PobItem["rarity"], Item["rarity"]> = { normal: "normal", magic: "magic", rare: "rare", unique: "unique", relic: "unique" };

/** Сокеты PoB (`R-R-G B`) → группы дизайн-системы; A (абиссальное) и DV — как белые. */
function socketGroups(text: string): SocketColor[][] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((group) => group.split("-").map((c) => (["R", "G", "B", "W"].includes(c) ? (c as SocketColor) : "W")));
}

/** Предмет PoB для шапки карточки. */
export function toItem(item: PobItem, icon?: string): Item {
  const properties = [
    item.quality ? { label: "Quality", value: `+${item.quality}%` } : null,
    item.armour ? { label: "Armour", value: String(item.armour) } : null,
    item.evasion ? { label: "Evasion", value: String(item.evasion) } : null,
    item.energyShield ? { label: "Energy Shield", value: String(item.energyShield) } : null,
    item.ward ? { label: "Ward", value: String(item.ward) } : null,
    item.radius ? { label: "Radius", value: item.radius } : null,
    item.limitedTo ? { label: "Limited to", value: String(item.limitedTo) } : null,
  ].filter((p): p is { label: string; value: string } => p !== null);
  const states: ItemState[] = [];
  if (item.corrupted) states.push("corrupted");
  if (item.mirrored) states.push("mirrored");
  if (item.split) states.push("split");
  const named = item.rarity !== "normal" && item.rarity !== "magic";
  return {
    rarity: RARITY[item.rarity],
    itemClass: "",
    name: named && item.name !== "New Item" ? item.name : undefined,
    baseType: item.base,
    itemLevel: item.itemLevel ?? undefined,
    quality: item.quality ?? undefined,
    properties,
    sockets: item.sockets ? socketGroups(item.sockets.text) : undefined,
    mods: [],
    states,
    iconUrl: icon,
  };
}

export function ItemCard({
  row,
  league,
  override,
  onSave,
  onClose,
}: {
  row: PobStageRow;
  league: string | null;
  override: SpecOverride | undefined;
  onSave: (override: SpecOverride | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const defaults = row.spec as TradeSearchSpec;
  const [spec, setSpec] = useState(() => applyOverride(defaults, override));
  const error = specError(spec);
  const { searched, unavailable } = modCounts(spec);
  const item = row.item ? toItem(row.item, iconUrl(row.catalogItem?.iconSha256)) : null;

  const save = () => onSave(diffOverride(defaults, spec));
  const close = () => void save().then(onClose, fail("Правки не сохранены"));
  const trade = () =>
    void save()
      .then(() => tradeQuery(spec, league))
      .then((q) => q.url && openTrade(q.url))
      .catch(fail("Сайт торговли не открылся"));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={row.gem ? row.gem.gem.name : (item?.name ?? row.item?.base ?? "")}
      description={`${searched} в поиске${unavailable ? ` · ${unavailable} недоступно` : ""}${league ? ` · лига ${league}` : ""}`}
      className="w-200 max-w-[calc(100vw-4rem)]"
      footer={
        <>
          <Button variant="ghost" icon={RotateCcw} onClick={() => setSpec(defaults)}>
            Сбросить к умолчаниям
          </Button>
          <Button onClick={close}>Готово</Button>
          <Tooltip content={error ?? (league ? null : "Лига не выбрана")}>
            <span>
              <Button variant="primary" icon={ExternalLink} disabled={!!error || !league} onClick={trade}>
                Трейд
              </Button>
            </span>
          </Tooltip>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {item && (
          <div className="flex flex-col gap-2">
            <ItemHeader item={item} aside={row.item?.fractured ? <Badge tone="muted">Fractured</Badge> : undefined} />
            <ItemProperties item={item} />
            <div className="flex flex-wrap items-center gap-2">
              {item.sockets && <Sockets groups={item.sockets} />}
              {item.states?.map((s) => <ItemStateBadge key={s} state={s} />)}
              {row.item?.synthesised && <Badge tone="muted">Synthesised</Badge>}
              {row.item?.influences.map((i) => (
                <Badge key={i} tone="muted">
                  {i}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {defaults.mods.length === 0 && row.item && <p className="text-label text-text-secondary">Модов в поиске нет: в наборе данных нет фильтров сайта торговли или у предмета нет модов.</p>}
        <TradeFilters spec={spec} onChange={setSpec} />
        {error && <p className="text-label text-status-danger-fg">{error}</p>}
        {row.item?.rawText && (
          <details className="text-label text-text-secondary">
            <summary className="cursor-pointer select-none">Исходный текст PoB</summary>
            <pre className="mt-2 font-mono text-caption whitespace-pre-wrap text-text-secondary">{row.item.rawText}</pre>
          </details>
        )}
      </div>
    </Dialog>
  );
}
