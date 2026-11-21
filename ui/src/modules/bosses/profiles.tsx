import { useMemo, useRef, useState, type FormEvent } from "react";
import { Copy, CopyPlus, Ellipsis, FileJson, FileUp, Pencil, Plus, Trash } from "lucide-react";
import { Button, Dialog, Field, Input, Menu, Select, StatusIcon, Tooltip, cx, fieldClasses, toast, type MenuEntry } from "@/design-system";
import { LOG_MIN_RUNS, LOG_RUNS, useLogTimings } from "./journal";
import { plural } from "./model";
import {
  useBossesView,
  DEFAULT_PROFILE_NAME,
  DRAFT_ID,
  PROFILE_NAME_MAX,
  createProfile,
  deleteProfile,
  duplicateProfile,
  exportProfile,
  importProfile,
  parseProfileExport,
  renameProfile,
  selectProfile,
  useActiveProfile,
  useFarmProfiles,
  type FarmProfile,
} from "./store";

// Выбор профиля фарма в шапке вкладки и действия с ним: новый, дублировать, переименовать,
// экспорт/импорт JSON, удалить (как трекеры Ancient Orb и наборы RegEx карт).

type OpenDialog = { kind: "create" } | { kind: "duplicate" } | { kind: "rename" } | { kind: "transfer" } | { kind: "delete" } | null;

const NO_PROFILES: FarmProfile[] = [];
/** Значение пункта «По логу» в выборе профиля (у записей id — uuid). */
const LOG_VALUE = "__log";

const closeOn = (onClose: () => void) => (open: boolean) => !open && onClose();

const bossCount = (profile: FarmProfile) => Object.keys(profile.bosses).length;

/** Имя профиля: 1–40 символов, пробелы по краям срезаются. */
function NameDialog({ title, description, initial, submitLabel, onSave, onClose }: {
  title: string;
  description?: string;
  initial: string;
  submitLabel: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [tried, setTried] = useState(false);
  const clean = text.trim().replace(/\s+/g, " ");
  const error = !clean ? "Введите название" : clean.length > PROFILE_NAME_MAX ? `Не длиннее ${PROFILE_NAME_MAX} символов` : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error) return;
    onSave(clean);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" form="farm-profile-name-form">
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="farm-profile-name-form" onSubmit={submit}>
        <Field label="Название" error={(tried && error) || undefined}>
          {(p) => (
            <Input
              id={p.id}
              invalid={p.invalid}
              aria-describedby={p.describedBy}
              autoFocus
              maxLength={PROFILE_NAME_MAX}
              placeholder="Билд на Кулемака"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Экспорт выбранного профиля в JSON и импорт JSON как нового профиля. */
function TransferDialog({ profile, onClose }: { profile: FarmProfile; onClose: () => void }) {
  const exported = useMemo(() => exportProfile(profile), [profile]);
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseProfileExport(text) : null), [text]);
  const ok = parsed !== null && typeof parsed !== "string";

  const copy = () =>
    navigator.clipboard.writeText(exported).then(
      () => toast({ status: "success", title: `Профиль «${profile.name}» скопирован`, description: "Сохраните текст в файл или отправьте другу — импорт создаст новый профиль." }),
      () => toast({ status: "warning", title: "Не удалось скопировать", description: "Выделите текст в поле и нажмите Ctrl+C." }),
    );

  const pickFile = async (f: File | undefined) => {
    if (f) setText(await f.text());
  };

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title="Экспорт и импорт профиля"
      description="Профиль — TTK, время между боями, IIQ, свои шансы и скрытые боссы в JSON. Свои цены в профиль не входят."
      className="w-140"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              if (!ok) return;
              void importProfile(parsed).then((saved) => saved && toast({ status: "success", title: `Профиль «${saved.name}» импортирован` }));
              onClose();
            }}
          >
            Импортировать как новый
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={`Экспорт: «${profile.name}»`}>
          {(p) => (
            <div className="flex flex-col gap-2">
              <textarea
                id={p.id}
                readOnly
                spellCheck={false}
                value={exported}
                onFocus={(e) => e.currentTarget.select()}
                className={cx(fieldClasses, "h-28 resize-none py-2 font-mono text-label")}
              />
              <Button icon={Copy} className="self-start" onClick={copy}>
                Скопировать
              </Button>
            </div>
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-label font-medium text-text-primary">Импорт</span>
            <span className="grow" />
            <Button icon={FileUp} variant="secondary" onClick={() => file.current?.click()}>
              Выбрать файл…
            </Button>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          </div>
          <textarea
            spellCheck={false}
            aria-label="JSON профиля"
            placeholder='{"format":"poe-manager.farm-profile","profile":{…}}'
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={cx(fieldClasses, "h-24 resize-none py-2 font-mono text-label")}
          />
          {parsed !== null && (
            <p className="flex items-center gap-2 text-label text-text-secondary">
              <StatusIcon status={typeof parsed === "string" ? "danger" : "success"} />
              {typeof parsed === "string"
                ? parsed
                : `«${parsed.name}»: IIQ ${parsed.iiq} %, свои настройки у ${Object.keys(parsed.bosses).length} ${plural(Object.keys(parsed.bosses).length, "босса", "боссов", "боссов")}`}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Выбор профиля и меню действий — для шапки вкладки. */
export function ProfilePicker() {
  const profiles = useFarmProfiles((s) => s.profiles ?? NO_PROFILES);
  const active = useActiveProfile();
  const logProfile = useBossesView((s) => s.logProfile);
  const setView = useBossesView((s) => s.set);
  const logBosses = Object.keys(useLogTimings()).length;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);
  const isDraft = active.id === DRAFT_ID;

  const list = (isDraft ? [active, ...profiles] : profiles).map((p) => ({
    value: p.id,
    label: p.name,
    hint: p.id === DRAFT_ID ? "не сохранён" : bossCount(p) > 0 ? `${bossCount(p)} ${plural(bossCount(p), "босс", "босса", "боссов")}` : undefined,
  }));
  // «По логу» (F11): не запись, а режим поверх выбранного профиля — он база для боссов, где заходов в логе мало.
  const options = [
    ...list,
    {
      value: LOG_VALUE,
      label: "По логу",
      hint: logBosses > 0 ? `TTK из журнала у ${logBosses} ${plural(logBosses, "босса", "боссов", "боссов")}` : `нужно ≥ ${LOG_MIN_RUNS} заходов из лога`,
    },
  ];

  const menu: MenuEntry[] = [
    { label: "Новый профиль", icon: Plus, onSelect: () => setDialog({ kind: "create" }) },
    { label: "Дублировать", icon: CopyPlus, onSelect: () => setDialog({ kind: "duplicate" }) },
    { label: "Переименовать", icon: Pencil, onSelect: () => setDialog({ kind: "rename" }) },
    { type: "separator" },
    { label: "Экспорт и импорт JSON…", icon: FileJson, onSelect: () => setDialog({ kind: "transfer" }) },
    { type: "separator" },
    { label: "Удалить профиль", icon: Trash, disabled: isDraft, onSelect: () => setDialog({ kind: "delete" }) },
  ];

  return (
    <>
      <Tooltip
        content={
          logProfile
            ? `«По логу»: TTK и время между боями — медиана последних ${LOG_RUNS} заходов из лога игры, где их не меньше ${LOG_MIN_RUNS}; у остальных боссов и IIQ, шансы, скрытие — профиля «${active.name}». Правки пишутся в «${active.name}».`
            : "Профиль: TTK, время между боями, IIQ и свои шансы"
        }
      >
        <span className="inline-flex">
          <Select
            aria-label="Профиль фарма"
            value={logProfile ? LOG_VALUE : active.id}
            onValueChange={(value) => (value === LOG_VALUE ? setView({ logProfile: true }) : selectProfile(value))}
            options={options}
            className="w-48"
          />
        </span>
      </Tooltip>
      {logProfile && (
        <Select
          aria-label="Базовый профиль для «По логу»"
          value={active.id}
          onValueChange={(value) => setView({ profileId: value })}
          options={list.map((o) => ({ ...o, label: `на основе: ${o.label}` }))}
          className="w-52"
        />
      )}
      <Menu align="end" items={menu} trigger={<Button icon={Ellipsis}>Профиль</Button>} />

      {dialog?.kind === "create" && (
        <NameDialog
          title="Новый профиль"
          description="Пустой профиль: TTK, IIQ и шансы — по умолчанию, свои впишете в карточках боссов."
          initial=""
          submitLabel="Создать"
          onSave={(name) => void createProfile(name)}
          onClose={close}
        />
      )}
      {dialog?.kind === "duplicate" && (
        <NameDialog
          title={`Копия профиля «${active.name}»`}
          initial={`${active.name} (копия)`.slice(0, PROFILE_NAME_MAX)}
          submitLabel="Создать копию"
          onSave={(name) => void duplicateProfile(active, name)}
          onClose={close}
        />
      )}
      {dialog?.kind === "rename" && <NameDialog title="Переименовать профиль" initial={active.name} submitLabel="Сохранить" onSave={(name) => renameProfile(active.id, name)} onClose={close} />}
      {dialog?.kind === "transfer" && <TransferDialog profile={active} onClose={close} />}
      {dialog?.kind === "delete" && (
        <Dialog
          open
          onOpenChange={closeOn(close)}
          title={`Удалить профиль «${active.name}»?`}
          description={
            profiles.length <= 1
              ? `Это последний профиль: после удаления останется пустой «${DEFAULT_PROFILE_NAME}» со значениями по умолчанию.`
              : "Свои TTK, IIQ и шансы профиля удалятся на всех устройствах аккаунта."
          }
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                Отмена
              </Button>
              <Button
                variant="danger-ghost"
                autoFocus
                onClick={() => {
                  void deleteProfile(active.id);
                  close();
                }}
              >
                Удалить профиль
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
