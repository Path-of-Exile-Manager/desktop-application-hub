import { useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { Button, Card, CardHeader, CardSection, Field, Input, StatusIcon, Switch, toast } from "@/design-system";
import { useShell } from "@/app/store";
import { inTauri } from "@/app/window";
import { agoText, clock } from "@/modules/bosses/journal";
import { pickLogFile, useFarmLog, type FarmLogStatus } from "@/modules/bosses/runs";

// Настройки → «Лог игры» (shared/docs/boss-farm.md, 7.3): заходы к боссам из Client.txt для журнала
// «Фарм → Боссы» и профиля «По логу». Путь — сам (рядом с exe запущенной игры, иначе из папок
// установки) или свой; имя персонажа — чьи смерти считать (решение 13).

const SOURCE_LABEL: Record<NonNullable<FarmLogStatus["pathSource"]>, string> = {
  manual: "выбран вручную",
  game: "рядом с запущенной игрой",
  installed: "из папки установки",
};

function describe(status: FarmLogStatus | null, now: number): { tone: "success" | "info" | "warning" | "danger"; text: string } {
  if (!inTauri) return { tone: "info", text: "Лог читает ядро приложения" };
  if (!status) return { tone: "info", text: "Загрузка…" };
  switch (status.state) {
    case "off":
      return { tone: "info", text: "Выключено" };
    case "searching":
      return { tone: "warning", text: "Client.txt не найден: запустите игру или выберите файл" };
    case "waiting":
      return { tone: "warning", text: "Файла пока нет — ждём, когда игра его создаст" };
    case "error":
      return { tone: "danger", text: status.error ?? "Лог не читается" };
    case "reading":
      return {
        tone: "success",
        text: status.lastLineAt ? `Читается · последняя строка ${agoText(status.lastLineAt, now)}` : "Читается · новых строк ещё не было",
      };
  }
}

export function FarmLogCard() {
  const farmLog = useShell((s) => s.farmLog);
  const setFarmLog = useShell((s) => s.setFarmLog);
  const status = useFarmLog((s) => s.status);
  const [character, setCharacter] = useState(farmLog.character);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setCharacter(farmLog.character), [farmLog.character]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const state = describe(status, now);
  const autoPath = status?.pathSource !== "manual" ? status?.path : null;
  const run = status?.run;

  const choose = () =>
    pickLogFile(farmLog.path ?? status?.path ?? null).then(
      (path) => path && setFarmLog({ path }),
      (e: unknown) => toast({ status: "warning", title: "Окно выбора файла не открылось", description: String(e) }),
    );

  return (
    <Card>
      <CardHeader title="Лог игры" aside={<Switch aria-label="Читать лог игры" checked={farmLog.enabled} onCheckedChange={(enabled) => setFarmLog({ enabled })} />} />
      <CardSection className="flex flex-col gap-4">
        <p className="text-label text-text-secondary">
          «Фарм → Боссы»: приложение читает Client.txt и само записывает заходы к боссам в журнал — длительность, смерти, время между боями. После захода
          приходит уведомление «Записать дроп?», а профиль «По логу» берёт TTK из этих заходов. Файл только читается.
        </p>
        <Field label="Файл Client.txt" hint={farmLog.path ? "Свой путь — вместо найденного автоматически" : autoPath ? `Найден ${status?.pathSource ? SOURCE_LABEL[status.pathSource] : ""}` : "Ищется сам: рядом с запущенной игрой, иначе в папках установки"}>
          {({ id, describedBy }) => (
            <div className="flex gap-2">
              <Input
                id={id}
                aria-describedby={describedBy}
                value={farmLog.path ?? ""}
                placeholder={autoPath ?? "авто"}
                onChange={(e) => setFarmLog({ path: e.target.value.trim() ? e.target.value : null })}
                className="min-w-0 flex-1 font-mono text-label"
                disabled={!farmLog.enabled}
              />
              <Button icon={FolderOpen} variant="secondary" onClick={() => void choose()} disabled={!inTauri || !farmLog.enabled}>
                Выбрать…
              </Button>
              {farmLog.path && (
                <Button icon={RotateCcw} variant="ghost" onClick={() => setFarmLog({ path: null })}>
                  Авто
                </Button>
              )}
            </div>
          )}
        </Field>
        <Field label="Имя персонажа" hint="Считаются смерти только этого персонажа; пусто — все смерти в арене (в группе — и чужие)">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={character}
              placeholder="Kirra_Witch"
              maxLength={40}
              onChange={(e) => setCharacter(e.target.value)}
              onBlur={() => setFarmLog({ character: character.trim() })}
              onKeyDown={(e) => e.key === "Enter" && setFarmLog({ character: character.trim() })}
              className="w-60"
              disabled={!farmLog.enabled}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1 text-label text-text-secondary">
          <p className="flex items-center gap-2">
            <StatusIcon status={state.tone} />
            {state.text}
          </p>
          {status?.path && status.state !== "off" && <p className="truncate font-mono text-caption" title={status.path}>{status.path}</p>}
          {status && status.state !== "off" && status.arenas === 0 && <p className="text-status-warning-fg">В наборе данных нет таблицы боссов — заходы не распознаются</p>}
          {run && (
            <p>
              Сейчас: {run.bossName.ru ?? run.bossName.en}, {run.awaySince ? "вне арены" : `бой ${clock(Math.max(0, (now - run.startedAt) / 1000 - run.pausedSec))}`}
              {run.deaths > 0 && `, смертей ${run.deaths}`}
            </p>
          )}
        </div>
      </CardSection>
    </Card>
  );
}
