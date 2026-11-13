import { Shirt, X } from "lucide-react";
import { Button, Card, CardHeader, CardSection, IconButton, StatusBadge, cx } from "@/design-system";
import type { Appraisal } from "@/app/appraise";
import { appraisalToItem } from "@/app/item-view";
import { equippedFrom, formatDps, formatGain, gain, isSameWeapon, useEquippedWeapon, weaponDps, type WeaponDps } from "@/app/weapon";

/** Урон пойманного оружия и сравнение с отмеченным как надетое. `dps === null` — не оружие. */
function useWeaponCompare(appraisal: Appraisal) {
  const equipped = useEquippedWeapon((s) => s.weapon);
  const setWeapon = useEquippedWeapon((s) => s.setWeapon);
  const dps = weaponDps(appraisal.item.weapon);
  const view = appraisalToItem(appraisal);
  const current = equippedFrom(appraisal, view.name ?? view.baseType);
  const same = !!equipped && !!current && isSameWeapon(equipped, current);
  return {
    dps,
    current,
    // С самим собой не сравниваем.
    equipped: same ? null : equipped,
    same,
    otherClass: !!equipped && !!current && equipped.itemClass !== current.itemClass,
    markEquipped: () => current && setWeapon(current),
    forget: () => setWeapon(null),
  };
}

/** Разница с надетым: «+12.3%», зелёным — прирост, красным — потеря. */
function Delta({ now, before, className }: { now: number; before: number; className?: string }) {
  const ratio = gain(now, before);
  if (ratio === null) return now > 0 ? <span className={cx("font-mono text-status-success-fg", className)}>новый урон</span> : null;
  if (Math.abs(ratio) < 0.0005) return <span className={cx("font-mono text-text-secondary", className)}>±0%</span>;
  return <span className={cx("font-mono", ratio > 0 ? "text-status-success-fg" : "text-status-danger-fg", className)}>{formatGain(ratio)}</span>;
}

const ROWS: { key: keyof Pick<WeaponDps, "physical" | "elemental" | "chaos" | "total">; label: string }[] = [
  { key: "total", label: "Всего DPS" },
  { key: "physical", label: "Физический" },
  { key: "elemental", label: "Стихийный" },
  { key: "chaos", label: "Хаос" },
];

/** Карточка «Урон» страницы Price check: DPS по видам урона и прирост к надетому. */
export function WeaponDamageCard({ appraisal, className }: { appraisal: Appraisal; className?: string }) {
  const { dps, equipped, same, otherClass, markEquipped, forget } = useWeaponCompare(appraisal);
  if (!dps) return null;
  const rows = ROWS.filter((r) => r.key === "total" || dps[r.key] > 0 || (equipped && equipped.dps[r.key] > 0));
  return (
    <Card className={className}>
      <CardHeader
        title="Урон"
        aside={
          same ? (
            <StatusBadge status="success">надето</StatusBadge>
          ) : (
            <Button variant="ghost" icon={Shirt} className="h-7 text-label" onClick={markEquipped}>
              Это надето
            </Button>
          )
        }
      />
      <CardSection>
        <dl className={cx("grid gap-x-4 gap-y-1.5 text-label", equipped ? "grid-cols-[1fr_max-content_max-content_max-content]" : "grid-cols-[1fr_max-content]")}>
          {equipped && (
            <div className="contents text-caption text-text-secondary">
              <span />
              <span className="text-right">этот</span>
              <span className="text-right">надето</span>
              <span className="text-right">прирост</span>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className={cx("text-text-secondary", r.key === "total" && "font-semibold text-text-primary")}>{r.label}</dt>
              <dd className={cx("text-right font-mono text-text-primary", r.key === "total" && "font-semibold")}>{formatDps(dps[r.key])}</dd>
              {equipped && (
                <>
                  <dd className="text-right font-mono text-text-secondary">{formatDps(equipped.dps[r.key])}</dd>
                  <dd className="text-right">
                    <Delta now={dps[r.key]} before={equipped.dps[r.key]} />
                  </dd>
                </>
              )}
            </div>
          ))}
        </dl>
      </CardSection>
      <CardSection className="flex flex-wrap gap-x-4 gap-y-1 text-label text-text-secondary">
        <span>
          Атак в секунду <span className="font-mono text-text-primary">{dps.attacksPerSecond.toFixed(2)}</span>
          {equipped && <span className="font-mono"> / {equipped.dps.attacksPerSecond.toFixed(2)}</span>}
        </span>
        {dps.critChance !== null && (
          <span>
            Крит <span className="font-mono text-text-primary">{dps.critChance.toFixed(2)}%</span>
            {equipped?.dps.critChance != null && <span className="font-mono"> / {equipped.dps.critChance.toFixed(2)}%</span>}
          </span>
        )}
      </CardSection>
      <CardSection className="flex items-center gap-2 text-label text-text-secondary">
        {equipped ? (
          <>
            <span className="min-w-0 flex-1 truncate">
              Сравнение с «{equipped.name}»{otherClass && <span className="text-status-warning-fg"> · другой тип оружия ({equipped.itemClass})</span>}
            </span>
            <IconButton icon={X} label="Забыть надетое" onClick={forget} />
          </>
        ) : same ? (
          <span>Это оружие отмечено как надетое — другое оружие будет сравниваться с ним.</span>
        ) : (
          <span>Чтобы видеть прирост, поймайте надетое оружие и нажмите «Это надето».</span>
        )}
      </CardSection>
    </Card>
  );
}

/** Строка урона в оверлее: DPS, его состав и прирост к надетому. */
export function WeaponDamageCompact({ appraisal }: { appraisal: Appraisal }) {
  const { dps, equipped, same, otherClass, markEquipped } = useWeaponCompare(appraisal);
  if (!dps) return null;
  const parts = [
    dps.physical > 0 && `физ ${formatDps(dps.physical)}`,
    dps.elemental > 0 && `стих ${formatDps(dps.elemental)}`,
    dps.chaos > 0 && `хаос ${formatDps(dps.chaos)}`,
    `${dps.attacksPerSecond.toFixed(2)} атак/с`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body">
          DPS <span className="font-mono font-semibold text-text-primary">{formatDps(dps.total)}</span>
          {equipped && <Delta now={dps.total} before={equipped.dps.total} className="ml-2 text-label" />}
        </span>
        {same ? (
          <span className="text-label text-status-success-fg">надето</span>
        ) : (
          <Button variant="ghost" icon={Shirt} className="h-6 px-2 text-label" onClick={markEquipped}>
            Это надето
          </Button>
        )}
      </div>
      <span className="text-label text-text-secondary">{parts.join(" · ")}</span>
      {equipped && (
        <span className="truncate text-label text-text-secondary">
          к «{equipped.name}» ({formatDps(equipped.dps.total)})
          {(equipped.dps.physical > 0 || dps.physical > 0) && (
            <>
              {" · физ "}
              <Delta now={dps.physical} before={equipped.dps.physical} />
            </>
          )}
          {otherClass && <span className="text-status-warning-fg"> · другой тип</span>}
        </span>
      )}
    </div>
  );
}
