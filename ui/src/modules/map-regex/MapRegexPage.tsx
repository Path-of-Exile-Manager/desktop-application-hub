import { useMemo } from "react";
import { CloudDownload, LoaderCircle, Monitor, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button, Chip, EmptyState, Page, SegmentedControl, Select, toast } from "@/design-system";
import { checkDatasetNow } from "@/app/dataset";
import { toggleMod, type GameLang, type ModChoice, type WantMode } from "./model";
import { buildExpression, EXPRESSION_MAX, isError } from "./regex";
import { ExpressionCard, ModColumn } from "./parts";
import { DRAFT_ID, updatePreset, useActivePreset, useMapRegexPresets, useMapRegexView, usePresetsSync } from "./store";
import { useMapSearch } from "./useMapSearch";

const LANGS: { value: GameLang; label: string }[] = [
  { value: "RU", label: "RU" },
  { value: "EN", label: "EN" },
];

const WANT_MODES = [
  { value: "ANY", label: "Любой" },
  { value: "ALL", label: "Все" },
];

/**
 * RegEx карт (shared/docs/map-regex.md, раздел 2): моды карт, которые исключить или требовать, →
 * строка для поиска во вкладке сундука. Моды и токены — из набора данных, наборы — в user.db.
 */
export function MapRegexPage() {
  usePresetsSync();
  const search = useMapSearch();
  const presets = useMapRegexPresets((s) => s.presets);
  const preset = useActivePreset();
  const setActivePreset = useMapRegexView((s) => s.setActivePreset);
  const showNightmare = useMapRegexView((s) => s.showNightmare);
  const showAffix = useMapRegexView((s) => s.showAffix);
  const groupByAffix = useMapRegexView((s) => s.groupByAffix);
  const setView = useMapRegexView((s) => s.setView);
  const view = useMemo(() => ({ showNightmare, showAffix, groupByAffix }), [showNightmare, showAffix, groupByAffix]);

  const index = search.status === "ready" ? search.index : null;
  const expression = useMemo(() => (index ? buildExpression(preset, index) : null), [preset, index]);

  const toggle = (choice: ModChoice) => (modId: string) => updatePreset(preset.id, (p) => toggleMod(p, modId, choice));

  const copy = async () => {
    if (!expression?.text) return;
    try {
      await navigator.clipboard.writeText(expression.text);
      const warn = expression.text.length > EXPRESSION_MAX || expression.issues.some(isError);
      toast(warn ? { status: "warning", title: "Скопировано", description: "Проверьте предупреждение под выражением." } : { status: "success", title: "Скопировано в буфер обмена" });
    } catch (e) {
      toast({ status: "danger", title: "Не удалось скопировать", description: String(e) });
    }
  };

  const options = (presets?.length ? presets : [preset]).map((p) => ({ value: p.id, label: p.name, hint: p.id === DRAFT_ID ? "не сохранён" : undefined }));

  return (
    <Page
      title="RegEx карт"
      subtitle="Моды карт → строка поиска во вкладке сундука"
      actions={
        <>
          <Select aria-label="Набор" value={preset.id} onValueChange={setActivePreset} options={options} className="w-48" disabled={!presets} />
          <SegmentedControl
            aria-label="Язык клиента игры"
            value={preset.lang}
            onValueChange={(lang) => updatePreset(preset.id, (p) => ({ ...p, lang }))}
            options={LANGS}
          />
        </>
      }
    >
      {search.status === "ready" && expression && index && presets ? (
        <>
          <ExpressionCard expression={expression} index={index} lang={preset.lang} onCopy={() => void copy()} />

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Chip selected={showNightmare} onSelectedChange={(v) => setView({ showNightmare: v })}>
              Nightmare
            </Chip>
            <Chip selected={showAffix} onSelectedChange={(v) => setView({ showAffix: v })}>
              Префикс / суффикс
            </Chip>
            <Chip selected={groupByAffix} onSelectedChange={(v) => setView({ groupByAffix: v })}>
              По типу
            </Chip>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
            <ModColumn side="AVOID" title="Исключить" preset={preset} index={index} view={view} onToggle={toggle("AVOID")} />
            <ModColumn
              side="WANT"
              title="Нужные"
              preset={preset}
              index={index}
              view={view}
              onToggle={toggle("WANT")}
              aside={
                <Select
                  aria-label="Совпадение нужных модов"
                  value={preset.wantMode}
                  onValueChange={(wantMode) => updatePreset(preset.id, (p) => ({ ...p, wantMode: wantMode as WantMode }))}
                  options={WANT_MODES}
                  className="h-7 w-28"
                />
              }
            />
          </div>
        </>
      ) : (
        <NotReady state={search.status === "ready" ? { status: "loading" } : search} />
      )}
    </Page>
  );
}

function NotReady({ state }: { state: { status: "loading" | "missing" | "unavailable" } | { status: "error"; message: string } }) {
  const center = (icon: LucideIcon, title: string, text: string, action?: React.ReactNode) => (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={icon} title={title} action={action} className="max-w-md">
        {text}
      </EmptyState>
    </div>
  );
  switch (state.status) {
    case "loading":
      return center(LoaderCircle, "Загружаем моды карт…", "Они приходят вместе с набором данных.");
    case "missing":
      return center(
        CloudDownload,
        "Нужен свежий набор данных",
        "В текущем наборе данных ещё нет модов карт. Новый набор скачивается сам — или проверьте сейчас.",
        <Button icon={RefreshCw} onClick={checkDatasetNow}>
          Проверить сейчас
        </Button>,
      );
    case "error":
      return center(TriangleAlert, "Обновите приложение", `Моды карт в наборе данных — в формате новее этой версии приложения. ${state.message}`);
    case "unavailable":
      return center(Monitor, "Доступно в приложении", "В браузере нет ядра с набором данных — откройте вкладку в poe-manager.");
  }
}
