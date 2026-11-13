import { ExternalLink } from "lucide-react";
import { Button, toast, Tooltip, type ButtonProps } from "@/design-system";
import { openTrade } from "@/app/user-data";
import { inTauri } from "@/app/window";
import { specError, tradeQuery, type TradeSearchSpec } from "./spec";

/** Спецификация сразу или по запросу (Watchlist спрашивает ядро только по нажатию). */
export type SpecSource = TradeSearchSpec | (() => Promise<TradeSearchSpec>);

/** Открыть поиск по спецификации в лиге: через расширение в открытой вкладке торговли, без него — в браузере. */
export async function openSpecOnTrade(source: SpecSource, league: string) {
  const spec = typeof source === "function" ? await source() : source;
  const error = specError(spec);
  if (error) throw new Error(error);
  const query = await tradeQuery(spec, league);
  if (!query.url) throw new Error("ссылка на поиск не построена");
  return openTrade(query.url);
}

type Props = Omit<ButtonProps, "onClick"> & {
  /** `null` — искать нечего (предмета нет в справочнике). */
  spec: SpecSource | null;
  league: string | null | undefined;
  /** В оверлее тостов нет — ошибки там не показываются. */
  silent?: boolean;
};

/**
 * «Трейд»: поиск предмета на сайте торговли PoE1 в лиге `league` — Price check, оверлей, Watchlist.
 * Поиск — по умолчаниям ядра (src-tauri/src/trade/item_search.rs).
 */
export function TradeButton({ spec, league, silent, children = "Трейд", disabled, ...props }: Props) {
  const reason = !inTauri ? "Только в приложении" : !spec ? "Предмета нет в справочнике — искать нечего" : !league ? "Лига не выбрана" : null;
  const open = () => {
    if (!spec || !league) return;
    openSpecOnTrade(spec, league).then(
      (where) =>
        !silent && where === "browser" && toast({ status: "info", title: "Открыто в браузере", description: "Расширение не на связи — поиск открыт в новой вкладке." }),
      (e) => !silent && toast({ status: "warning", title: "Сайт торговли не открылся", description: e instanceof Error ? e.message : String(e) }),
    );
  };
  return (
    <Tooltip content={reason}>
      {/* Обёртка: у выключенной кнопки нет событий мыши, подсказку показывает она. */}
      <span className={props.block ? "flex w-full" : "inline-flex"}>
        <Button icon={ExternalLink} disabled={disabled || reason !== null} onClick={open} {...props}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
