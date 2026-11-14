import { LoaderCircle, RotateCcw, Search } from "lucide-react";
import { Button, Card, CardHeader, CardSection, cx, Tooltip } from "@/design-system";
import { inTauri } from "@/app/window";
import { TradeButton } from "@/components/trade/TradeButton";
import { TradeFilters } from "@/components/trade/TradeFilters";
import { fromChoice, IdentifiedControl, toChoice } from "@/components/trade/identified";
import { modCounts, specError, type TradeSearchSpec } from "@/components/trade/spec";

/**
 * Поиск на трейде из Price check: моды предмета с галочками и MIN/MAX (умолчания ядра: значение
 * − 10 %), сокеты, осквернение, опознан ли; «Найти лоты» — выдача столбиком рядом (LotsCard),
 * «На сайте» — тот же поиск в браузере.
 */
export function TradeSearchCard({
  spec,
  defaults,
  onChange,
  league,
  searching,
  onSearch,
  className,
}: {
  spec: TradeSearchSpec;
  defaults: TradeSearchSpec;
  onChange: (spec: TradeSearchSpec) => void;
  league: string | null | undefined;
  searching: boolean;
  onSearch: () => void;
  className?: string;
}) {
  const error = specError(spec);
  const { searched, unavailable } = modCounts(spec);
  const blocked = !inTauri ? "Только в приложении" : (error ?? (league ? null : "Лига не выбрана"));
  const changed = JSON.stringify(spec) !== JSON.stringify(defaults);

  return (
    <Card className={cx("flex flex-col", className)}>
      <CardHeader
        title="Поиск на трейде"
        aside={
          <span className="text-label text-text-secondary">
            {searched} в поиске{unavailable ? ` · ${unavailable} без фильтра` : ""}
          </span>
        }
      />
      {/* Моды прокручиваются внутри карточки (как списки модов в RegEx карт), кнопки — всегда видны. */}
      <CardSection className="min-h-0 flex-1 overflow-y-auto">
        <TradeFilters
          spec={spec}
          onChange={onChange}
          extra={
            spec.identified !== null || defaults.identified !== null ? (
              <IdentifiedControl value={toChoice(spec.identified)} onChange={(v) => onChange({ ...spec, identified: fromChoice(v) })} />
            ) : undefined
          }
        />
        {spec.mods.length === 0 && <p className="mt-2 text-label text-text-secondary">Ищем по названию и базе — модов для поиска у предмета нет.</p>}
        {error && <p className="mt-2 text-label text-status-danger-fg">{error}</p>}
      </CardSection>
      <CardSection className="flex shrink-0 flex-wrap items-center gap-2">
        <Tooltip content={blocked}>
          <span className="inline-flex">
            <Button variant="primary" icon={searching ? LoaderCircle : Search} disabled={!!blocked || searching} onClick={onSearch}>
              Найти лоты
            </Button>
          </span>
        </Tooltip>
        <TradeButton spec={spec} league={league}>
          На сайте
        </TradeButton>
        <Button variant="ghost" icon={RotateCcw} disabled={!changed} onClick={() => onChange(defaults)}>
          Сбросить
        </Button>
      </CardSection>
    </Card>
  );
}
