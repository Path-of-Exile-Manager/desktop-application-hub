import { Activity } from "lucide-react";
import { MarketPrice, Tooltip } from "@/design-system";
import { useBuildTracking } from "@/app/build-tracking";

/** Бейдж библиотеки: цена выбранного этапа отслеживаемого билда (shared/docs/build-price-tracking.md, T8). */
export function TrackedPrice({ recordId }: { recordId: string }) {
  const summary = useBuildTracking((t) => t.summaries?.[recordId]);
  if (!summary) return null;
  const hint = `Отслеживается · ${summary.stageTitle ?? `этап ${summary.activeStage + 1}`} · с ценой ${summary.priced}, без цены ${summary.unpriced}`;
  return (
    <Tooltip content={hint}>
      <span className="flex w-36 shrink-0 items-center justify-end gap-1.5">
        <Activity size={14} aria-label="Цена отслеживается" className="text-icon-accent" />
        <MarketPrice chaos={summary.chaos} size="md" conversionClassName="text-label" />
      </span>
    </Tooltip>
  );
}