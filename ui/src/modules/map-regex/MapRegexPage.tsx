import { useMemo, useState } from "react";
import { ClipboardCopy, CloudDownload, Ellipsis, Import, LoaderCircle, Monitor, Pencil, Plus, RefreshCw, Trash, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button, Chip, EmptyState, IconButton, Menu, Page, SegmentedControl, Select, toast, type MenuEntry } from "@/design-system";
import { checkDatasetNow } from "@/app/dataset";
import { activeOptions, applyParsed, resetAll, resetChoices, toggleMod, type GameLang, type MapRegexPreset, type ModChoice, type WantMode } from "./model";
import { buildExpression, EXPRESSION_MAX, isError } from "./regex";
import { ExpressionCard, ModColumn } from "./parts";
import { MapOptions } from "./options";
import { ConfirmDialog, ImportExpressionDialog, ImportPresetsDialog, PresetDialog } from "./dialogs";
import { exportPresets } from "./backup";
import { createPreset, deletePreset, DRAFT_ID, importPresets, updatePreset, useActivePreset, useMapRegexPresets, useMapRegexView, usePresetsSync } from "./store";
import { useMapSearch } from "./useMapSearch";

const LANGS: { value: GameLang; label: string }[] = [
  { value: "RU", label: "RU" },
  { value: "EN", label: "EN" },
];

type OpenDialog = { kind: "new" } | { kind: "rename" } | { kind: "delete" } | { kind: "reset-all" } | { kind: "import" } | { kind: "import-presets" } | null;

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

  // Параметры карт не помещаются над колонками без прокрутки окна — показываются вместо них.
  const [tab, setTab] = useState<"mods" | "options">("mods");
  const optionsCount = index ? activeOptions(preset, index) : 0;

  const change = (fn: (p: MapRegexPreset) => MapRegexPreset) => updatePreset(preset.id, fn);
  const toggle = (choice: ModChoice) => (modId: string) => change((p) => toggleMod(p, modId, choice));

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

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);
  const isDraft = preset.id === DRAFT_ID;
  const hasChoices = Object.keys(preset.mods).length > 0;
  const hasOptions = JSON.stringify(resetAll(preset)) !== JSON.stringify(resetChoices(preset));

  const exportAll = async () => {
    if (!presets?.length) return;
    try {
      await navigator.clipboard.writeText(exportPresets(presets));
      toast({ status: "success", title: `Наборы скопированы: ${presets.length}`, description: "Сохраните текст в файл — восстановить можно через «Импорт наборов»." });
    } catch (e) {
      toast({ status: "danger", title: "Не удалось скопировать", description: String(e) });
    }
  };

  const menu: MenuEntry[] = [
    { label: "Новый набор", icon: Plus, onSelect: () => setDialog({ kind: "new" }) },
    { label: "Переименовать", icon: Pencil, onSelect: () => setDialog({ kind: "rename" }) },
    { type: "separator" },
    { label: "Импорт наборов…", icon: Import, onSelect: () => setDialog({ kind: "import-presets" }) },
    { label: "Экспорт наборов", icon: ClipboardCopy, disabled: !presets?.length, onSelect: () => void exportAll() },
    { type: "separator" },
    { label: "Удалить набор", icon: Trash, disabled: isDraft, onSelect: () => setDialog({ kind: "delete" }) },
  ];

  const options = (presets?.length ? presets : [preset]).map((p) => ({ value: p.id, label: p.name, hint: p.id === DRAFT_ID ? "не сохранён" : undefined }));

  return (
    <Page
      title="RegEx карт"
      subtitle="Моды карт → строка поиска во вкладке сундука"
      actions={
        <>
          <Select aria-label="Набор" value={preset.id} onValueChange={setActivePreset} options={options} className="w-48" disabled={!presets} />
          <Menu align="end" items={menu} trigger={<IconButton icon={Ellipsis} label="Действия с набором" disabled={!presets} />} />
          <SegmentedControl
            aria-label="Язык клиента игры"
            value={preset.lang}
            onValueChange={(lang) => change((p) => ({ ...p, lang }))}
            options={LANGS}
          />
        </>
      }
    >
      {search.status === "ready" && expression && index && presets ? (
        <>
          <ExpressionCard
            expression={expression}
            index={index}
            lang={preset.lang}
            onCopy={() => void copy()}
            onPaste={() => setDialog({ kind: "import" })}
            onResetChoices={hasChoices ? () => change(resetChoices) : null}
            onResetAll={hasChoices || hasOptions ? () => setDialog({ kind: "reset-all" }) : null}
          />

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label="Что настраивать"
              value={tab}
              onValueChange={setTab}
              options={[
                { value: "mods", label: "Моды" },
                { value: "options", label: optionsCount ? `Параметры карт · ${optionsCount}` : "Параметры карт" },
              ]}
            />
            {tab === "mods" && (
              <>
                <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden />
                <Chip selected={showNightmare} onSelectedChange={(v) => setView({ showNightmare: v })}>
                  Nightmare
                </Chip>
                <Chip selected={showAffix} onSelectedChange={(v) => setView({ showAffix: v })}>
                  Префикс / суффикс
                </Chip>
                <Chip selected={groupByAffix} onSelectedChange={(v) => setView({ groupByAffix: v })}>
                  По типу
                </Chip>
              </>
            )}
          </div>

          {tab === "options" ? (
            <MapOptions preset={preset} index={index} onChange={change} />
          ) : (
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
                    onValueChange={(wantMode) => change((p) => ({ ...p, wantMode: wantMode as WantMode }))}
                    options={WANT_MODES}
                    className="h-7 w-28"
                  />
                }
              />
            </div>
          )}
        </>
      ) : (
        <NotReady state={search.status === "ready" ? { status: "loading" } : search} />
      )}

      {dialog?.kind === "import" && index && (
        <ImportExpressionDialog
          preset={preset}
          index={index}
          onApply={(parsed) => {
            change((p) => applyParsed(p, parsed));
            toast({
              status: parsed.unmatched.length || parsed.conflicts.length ? "warning" : "success",
              title: `Распознано частей строки: ${parsed.recognized}`,
              description: parsed.unmatched.length ? `Не распознано: ${parsed.unmatched.length}.` : undefined,
            });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "import-presets" && (
        <ImportPresetsDialog
          existing={presets?.length ?? 0}
          onImport={(backup, replace) =>
            void importPresets(backup.presets, replace, backup.activeIndex).then(
              (count) => toast({ status: "success", title: `Импортировано наборов: ${count}`, description: backup.unknownMods ? `Не распознано модов: ${backup.unknownMods}.` : undefined }),
              (e: unknown) => toast({ status: "danger", title: "Импорт не завершён", description: String(e) }),
            )
          }
          onClose={close}
        />
      )}
      {dialog?.kind === "new" && <PresetDialog name={null} onSave={(name) => void createPreset(name, preset.lang)} onClose={close} />}
      {dialog?.kind === "rename" && <PresetDialog name={preset.name} onSave={(name) => change((p) => ({ ...p, name }))} onClose={close} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Удалить набор «${preset.name}»?`}
          description={presets && presets.length > 1 ? "Набор удалится на всех устройствах вашего аккаунта." : "Это последний набор: на вкладке останется пустой «Мой первый набор»."}
          confirmLabel="Удалить набор"
          onConfirm={() => void deletePreset(preset.id)}
          onClose={close}
        />
      )}
      {dialog?.kind === "reset-all" && (
        <ConfirmDialog
          title="Сбросить всё?"
          description={`Снимутся отметки модов и все параметры карт набора «${preset.name}». Название и язык игры останутся.`}
          confirmLabel="Сбросить всё"
          onConfirm={() => change(resetAll)}
          onClose={close}
        />
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
