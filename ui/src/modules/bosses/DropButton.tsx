import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PackagePlus } from "lucide-react";
import { Button } from "@/design-system";
import { inTauri } from "@/app/window";
import type { FarmDropTarget } from "@/generated/FarmDropTarget";
import { agoText } from "./journal";

// Быстрый дроп (shared/docs/boss-farm.md, 7.4): Ctrl+Alt+C на предмете из таблицы босса открытого захода
// или захода, закончившегося меньше 10 минут назад, — кнопка «В дроп: <Босс> (3 мин назад)» в окне
// Price check. Нажатие добавляет 1 шт. в запись этого захода (у открытого — в запись, которая появится).

/** `itemId` — запись справочника пойманного предмета; нет — кнопки нет. */
export function BossDropButton({ itemId, block }: { itemId: string | null | undefined; block?: boolean }) {
  const [target, setTarget] = useState<FarmDropTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ itemId: string; qty: number } | null>(null);

  useEffect(() => {
    setAdded(null);
    if (!inTauri || !itemId) return setTarget(null);
    let alive = true;
    const check = () => invoke<FarmDropTarget | null>("farm_drop_target", { itemId }).then((t) => alive && setTarget(t), () => alive && setTarget(null));
    void check();
    const unlisteners = [listen("farm-run", () => void check()), listen("boss-run-finished", () => void check())];
    return () => {
      alive = false;
      unlisteners.forEach((p) => void p.then((fn) => fn()));
    };
  }, [itemId]);

  if (!target || !itemId) return null;
  const name = target.bossName.ru ?? target.bossName.en;
  const when = target.running ? "идёт заход" : agoText(target.at);
  const qty = added?.itemId === itemId ? added.qty : target.qty;

  return (
    <Button
      variant="secondary"
      icon={PackagePlus}
      block={block}
      disabled={busy}
      title={qty > 0 ? `Уже в дропе: ${qty} шт. Нажмите, чтобы добавить ещё одну.` : "Добавить 1 шт. в дроп этого захода"}
      onClick={() => {
        setBusy(true);
        invoke<FarmDropTarget>("farm_add_drop", { itemId })
          .then((t) => {
            setTarget(t);
            setAdded({ itemId, qty: t.qty });
          })
          .catch(() => setTarget(null))
          .finally(() => setBusy(false));
      }}
    >
      В дроп: {name} ({when}){qty > 0 ? ` · ${qty} шт.` : ""}
    </Button>
  );
}
