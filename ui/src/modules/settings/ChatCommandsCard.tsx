import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button, Card, CardHeader, CardSection, Checkbox, HotkeyInput, IconButton, Input } from "@/design-system";
import { useHotkeyProblems } from "@/app/hotkeys";
import { DEFAULT_CHAT_COMMANDS, useShell, type ChatCommandSetting } from "@/app/store";

/** Строка чата игры длиннее не бывает; запас — чтобы не обрезать имя после `@`. */
const TEXT_MAX = 200;

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

/**
 * Команды чата по горячим клавишам, как в Awakened PoE Trade: `/hideout` на F5 — телепорт в убежище,
 * `/exit` на F9 — выход к выбору персонажа и т. п. Набирает их ядро (src-tauri/src/chat.rs).
 */
export function ChatCommandsCard() {
  const commands = useShell((s) => s.chatCommands);
  const setCommands = useShell((s) => s.setChatCommands);
  const problems = useHotkeyProblems((p) => p.problems);

  const update = (id: string, patch: Partial<ChatCommandSetting>) => setCommands(commands.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => setCommands(commands.filter((c) => c.id !== id));
  const add = () => setCommands([...commands, { id: newId(), text: "", hotkey: [], send: true }]);
  const isDefault = JSON.stringify(commands) === JSON.stringify(DEFAULT_CHAT_COMMANDS);

  return (
    <Card>
      <CardHeader
        title="Команды чата"
        aside={
          <Button variant="ghost" icon={RotateCcw} className="h-7 text-label" disabled={isDefault} onClick={() => setCommands(DEFAULT_CHAT_COMMANDS)}>
            По умолчанию
          </Button>
        }
      />
      <CardSection className="flex flex-col gap-2">
        <p className="text-label text-text-secondary">
          Клавиша вписывает команду в чат игры, как в Awakened PoE Trade: <span className="font-mono text-text-primary">/hideout</span> — в убежище,{" "}
          <span className="font-mono text-text-primary">/exit</span> — к выбору персонажа. <span className="font-mono text-text-primary">@last</span> — тот, кто
          последним писал вам в личку. Работают, когда игра в фокусе.
        </p>
        <ul className="flex flex-col gap-2">
          {commands.map((c, i) => {
            const problem = problems.find((p) => p.command === i);
            return (
              <li key={c.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Команда ${i + 1}`}
                    value={c.text}
                    maxLength={TEXT_MAX}
                    placeholder="/hideout"
                    invalid={!!problem}
                    className="min-w-0 flex-1 font-mono"
                    onChange={(e) => update(c.id, { text: e.target.value })}
                  />
                  <HotkeyInput aria-label={`Клавиша команды ${c.text || i + 1}`} value={c.hotkey} onChange={(hotkey) => update(c.id, { hotkey })} className="w-36" />
                  <IconButton icon={X} label="Снять клавишу" disabled={c.hotkey.length === 0} onClick={() => update(c.id, { hotkey: [] })} />
                  <Checkbox checked={c.send} onCheckedChange={(send) => update(c.id, { send })} label="Отправить" />
                  <IconButton icon={Trash2} label={`Удалить команду ${c.text || i + 1}`} onClick={() => remove(c.id)} />
                </div>
                {problem && <p className="text-label text-status-danger-fg">{problem.message}</p>}
              </li>
            );
          })}
        </ul>
        <div>
          <Button variant="ghost" icon={Plus} onClick={add}>
            Добавить команду
          </Button>
        </div>
        <p className="text-caption text-text-secondary">Без «Отправить» команда только впишется в строку чата — допишите и нажмите Enter сами.</p>
      </CardSection>
    </Card>
  );
}
