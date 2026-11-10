import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ClipboardPaste, Copy, Eraser, RotateCcw, SearchX, Trash2, X } from "lucide-react";
import {
  AffixBadge,
  Badge,
  Banner,
  Button,
  IconButton,
  Card,
  CardHeader,
  EmptyState,
  SearchInput,
  StatusIcon,
  cx,
} from "@/design-system";
import { describeIssue, humanizeKey, modText, searchKey, type GameLang, type MapRegexPreset, type MapSearchIndex, type MapSearchMod, type ModChoice } from "./model";
import { EXPRESSION_MAX, isError, type Expression } from "./regex";

export function ExpressionCard({
  expression,
  index,
  lang,
  onCopy,
  onPaste,
  onResetChoices,
  onResetAll,
}: {
  expression: Expression;
  index: MapSearchIndex;
  lang: GameLang;
  onCopy: () => void;
  onPaste: () => void;
  /** `null` — сбрасывать нечего. */
  onResetChoices: (() => void) | null;
  onResetAll: (() => void) | null;
}) {
  const { text, issues } = expression;
  const tooLong = text.length > EXPRESSION_MAX;
  // Одна строка — самая важная проблема; остальные в подсказке: блок не отнимает место у списков.
  // Пропавшие моды показывает свой блок с кнопками (StaleBanner) — здесь их не повторяем.
  const sorted = issues.filter((issue) => issue.kind !== "unknown-mods").sort((a, b) => Number(isError(b)) - Number(isError(a)));
  const first = sorted[0];
  const all = sorted.map((issue) => describeIssue(issue, index, lang)).join("\n");

  return (
    <Card className="shrink-0">
      <CardHeader
        title="Готовое выражение"
        aside={
          <>
            <Button variant="ghost" icon={Eraser} className="h-7 text-label" disabled={!onResetChoices} onClick={() => onResetChoices?.()} title="Снять отметки модов; параметры карт остаются">
              Сбросить выбор
            </Button>
            <Button variant="ghost" icon={RotateCcw} className="h-7 text-label" disabled={!onResetAll} onClick={() => onResetAll?.()} title="Моды и параметры карт">
              Сбросить всё
            </Button>
            <span className={cx("ml-2 font-mono", tooLong ? "font-semibold text-status-danger-fg" : "text-text-secondary")}>
              {text.length} / {EXPRESSION_MAX}
            </span>
          </>
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
          <Button variant="secondary" icon={ClipboardPaste} onClick={onPaste} title="Вставить свою строку: моды и параметры отметятся по ней">
            Вставить
          </Button>
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

const SHOWN_STALE = 3;

/**
 * Ключи набора, которых больше нет в наборе данных: мод или свойство ушли из игры (или сменили текст —
 * тогда это новое семейство с другим ключом). В выражение они не идут; убрать — по одному или все.
 */
export function StaleBanner({ mods, properties, onRemove }: { mods: string[]; properties: string[]; onRemove: (keys: string[]) => void }) {
  const all = [...mods, ...properties];
  if (!all.length) return null;
  const shown = all.slice(0, SHOWN_STALE);
  const rest = all.slice(SHOWN_STALE);
  return (
    <Banner
      status="warning"
      title={`Больше не встречается в игре: ${all.length}`}
      className="shrink-0"
      actions={
        <Button variant="secondary" icon={Trash2} onClick={() => onRemove(all)}>
          Убрать все
        </Button>
      }
    >
      <span className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
        <span className="shrink-0">В выражение не попадают.</span>
        {shown.map((key) => (
          <span key={key} className="inline-flex max-w-56 min-w-0 items-center gap-1 rounded-sm bg-bg-hover py-0.5 pr-0.5 pl-1.5 text-label text-text-primary" title={key}>
            <span className="truncate">{mods.includes(key) ? humanizeKey(key) : `параметр «${key}»`}</span>
            <IconButton icon={X} label={`Убрать ${humanizeKey(key)}`} tooltip={false} className="size-5" iconSize={12} onClick={() => onRemove([key])} />
          </span>
        ))}
        {rest.length > 0 && (
          <span className="shrink-0 text-label text-text-muted" title={rest.map(humanizeKey).join("\n")}>
            и ещё {rest.length}
          </span>
        )}
      </span>
    </Banner>
  );
}

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
  onClear,
}: {
  side: ModChoice;
  title: string;
  aside?: ReactNode;
  preset: MapRegexPreset;
  index: MapSearchIndex;
  view: ColumnView;
  onToggle: (modId: string) => void;
  /** Снять все отметки колонки. */
  onClear: () => void;
}) {
  const lang = preset.lang;
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);

  // «По типу» — сначала префиксы, потом суффиксы, с меткой P/S у каждой строки.
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

  // Другой поиск или вид — список с начала; отметка мода позицию прокрутки не трогает.
  // Тело в фигурных скобках: scrollTo в Chromium возвращает Promise, а React примет его за очистку.
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [query, lang, view.showNightmare, view.groupByAffix]);
  // Пропавшие из игры моды не считаются: в выражение они не идут (их показывает StaleBanner).
  const count = Object.entries(preset.mods).filter(([id, choice]) => choice === side && index.modById.has(id)).length;

  return (
    <Card className="min-h-0 min-w-0">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <Badge tone={count ? "neutral" : "muted"}>{count}</Badge>
          </span>
        }
        aside={
          <>
            <Button variant="ghost" icon={X} className="h-7 px-2 text-label" disabled={!count} onClick={onClear} title={`Снять все отметки в колонке «${title}»`}>
              Снять все
            </Button>
            {aside}
          </>
        }
      />
      <div className="px-padding-x pb-2">
        <SearchInput value={query} onValueChange={setQuery} label={`Поиск: ${title.toLowerCase()}`} placeholder="Поиск мода" />
      </div>
      {/* Прокрутка внутри колонки — решение пользователя 11.11.2026 (вместо страниц); окно не прокручивается. */}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rows.length ? (
          <ul className="flex flex-col">
            {rows.map((mod) => (
              <ModRow key={mod.id} mod={mod} lang={lang} side={side} choice={preset.mods[mod.id]} showAffix={view.showAffix || view.groupByAffix} onToggle={onToggle} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={SearchX} title="Модификаторы не найдены" className="p-4">
            Измените поиск или включите Nightmare-моды.
          </EmptyState>
        )}
      </div>
      <p className="shrink-0 border-t border-border-subtle px-padding-x py-1.5 text-caption text-text-muted">
        {rows.length === index.mods.length ? `${rows.length} модов` : `Найдено ${rows.length} из ${index.mods.length}`}
      </p>
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
