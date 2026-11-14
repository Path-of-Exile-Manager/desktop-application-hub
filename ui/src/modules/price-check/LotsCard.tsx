import { useEffect, useState } from "react";
import { Copy, ExternalLink, LoaderCircle, PackageSearch, Zap } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardSection,
  CURRENCY,
  cx,
  EmptyState,
  formatAmount,
  IconButton,
  ModList,
  Pagination,
  Price,
  RARITY_TEXT,
  toast,
  Tooltip,
  usePageSize,
  usePriceText,
  type CurrencyId,
  type ItemMod,
  type ModKind,
  type Rarity,
} from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { openTrade } from "@/app/user-data";
import type { LiveListing } from "@/generated/LiveListing";
import type { LiveMod } from "@/generated/LiveMod";
import type { LivePrice } from "@/generated/LivePrice";
import type { useLiveSearch } from "./useLiveSearch";

// Лоты на рынке рядом с предметом (живой поиск Price check). Окно без прокрутки (app-shell.md):
// строки одной высоты, постранично; моды — строкой, полный список — в подсказке. Страница дальше
// загруженного подгружается с сайта (по 10).

/** Высота строки лота, px: имя и цена, база, моды строкой, продавец. */
const ROW_HEIGHT = 92;

const RARITY: Record<string, Rarity> = { Normal: "normal", Magic: "magic", Rare: "rare", Unique: "unique", Gem: "gem", Currency: "currency", DivinationCard: "divination" };

const MOD_KIND: Record<string, ModKind> = { implicit: "implicit", explicit: "explicit", crafted: "crafted", fractured: "fractured", enchant: "enchant", scourge: "enchant", crucible: "explicit" };

const toMod = (m: LiveMod): ItemMod => ({ kind: MOD_KIND[m.kind] ?? "explicit", affix: m.affix ?? undefined, tier: m.tier, segments: [m.text] });

/** «5 мин», «3 ч», «2 дн» назад. */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} ч` : `${Math.round(hours / 24)} дн`;
}

const STATUS: Record<string, { label: string; dot: string }> = {
  online: { label: "в сети", dot: "bg-status-success-fg" },
  afk: { label: "AFK", dot: "bg-status-warning-fg" },
};

function LotPrice({ price }: { price: LivePrice }) {
  const text = usePriceText();
  return (
    <div className="flex shrink-0 flex-col items-end text-right">
      {price.currency in CURRENCY ? (
        <Price price={{ amount: price.amount, currency: price.currency as CurrencyId }} size="md" />
      ) : (
        <span className="inline-flex items-center gap-1.5 text-body">
          <span className="font-mono font-semibold text-text-primary">{formatAmount(price.amount)}</span>
          {price.iconSha256 && <img src={iconUrl(price.iconSha256)} alt="" width={16} height={16} />}
          <span className="text-text-secondary">{price.currency}</span>
        </span>
      )}
      {/* Пересчёт дешёвого лота («≈ 22 / c») только путает — показываем от половины chaos. */}
      {price.chaos !== null && price.chaos >= 0.5 && price.currency !== "chaos" && <span className="font-mono text-caption text-text-secondary">≈ {text(price.chaos, true)}</span>}
    </div>
  );
}

function LotRow({ lot }: { lot: LiveListing }) {
  const rarity = RARITY[lot.rarity ?? ""] ?? "normal";
  const status = lot.status ? STATUS[lot.status] : null;
  const explicit = lot.mods.filter((m) => m.kind !== "implicit" && m.kind !== "enchant");
  const summary = (explicit.length ? explicit : lot.mods).map((m) => m.text).join(" · ");
  const copyWhisper = () =>
    lot.whisper &&
    navigator.clipboard.writeText(lot.whisper).then(
      () => toast({ status: "success", title: "Сообщение продавцу скопировано", description: "В игре: Enter, Ctrl+V, Enter." }),
      (e) => toast({ status: "warning", title: "Не скопировано", description: String(e) }),
    );
  return (
    <li style={{ height: ROW_HEIGHT }} className="flex items-center gap-3 border-b border-border-subtle last:border-b-0">
      {lot.icon ? <img src={lot.icon} alt="" className="h-11 w-11 shrink-0 object-contain" /> : <span aria-hidden className="h-11 w-11 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cx("truncate text-body font-semibold", RARITY_TEXT[rarity])}>{lot.name ?? lot.typeLine}</p>
            <p className="truncate text-caption text-text-secondary">
              {lot.name && `${lot.typeLine} · `}
              {lot.itemLevel !== null && `ilvl ${lot.itemLevel}`}
              {lot.stackSize !== null && ` · ${lot.stackSize} шт.`}
              {!lot.identified && " · не опознан"}
              {lot.corrupted && <span className="text-status-danger-fg"> · осквернён</span>}
            </p>
          </div>
          {lot.price && <LotPrice price={lot.price} />}
        </div>
        {summary && (
          <Tooltip content={<ModList mods={lot.mods.map(toMod)} size="sm" />}>
            <p tabIndex={0} className="cursor-help truncate text-caption text-text-primary">
              {summary}
            </p>
          </Tooltip>
        )}
        <div className="flex items-center gap-2 text-caption text-text-secondary">
          {status ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <span aria-hidden className={cx("size-2 rounded-full", status.dot)} />
              {status.label}
            </span>
          ) : (
            !lot.instantBuyout && <span className="shrink-0">не в сети</span>
          )}
          {lot.character && <span className="min-w-0 truncate font-mono">{lot.character}</span>}
          {ago(lot.indexedAt) && <span className="shrink-0">{ago(lot.indexedAt)}</span>}
          <span className="ml-auto shrink-0">
            {lot.instantBuyout ? (
              <span className="inline-flex items-center gap-1 text-status-success-fg">
                <Zap aria-hidden className="size-3.5" /> мгновенный выкуп
              </span>
            ) : (
              <IconButton icon={Copy} label="Скопировать сообщение продавцу" onClick={copyWhisper} className="size-7" iconSize={14} />
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

/** Столбец лотов рядом с поиском: пусто до «Найти лоты», потом выдача сайта по цене. */
export function LotsCard({ live, className }: { live: ReturnType<typeof useLiveSearch>; className?: string }) {
  const { result, listings, loading, error, hasMore, more } = live;
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const total = result?.ids.length ?? 0;
  const visible = listings.slice((page - 1) * pageSize, page * pageSize);

  // Новая выдача — с первой страницы; страница дальше загруженного — догрузить с сайта.
  useEffect(() => setPage(1), [result]);
  useEffect(() => {
    if (page * pageSize > listings.length && hasMore && !loading && !error) more();
  }, [page, pageSize, listings.length, hasMore, loading, error, more]);

  return (
    <Card className={cx("flex min-h-0 flex-col", className)}>
      <CardHeader
        title={result ? `Лоты · ${result.total >= 10_000 ? "10 000+" : result.total.toLocaleString("ru-RU")}` : "Лоты на рынке"}
        aside={
          result && (
            <Button variant="ghost" icon={ExternalLink} className="h-7 text-label" onClick={() => void openTrade(result.url)}>
              На сайте
            </Button>
          )
        }
      />
      {error && (
        <CardSection>
          <p className="text-label text-status-danger-fg">{error}</p>
        </CardSection>
      )}
      {/* Контейнер всегда на месте: по его высоте считается, сколько лотов на странице. */}
      <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden px-card-padding-x">
        {!result ? (
          <div className="flex flex-1 items-center justify-center">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-label text-text-secondary">
                <LoaderCircle aria-hidden className="size-4 animate-spin" /> Ищем на сайте торговли…
              </span>
            ) : (
              <EmptyState icon={PackageSearch} title="Пока не искали">
                Отметьте моды и нажмите «Найти лоты» — здесь появятся предложения, самые дешёвые сверху.
              </EmptyState>
            )}
          </div>
        ) : total === 0 ? (
          <p className="py-4 text-body text-text-secondary">Ничего не нашлось — ослабьте условия: снимите часть модов или уменьшите MIN.</p>
        ) : visible.length > 0 ? (
          <ul className="flex flex-col">
            {visible.map((lot) => (
              <LotRow key={lot.id} lot={lot} />
            ))}
          </ul>
        ) : (
          <p className="inline-flex items-center gap-2 py-4 text-label text-text-secondary">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Загружаем лоты…
          </p>
        )}
      </div>
      {result && total > 0 && (
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} className="border-t border-border-subtle px-card-padding-x py-2" />
      )}
    </Card>
  );
}
