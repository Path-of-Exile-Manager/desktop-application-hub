import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ClipboardPaste, Copy, Eraser, Link2, RotateCcw, SearchX, Trash2, X } from "lucide-react";
import {
  AffixBadge,
  Badge,
  Banner,
  Button,
  IconButton,
  Card,
  CardHeader,
  EmptyState,
  Popover,
  SearchInput,
  STATUS_CLASSES,
  StatusIcon,
  cx,
  type Status,
} from "@/design-system";
import { describeIssue, entryLabel, humanizeKey, markMods, modText, searchKey, unmarkMod, type GameLang, type MapRegexPreset, type MapSearchIndex, type MapSearchMod, type ModChoice } from "./model";
import { EXPRESSION_MAX, isError, type BlockKind, type Expression, type ExpressionIssue } from "./regex";

/** Подсветка блоков выражения по смыслу. */
const PART_STYLE: Record<BlockKind, { className: string; label: string }> = {
  avoid: { className: "text-status-danger-fg", label: "Исключить моды" },
  want: { className: "text-text-accent", label: "Нужные моды" },
  number: { className: "text-game-rarity-magic", label: "Пороги наград и качества" },
  "flag-include": { className: "text-status-success-fg", label: "Состояние, редкость, типы карт — только" },
  "flag-exclude": { className: "text-status-warning-fg", label: "Состояние, редкость, типы карт — кроме" },
};
const LEGEND: { kind: BlockKind; label: string }[] = [
  { kind: "avoid", label: "исключить" },
  { kind: "want", label: "нужные" },
  { kind: "number", label: "пороги" },
  { kind: "flag-include", label: "признаки" },
  { kind: "flag-exclude", label: "признаки «кроме»" },
];

/** Доля лимита, после которой полоса длины жёлтая. */
const LENGTH_WARN = 0.8;

export function ExpressionCard({
  expression,
  index,
  preset,
  onChange,
  onCopy,
  onPaste,
  onResetChoices,
  onResetAll,
}: {
  expression: Expression;
  index: MapSearchIndex;
  preset: MapRegexPreset;
  onChange: (change: (preset: MapRegexPreset) => MapRegexPreset) => void;
  onCopy: () => void;
  onPaste: () => void;
  /** `null` — сбрасывать нечего. */
  onResetChoices: (() => void) | null;
  onResetAll: (() => void) | null;
}) {
  const { text, parts, issues } = expression;
  const ratio = text.length / EXPRESSION_MAX;
  const tone: Status = ratio > 1 ? "danger" : ratio >= LENGTH_WARN ? "warning" : "success";
  const kinds = new Set(parts.map((p) => p.kind));

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
          </>
        }
      />
      <div className="flex flex-col gap-2 px-padding-x pb-3">
        <div className="flex items-stretch gap-3">
          <p
            className={cx(
              "min-h-11 min-w-0 flex-1 rounded-lg border-2 px-4 py-2 font-mono text-body-lg leading-relaxed break-all",
              text ? "border-accent-solid bg-bg-app select-all" : "border-dashed border-border-default text-text-muted select-none",
            )}
          >
            {text
              ? parts.map((part, i) => (
                  <span key={i} title={PART_STYLE[part.kind].label} className={PART_STYLE[part.kind].className}>
                    {i > 0 && " "}
                    {part.text}
                  </span>
                ))
              : "Отметьте моды ниже — здесь появится строка для поиска во вкладке сундука"}
          </p>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button variant="primary" icon={Copy} disabled={!text} onClick={onCopy} className="flex-1">
              Копировать
            </Button>
            <Button variant="ghost" icon={ClipboardPaste} onClick={onPaste} className="h-7 text-label" title="Вставить свою строку: моды и параметры отметятся по ней">
              Вставить строку
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-2" title="Лимит поля поиска в игре — 250 символов">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-bg-hover" aria-hidden>
              <span className={cx("block h-full rounded-full", STATUS_BG[tone])} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </span>
            <span className={cx("font-mono text-label", tone === "success" ? "text-text-secondary" : STATUS_CLASSES[tone].fg, tone === "danger" && "font-semibold")}>
              {text.length} / {EXPRESSION_MAX}
            </span>
          </div>
          {kinds.size > 0 && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
              {LEGEND.filter((l) => kinds.has(l.kind)).map((l) => (
                <span key={l.kind} className="flex items-center gap-1">
                  <span aria-hidden className={cx("size-2 rounded-full bg-current", PART_STYLE[l.kind].className)} />
                  {l.label}
                </span>
              ))}
            </span>
          )}
          <IssueChips issues={issues} index={index} preset={preset} onChange={onChange} />
        </div>
      </div>
    </Card>
  );
}

const STATUS_BG: Record<Status, string> = {
  success: "bg-status-success-fg",
  warning: "bg-status-warning-fg",
  danger: "bg-status-danger-fg",
  info: "bg-status-info-fg",
};

type IssueGroup = { key: string; status: Status; label: string; issues: ExpressionIssue[] };

/** Предупреждения выражения кнопками по видам; по клику — подробности и быстрые исправления. */
function IssueChips({ issues, index, preset, onChange }: { issues: ExpressionIssue[]; index: MapSearchIndex; preset: MapRegexPreset; onChange: (change: (preset: MapRegexPreset) => MapRegexPreset) => void }) {
  const overlaps = issues.filter((i): i is Extract<ExpressionIssue, { kind: "overlap" }> => i.kind === "overlap");
  const conflicts = overlaps.filter((o) => o.conflicts.length);
  const groups: IssueGroup[] = [];
  const errors = issues.filter((i) => isError(i));
  if (errors.length) groups.push({ key: "errors", status: "danger", label: `Ошибки: ${errors.length}`, issues: errors });
  if (overlaps.length)
    groups.push({
      key: "overlaps",
      status: conflicts.length ? "danger" : "warning",
      label: conflicts.length ? `Конфликты модов: ${conflicts.length}` : `Пересечения модов: ${overlaps.length}`,
      issues: [...conflicts, ...overlaps.filter((o) => !o.conflicts.length)],
    });
  const whole = issues.filter((i) => i.kind === "whole-line");
  if (whole.length) groups.push({ key: "whole", status: "info", label: "Строка целиком", issues: whole });
  const tooLong = issues.filter((i) => i.kind === "too-long");
  if (tooLong.length) groups.push({ key: "long", status: "danger", label: "Длиннее 250", issues: tooLong });
  if (!groups.length) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {groups.map((g) => (
        <Popover
          key={g.key}
          side="bottom"
          align="start"
          className="w-[26rem] p-3"
          trigger={
            <button
              type="button"
              className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-caption font-semibold", STATUS_CLASSES[g.status].fg, STATUS_CLASSES[g.status].bg, STATUS_CLASSES[g.status].border)}
            >
              <StatusIcon status={g.status} />
              {g.label}
            </button>
          }
        >
          <ul className="flex max-h-80 flex-col gap-2.5 overflow-y-auto text-label">
            {g.issues.map((issue, i) =>
              issue.kind === "overlap" ? (
                <OverlapItem key={i} issue={issue} index={index} preset={preset} onChange={onChange} />
              ) : (
                <li key={i} className="flex gap-2 text-text-secondary">
                  <StatusIcon status={isError(issue) ? "danger" : g.status} />
                  <span>{describeIssue(issue, index, preset.lang)}</span>
                </li>
              ),
            )}
          </ul>
        </Popover>
      ))}
    </span>
  );
}

/** Пересечение: какой мод что ещё захватывает и как это исправить одним нажатием. */
function OverlapItem({ issue, index, preset, onChange }: { issue: Extract<ExpressionIssue, { kind: "overlap" }>; index: MapSearchIndex; preset: MapRegexPreset; onChange: (change: (preset: MapRegexPreset) => MapRegexPreset) => void }) {
  const name = (id: string) => entryLabel(index, id, preset.lang);
  const avoid = issue.choice === "AVOID";
  const conflict = issue.conflicts.length > 0;
  return (
    <li className={cx("flex flex-col gap-1.5 rounded-md border p-2.5", conflict ? "border-status-danger-border bg-status-danger-bg" : "border-border-subtle")}>
      <p className="flex items-start gap-2">
        <span className={cx("mt-1 size-2 shrink-0 rounded-full", avoid ? "bg-status-danger-fg" : "bg-accent-solid")} aria-hidden />
        <span className="text-text-primary">
          <span className="text-text-muted">{avoid ? "Исключение " : "Нужный "}</span>«{name(issue.modId)}»
        </span>
      </p>
      <p className="pl-4 text-text-secondary">
        {avoid ? "отсеет и карты с:" : "подсветит и карты с:"}
      </p>
      <ul className="flex flex-col gap-0.5 pl-4">
        {issue.conflicts.map((id) => (
          <li key={id} className="text-status-danger-fg">
            «{name(id)}» <span className="text-caption">— {avoid ? "он у вас в нужных" : "он у вас в исключённых"}</span>
          </li>
        ))}
        {issue.extra.map((id) => (
          <li key={id} className="text-text-primary">
            «{name(id)}» <span className="text-caption text-text-muted">— не отмечен</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5 pl-4">
        {conflict ? (
          <Button variant="secondary" className="h-7 text-label" onClick={() => onChange((p) => unmarkMod(p, issue.modId))}>
            Снять «{shorten(name(issue.modId))}»
          </Button>
        ) : (
          <Button variant="secondary" className="h-7 text-label" onClick={() => onChange((p) => markMods(p, issue.extra, issue.choice))}>
            {avoid ? "Отметить их в исключённых" : "Отметить их в нужных"}
          </Button>
        )}
      </div>
    </li>
  );
}

function shorten(text: string): string {
  return text.length > 32 ? `${text.slice(0, 30)}…` : text;
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
  implied,
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
  /** Не отмеченные моды, которые захватит строка поиска отмеченного (impliedChoices). */
  implied: Map<string, { choice: ModChoice; via: string[] }>;
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
              <ModRow
                key={mod.id}
                mod={mod}
                lang={lang}
                side={side}
                choice={preset.mods[mod.id]}
                via={implied.get(mod.id)?.choice === side ? implied.get(mod.id)!.via.map((id) => entryLabel(index, id, lang)) : null}
                showAffix={view.showAffix || view.groupByAffix}
                onToggle={onToggle}
              />
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
  via,
  showAffix,
  onToggle,
}: {
  mod: MapSearchMod;
  lang: GameLang;
  side: ModChoice;
  choice: ModChoice | undefined;
  /** Мод не отмечен, но его захватит строка поиска этих модов (тексты). */
  via: string[] | null;
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
        title={via ? `${text}\n\nНе отмечен, но строка поиска «${via.join("», «")}» находит и его — карты с ним тоже ${side === "AVOID" ? "отсеются" : "подсветятся"}. Нажмите, чтобы отметить явно.` : text}
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
            selected
              ? side === "AVOID"
                ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                : "border-accent-solid bg-accent-subtle text-text-accent"
              : via
                ? cx("border-dashed", side === "AVOID" ? "border-status-danger-fg text-status-danger-fg" : "border-accent-solid text-text-accent")
                : "border-border-strong",
          )}
        >
          {selected && <Check size={12} strokeWidth={3} />}
          {via && <Link2 size={10} strokeWidth={2.5} />}
        </span>
        {showAffix && mod.affix !== "UNKNOWN" && <AffixBadge affix={mod.affix === "PREFIX" ? "prefix" : "suffix"} />}
        <span className={cx("min-w-0 flex-1 truncate text-body", elsewhere ? "text-text-muted" : "text-text-primary")}>{text}</span>
        {mod.tier === "NIGHTMARE" && (
          <Badge tone="muted" caps>
            Nightmare
          </Badge>
        )}
        {choice !== undefined && !selected && <span className="shrink-0 text-caption text-text-muted">{OTHER_SIDE[choice]}</span>}
        {via && <span className={cx("shrink-0 text-caption", side === "AVOID" ? "text-status-danger-fg" : "text-text-accent")}>захвачен</span>}
      </button>
    </li>
  );
}
