import type { ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cx } from "../lib/cx";

// Компоненты ассистента крафта (components.md, п. 23–24).
// Ассистент только считает и подсказывает: никаких кнопок автоматизации действий в игре.

export type VerdictProps = {
  /** `continue` — продолжай (акцент), `done` — цель достигнута (success). */
  state: "continue" | "done";
  title: ReactNode;
  /** Сводка условий: `<CheckMark ok>Life T2</CheckMark> · <CheckMark ok={false}>ES T4</CheckMark>`. */
  summary?: ReactNode;
  hint?: ReactNode;
  /** Справа: например, «Возможные ответы». */
  aside?: ReactNode;
  className?: string;
};

/** Вердикт: плашка во всю ширину, круг 36 со стрелкой или галочкой, заголовок 20 bold. */
export function Verdict({ state, title, summary, hint, aside, className }: VerdictProps) {
  const done = state === "done";
  const Icon = done ? Check : ArrowRight;
  return (
    <div
      role="status"
      className={cx(
        "flex flex-wrap items-center gap-4 rounded-lg border px-4.5 py-3.5",
        done ? "border-status-success-border bg-status-success-bg" : "border-accent-border bg-accent-subtle-strong",
        className,
      )}
    >
      <span
        className={cx(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-text-on-accent",
          done ? "bg-status-success-fg" : "bg-accent-solid",
        )}
      >
        <Icon aria-hidden size={22} strokeWidth={2.5} />
      </span>
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <p className="text-number-lg leading-6 font-bold text-text-primary">{title}</p>
        {summary && <p className="text-body text-text-secondary">{summary}</p>}
        {hint && <p className="text-label text-text-secondary">{hint}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Отметка условия в тексте: `Life T2 ✓` (success) / `ES T4 ✗` (danger). */
export function CheckMark({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cx("font-semibold", ok ? "text-status-success-fg" : "text-status-danger-fg")}>
      {children} {ok ? "✓" : "✗"}
    </span>
  );
}

export type ConditionStatus = "ok" | "fail" | "pending";

const CONDITION = {
  ok: { mark: "✓", marker: "bg-status-success-fg/16 text-status-success-fg", value: "text-status-success-fg", label: "выполнено" },
  fail: { mark: "✗", marker: "bg-status-danger-fg/16 text-status-danger-fg", value: "text-status-danger-fg", label: "не выполнено" },
  pending: { mark: "·", marker: "bg-bg-hover text-text-secondary", value: "text-text-secondary", label: "ожидает" },
} as const;

export type GoalConditionProps = {
  status: ConditionStatus;
  /** Текст мода: `+# to maximum Energy Shield`. */
  title: ReactNode;
  /** Требование: `тир T1–T2`. */
  requirement: ReactNode;
  /** Текущее значение справа: `сейчас T4`. */
  current?: ReactNode;
};

/** Условие цели: маркер 22 (✓/✗/·), текст и требование, справа текущее значение цветом статуса. */
export function GoalCondition({ status, title, requirement, current }: GoalConditionProps) {
  const c = CONDITION[status];
  return (
    <div className="flex items-center gap-3 border-t border-border-subtle px-4 py-1.75">
      <span
        aria-label={c.label}
        className={cx("inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-label font-bold", c.marker)}
      >
        {c.mark}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-text-primary">{title}</span>
        <span className="text-label text-text-secondary">{requirement}</span>
      </div>
      {current && <span className={cx("shrink-0 text-label", c.value)}>{current}</span>}
    </div>
  );
}

export type PlanStepState = "done" | "current" | "pending";

const STEP = {
  done: { ring: "border-status-success-fg text-status-success-fg", chip: "border-status-success-fg text-status-success-fg", label: "✓ выполнен" },
  current: { ring: "border-accent-solid bg-accent-solid text-text-on-accent", chip: "border-accent-solid text-text-accent", label: "→ текущий" },
  pending: { ring: "border-border-strong text-text-secondary", chip: "border-border-default text-text-secondary", label: "ожидает" },
} as const;

export type PlanStepProps = {
  index: number;
  state: PlanStepState;
  title: ReactNode;
  /** Шанс за попытку: `~8%`. */
  chance: string;
  /** Цена попытки: `~4 c`. */
  cost: string;
  /** Ожидаемое число попыток: `~12 попыток`. */
  attempts: string;
};

/** Шаг плана: номер в круге 26, название 14 semibold, шанс · цена · попытки, справа тег состояния. */
export function PlanStep({ index, state, title, chance, cost, attempts }: PlanStepProps) {
  const s = STEP[state];
  return (
    <div
      aria-current={state === "current" ? "step" : undefined}
      className={cx("flex items-center gap-3 border-t border-border-subtle px-4 py-2.5", state === "current" && "bg-accent-subtle-strong")}
    >
      <span className={cx("inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border font-mono text-label font-semibold", s.ring)}>
        {index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body font-semibold text-text-primary">{title}</span>
        <span className="truncate text-label text-text-secondary">
          шанс <Num>{chance}</Num> · попытка <Num>{cost}</Num> · <Num>{attempts}</Num>
        </span>
      </div>
      <span className={cx("shrink-0 rounded-sm border px-1.75 text-label leading-5 whitespace-nowrap", s.chip)}>{s.label}</span>
    </div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono font-semibold text-text-primary">{children}</span>;
}

/** Итог плана — строка на bg.raised: «Итого ожидаемо ~60 chaos», справа «потрачено · попыток». */
export function PlanTotal({ expected, aside }: { expected: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-default bg-bg-raised px-4 py-3.5">
      <span className="text-body text-text-primary">
        Итого ожидаемо <span className="font-mono text-body-lg font-semibold">{expected}</span>
      </span>
      {aside && <span className="text-label text-text-secondary">{aside}</span>}
    </div>
  );
}
