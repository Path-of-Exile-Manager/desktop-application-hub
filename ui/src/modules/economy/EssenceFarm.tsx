import { Badge, cx, totalPriceText, Tooltip, usePriceDisplay } from "@/design-system";
import { essenceFamilies, UNBECOMING_EMOTION, type EconomyRow, type EssenceFamily } from "./economy";

// Что фармить узлом атласа Unbecoming Emotion («100% increased chance for Imprisoned Monsters to have
// certain Essences», выбор одной из шести): семьи эссенций по средней цене трёх верхних ступеней,
// которые попадаются в картах. Выбираемые узлом — с пометкой, лучшая из них — подсвечена.

const SHOWN_TIERS = ["Screaming", "Shrieking", "Deafening"] as const;

/** В таблице сравнения цены — числом (а не «N / c»), чтобы столбцы сравнивались. */
function usePlainPrice() {
  const { mode, divineChaos } = usePriceDisplay();
  return (chaos: number) => totalPriceText(chaos, divineChaos, mode);
}

function TierPrice({ row }: { row: EconomyRow | undefined }) {
  const text = usePlainPrice();
  if (!row) return <span className="text-text-muted">—</span>;
  return <span className={cx("font-mono", row.reliable ? "text-text-primary" : "text-status-warning-fg")}>{text(row.chaosValue)}</span>;
}

export function EssenceFarm({ rows, language, onOpen }: { rows: EconomyRow[]; language: "ru" | "en"; onOpen: (row: EconomyRow) => void }) {
  const text = usePlainPrice();
  const families = essenceFamilies(rows);
  const choosable = families.filter((f) => UNBECOMING_EMOTION.includes(f.family));
  const best = choosable[0];
  const ordered: EssenceFamily[] = [...choosable, ...families.filter((f) => !UNBECOMING_EMOTION.includes(f.family))];

  if (families.length === 0) return <p className="text-body text-text-secondary">В ценах лиги нет эссенций со ступенями.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-label text-text-secondary">
        Узел атласа <span className="text-text-primary">Unbecoming Emotion</span> — 100% шанс, что заключённые монстры будут с выбранной эссенцией (Woe, Greed,
        Doubt, Rage, Spite, Sorrow). Выгоднее та, у которой дороже верхние ступени — в картах выпадают Screaming, Shrieking и Deafening.
        {best && (
          <>
            {" "}
            Сейчас лучше всего: <span className="font-semibold text-status-success-fg">{best.family}</span>
            {best.score !== null && <> (в среднем {text(best.score)})</>}.
          </>
        )}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-subtle">
        <table className="w-full text-label">
          <thead className="sticky top-0 bg-bg-raised text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Эссенция</th>
              {SHOWN_TIERS.map((t) => (
                <th key={t} className="px-3 py-2 text-right font-medium">
                  {t}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">В среднем</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((f, i) => {
              const node = UNBECOMING_EMOTION.includes(f.family);
              const top = f.tiers.Deafening ?? f.tiers.Shrieking ?? f.tiers.Screaming;
              return (
                <tr
                  key={f.family}
                  onClick={() => top && onOpen(top)}
                  className={cx(
                    "cursor-pointer border-b border-border-subtle last:border-b-0 hover:bg-bg-hover",
                    f === best && "bg-status-success-bg",
                    !node && "text-text-secondary",
                    i === choosable.length && "border-t-2 border-t-border-strong",
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-text-secondary">{node ? choosable.indexOf(f) + 1 : ""}</td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span className={cx("font-semibold", node ? "text-text-primary" : "text-text-secondary")}>{f.family}</span>
                      {language === "ru" && top?.nameRu && <span className="text-caption text-text-secondary">{top.nameRu.replace(/^\S+\s/, "")}</span>}
                      {node && (
                        <Tooltip content="Можно выбрать в узле атласа Unbecoming Emotion">
                          <span>
                            <Badge tone="muted">атлас</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  {SHOWN_TIERS.map((t) => (
                    <td key={t} className="px-3 py-1.5 text-right">
                      <TierPrice row={f.tiers[t]} />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{f.score !== null ? text(f.score) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-secondary">Жёлтым — цена по малому числу лотов. Ниже черты — эссенции, которых нет в узле. Строка открывает старшую ступень.</p>
    </div>
  );
}
