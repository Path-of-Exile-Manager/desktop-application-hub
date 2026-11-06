import { Info } from "lucide-react";
import {
  AffixBadge,
  Button,
  Card,
  CardHeader,
  CheckMark,
  GoalCondition,
  ModText,
  Page,
  PlanStep,
  PlanTotal,
  TierBadge,
  Verdict,
  cx,
  toast,
  type Affix,
  type ConditionStatus,
  type ModSegment,
  type PlanStepState,
} from "@/design-system";
import { useShell } from "@/app/store";
import { DOOM_SHELL } from "../demo-data";

const GOAL: { status: ConditionStatus; title: string; requirement: string; current: string }[] = [
  { status: "fail", title: "+# to maximum Energy Shield", requirement: "тир T1–T2", current: "сейчас T4" },
  { status: "ok", title: "+# to maximum Life", requirement: "тир T1–T2", current: "сейчас T2" },
  { status: "pending", title: "Два сопротивления", requirement: "любые, тир ≥ T3", current: "ждёт шага 3" },
];

const LAST_CHECK: { affix: Affix; segments: ModSegment[]; tier: number; mark?: { ok: boolean; text: string } }[] = [
  { affix: "prefix", segments: [{ value: "+84", range: [80, 89] }, " to maximum Life"], tier: 2, mark: { ok: true, text: "✓ цель" } },
  { affix: "prefix", segments: [{ value: "+64", range: [59, 68] }, " to maximum Energy Shield"], tier: 4, mark: { ok: false, text: "✗ мало" } },
  { affix: "suffix", segments: [{ value: "+21", range: [18, 23] }, "% to Chaos Resistance"], tier: 4 },
];

const PLAN: { state: PlanStepState; title: string; chance: string; cost: string; attempts: string }[] = [
  { state: "done", title: "Essence of Greed → гарантированно Life", chance: "100%", cost: "~4 c", attempts: "1 попытка" },
  { state: "current", title: "Реролл до ES T1–T2", chance: "~8%", cost: "~4 c", attempts: "~12 попыток" },
  { state: "pending", title: "Верстак: два сопротивления", chance: "100%", cost: "~8 c", attempts: "1 попытка" },
];

/**
 * Ассистент крафта (экран A2). Только расчёт и подсказки: никаких кнопок автоматизации.
 * Ведёт свои попытки отдельно от текущего предмета; основу берут кнопкой «Взять текущий предмет».
 */
export function CraftExample() {
  const { hotkeys } = useShell();
  const currentItem = DOOM_SHELL;
  return (
    <Page
      title="Ассистент крафта"
      subtitle="Считает шансы и план. Все действия в игре выполняете вы."
      actions={
        <>
          <Button variant="ghost">Изменить цель</Button>
          <Button
            variant="secondary"
            disabled={!currentItem}
            onClick={() => toast({ status: "info", title: "Основа обновлена", description: currentItem?.baseType })}
          >
            Взять текущий предмет
          </Button>
        </>
      }
    >
      <Verdict
        state="continue"
        title="Продолжай · шаг 2"
        summary={
          <>
            <CheckMark ok>Life T2</CheckMark> · <CheckMark ok={false}>ES T4</CheckMark> — нужен ES T1–T2
          </>
        }
        hint={
          <>
            Сделайте следующую попытку в игре и нажмите{" "}
            <span className="font-mono text-text-primary">{hotkeys.check.join(" + ")}</span> на предмете.
          </>
        }
        aside={
          <div className="flex flex-col gap-1.5 text-label">
            <span className="text-text-secondary">Возможные ответы</span>
            <div className="flex gap-1.5">
              <span className="rounded-sm border border-border-default px-2 leading-5.5 text-text-muted">✓ Цель достигнута</span>
              <span className="rounded-sm bg-accent-solid px-2 leading-5.5 font-semibold text-text-on-accent">→ Продолжай</span>
            </div>
          </div>
        }
      />

      <div className="flex min-h-0 flex-wrap items-start gap-4">
        <div className="flex min-w-0 grow basis-75 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Цель"
              aside={
                <>
                  Vaal Regalia · iLvl <span className="font-mono">84</span>
                </>
              }
              className="border-b-0"
            />
            {GOAL.map((g) => (
              <GoalCondition key={g.title} {...g} />
            ))}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Последняя проверка" aside="14:41 · попытка 2" className="border-b-0" />
            {LAST_CHECK.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5 border-t border-border-subtle px-4 py-2">
                <AffixBadge affix={r.affix} />
                <span className="min-w-0 flex-1 text-body">
                  <ModText segments={r.segments} />
                </span>
                <TierBadge tier={r.tier} />
                <span
                  className={cx(
                    "w-13 shrink-0 text-right text-label font-semibold",
                    r.mark?.ok ? "text-status-success-fg" : "text-status-danger-fg",
                  )}
                >
                  {r.mark?.text}
                </span>
              </div>
            ))}
          </Card>
        </div>

        <Card className="min-w-0 grow basis-75 overflow-hidden">
          <CardHeader title="План" aside="предложен ассистентом" className="border-b-0" />
          {PLAN.map((s, i) => (
            <PlanStep key={s.title} index={i + 1} {...s} />
          ))}
          <PlanTotal
            expected="~60 chaos"
            aside={
              <>
                потрачено <span className="font-mono">~8</span> · попыток <span className="font-mono">2</span>
              </>
            }
          />
        </Card>
      </div>

      <p className="flex shrink-0 items-center gap-2.5 text-label text-text-secondary">
        <Info aria-hidden size={16} className="shrink-0" />
        Ассистент ничего не нажимает в игре: одна клавиша — одно ваше действие.
      </p>
    </Page>
  );
}
