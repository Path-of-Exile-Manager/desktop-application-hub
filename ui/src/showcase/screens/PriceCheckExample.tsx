import { useMemo, useState } from "react";
import { ArrowRight, Bookmark, ExternalLink } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  FreshnessTag,
  Page,
  Price,
  PriceConversion,
  Table,
  formatAmount,
  CURRENCY,
  type Column,
  type SortState,
} from "@/design-system";
import { ItemCard } from "@/modules/price-check/ItemCard";
import { DIVINE_IN_CHAOS, DOOM_SHELL, DOOM_SHELL_DIVINE, DOOM_SHELL_PRICE, SIMILAR_COUNT, SIMILAR_LOTS, type Lot } from "../demo-data";

const inChaos = (lot: Lot) => (lot.price.currency === "divine" ? lot.price.amount * DIVINE_IN_CHAOS : lot.price.amount);

const LOT_COLUMNS: Column<Lot>[] = [
  { key: "price", header: "Цена", sortable: true, className: "w-[30%]", render: (l) => <span className="font-mono">{formatAmount(l.price.amount)} {CURRENCY[l.price.currency].short}</span> },
  { key: "es", header: "ES", numeric: true, sortable: true, className: "w-[18%]", render: (l) => `+${l.es}` },
  { key: "life", header: "Life", numeric: true, sortable: true, className: "w-[18%]", render: (l) => `+${l.life}` },
  { key: "listed", header: "Выставлен", numeric: true, sortable: true, render: (l) => <span className="text-text-secondary">{l.listed}</span> },
];

/**
 * Пример полного экрана Price check по макету A1 (с ценой и похожими лотами) — на демо-данных.
 * Настоящий модуль (modules/price-check) покажет эти блоки, когда появятся цены от бэкенда.
 */
export function PriceCheckExample() {
  const [sort, setSort] = useState<SortState>({ key: "price", direction: "asc" });
  const lots = useMemo(() => {
    if (!sort) return SIMILAR_LOTS;
    const value = (l: Lot) => ({ price: inChaos(l), es: l.es, life: l.life, listed: l.listedMinutes })[sort.key as "price"];
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...SIMILAR_LOTS].sort((a, b) => (value(a) - value(b)) * dir);
  }, [sort]);

  return (
    <Page
      title="Price check"
      subtitle="Пойман в 14:32 · лига Settlers of Kalguur"
      actions={
        <>
          <Button variant="ghost" icon={Bookmark}>В закладки</Button>
          <Button variant="secondary" icon={ArrowRight}>В ассистент крафта</Button>
          <Button variant="primary" icon={ExternalLink}>Искать на сайте торговли</Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-wrap items-start gap-4">
        <ItemCard item={DOOM_SHELL} className="min-w-0 grow basis-90" />
        <div className="flex min-w-0 grow basis-70 flex-col gap-4">
          <Card>
            <CardSection className="flex flex-col gap-2">
              <span className="text-label text-text-secondary">Оценка цены</span>
              <Price price={DOOM_SHELL_PRICE} approx size="xl" />
              <PriceConversion price={DOOM_SHELL_DIVINE} className="text-body" />
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge tone="muted">
                  <span className="font-mono">{SIMILAR_COUNT}</span> похожих в продаже
                </Badge>
                <FreshnessTag fresh>данные свежие · 2 мин</FreshnessTag>
              </div>
            </CardSection>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Похожие в продаже" aside={`${lots.length} из ${SIMILAR_COUNT} · по цене`} />
            <Table caption="Похожие лоты" columns={LOT_COLUMNS} rows={lots} rowKey={(l) => l.id} sort={sort} onSortChange={setSort} />
          </Card>
        </div>
      </div>
    </Page>
  );
}
