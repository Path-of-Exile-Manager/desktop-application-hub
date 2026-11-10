import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, SearchX } from "lucide-react";
import {
  AffixBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Pagination,
  SearchInput,
  StatusIcon,
  cx,
  usePageSize,
} from "@/design-system";
import { describeIssue, modText, searchKey, type GameLang, type MapRegexPreset, type MapSearchIndex, type MapSearchMod, type ModChoice } from "./model";
import { EXPRESSION_MAX, isError, type Expression } from "./regex";

export function ExpressionCard({ expression, index, lang, onCopy }: { expression: Expression; index: MapSearchIndex; lang: GameLang; onCopy: () => void }) {
  const { text, issues } = expression;
  const tooLong = text.length > EXPRESSION_MAX;
  // Одна строка — самая важная проблема; остальные в подсказке: блок не отнимает место у списков.
  const sorted = [...issues].sort((a, b) => Number(isError(b)) - Number(isError(a)));
  const first = sorted[0];
  const all = sorted.map((issue) => describeIssue(issue, index, lang)).join("\n");

  return (
    <Card className="shrink-0">
      <CardHeader
        title="Готовое выражение"
        aside={
          <span className={cx("font-mono", tooLong ? "font-semibold text-status-danger-fg" : "text-text-secondary")}>
            {text.length} / {EXPRESSION_MAX}
          </span>
        }
      />
      <div className="flex flex-col gap-2 px-padding-x pb-3">
        <div className="flex items-start gap-3">
          <p
            className={cx(
              "min-h-9 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-app px-3 py-2 font-mono text-body break-all select-all",
              text ? "text-text-primary" : "text-text-muted select-none",
            )}
          >
            {text || "Отметьте моды ниже — здесь появится строка для поиска во вкладке сундука"}
          </p>
          <Button variant="primary" icon={Copy} disabled={!text} onClick={onCopy}>
            Копировать
          </Button>
        </div>
        {first && (
          <p className="flex min-w-0 items-center gap-2 text-label text-text-secondary" title={all}>
            <StatusIcon status={isError(first) ? "danger" : "warning"} />
            <span className="min-w-0 truncate">{describeIssue(first, index, lang)}</span>
            {sorted.length > 1 && <span className="shrink-0 text-text-muted">ещё {sorted.length - 1}</span>}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Высота строки списка = row-height (36): по ней считается размер страницы. */
const ROW_HEIGHT = 36;

export type ColumnView = { showNightmare: boolean; showAffix: boolean; groupByAffix: boolean };

const OTHER_SIDE: Record<ModChoice, string> = { AVOID: "в исключённых", WANT: "в нужных" };

export function ModColumn({
  side,
  title,
  aside,
  preset,
  index,
  view,
  onToggle,
}: {
  side: ModChoice;
  title: string;
  aside?: ReactNode;
  preset: MapRegexPreset;
  index: MapSearchIndex;
  view: ColumnView;
  onToggle: (modId: string) => void;
}) {
  const lang = preset.lang;
  const [query, setQuery] = useState("");
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);

  // «По типу» — сначала префиксы, потом суффиксы, с меткой P/S у каждой строки (без строк-заголовков:
  // счётчик страниц считает только моды).
  const rows = useMemo(() => {
    const needle = searchKey(query.trim());
    const locale = lang === "RU" ? "ru" : "en";
    return index.mods
      .filter((mod) => view.showNightmare || mod.tier !== "NIGHTMARE")
      .filter((mod) => !needle || searchKey(modText(mod, lang)).includes(needle) || searchKey(modText(mod, "EN")).includes(needle))
      .map((mod) => ({ mod, text: modText(mod, lang) }))
      .sort((a, b) => (view.groupByAffix ? affixRank(a.mod) - affixRank(b.mod) : 0) || a.text.localeCompare(b.text, locale))
      .map(({ mod }) => mod);
  }, [index, lang, query, view.showNightmare, view.groupByAffix]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => setPage(1), [query, lang, view.showNightmare, view.groupByAffix]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const count = Object.values(preset.mods).filter((choice) => choice === side).length;

  return (
    <Card className="min-h-0 min-w-0">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <Badge tone={count ? "neutral" : "muted"}>{count}</Badge>
          </span>
        }
        aside={aside}
      />
      <div className="px-padding-x pb-2">
        <SearchInput value={query} onValueChange={setQuery} label={`Поиск: ${title.toLowerCase()}`} placeholder="Поиск мода" />
      </div>
      <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {visible.length ? (
          <ul className="flex flex-col">
            {visible.map((mod) => (
              <ModRow key={mod.id} mod={mod} lang={lang} side={side} choice={preset.mods[mod.id]} showAffix={view.showAffix || view.groupByAffix} onToggle={onToggle} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={SearchX} title="Модификаторы не найдены" className="p-4">
            Измените поиск или включите Nightmare-моды.
          </EmptyState>
        )}
      </div>
      {rows.length > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} className="border-t border-border-subtle px-padding-x py-1.5" />
      )}
    </Card>
  );
}

function affixRank(mod: MapSearchMod): number {
  return mod.affix === "PREFIX" ? 0 : mod.affix === "SUFFIX" ? 1 : 2;
}

function ModRow({
  mod,
  lang,
  side,
  choice,
  showAffix,
  onToggle,
}: {
  mod: MapSearchMod;
  lang: GameLang;
  side: ModChoice;
  choice: ModChoice | undefined;
  showAffix: boolean;
  onToggle: (modId: string) => void;
}) {
  const selected = choice === side;
  const elsewhere = choice !== undefined && !selected;
  const text = modText(mod, lang);
  return (
    <li className="border-b border-border-subtle">
      <button
        type="button"
        aria-pressed={selected}
        title={text}
        onClick={() => onToggle(mod.id)}
        className={cx(
          "flex h-9 w-full min-w-0 items-center gap-2.5 px-padding-x text-left transition-colors",
          selected ? "bg-bg-active" : "hover:bg-bg-hover",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border",
            selected ? (side === "AVOID" ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg" : "border-accent-solid bg-accent-subtle text-text-accent") : "border-border-strong",
          )}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
        {showAffix && mod.affix !== "UNKNOWN" && <AffixBadge affix={mod.affix === "PREFIX" ? "prefix" : "suffix"} />}
        <span className={cx("min-w-0 flex-1 truncate text-body", elsewhere ? "text-text-muted" : "text-text-primary")}>{text}</span>
        {mod.tier === "NIGHTMARE" && (
          <Badge tone="muted" caps>
            Nightmare
          </Badge>
        )}
        {choice !== undefined && !selected && <span className="shrink-0 text-caption text-text-muted">{OTHER_SIDE[choice]}</span>}
      </button>
    </li>
  );
}
