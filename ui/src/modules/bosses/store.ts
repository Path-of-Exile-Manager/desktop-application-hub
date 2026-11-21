import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@/design-system";
import { deleteRecord, listRecords, putRecord, useSync } from "@/app/sync";
import { inTauri } from "@/app/window";
import type { FarmBossSettings } from "@/generated/FarmBossSettings";
import type { FarmSettings } from "@/generated/FarmSettings";
import { logTimings, useBossKills, useLogTimings, type LogTiming } from "./journal";
import { DEFAULT_SORT, type GroupFilter, type NameLanguage, type Sort } from "./model";

// Профили фарма — коллекция `farmProfiles` в user.db (форма — shared/docs/boss-farm.md, 7.2; проверка —
// src-tauri/src/sync/records.rs), с аккаунтом синхронизируются между устройствами. Правка видна
// сразу, а пишется в базу с задержкой: серия правок — одна запись. Пока профилей нет, на экране
// черновик «Мой»: он сохраняется при первой правке, поэтому новое устройство не плодит пустых
// профилей, которые после входа задвоились бы (как «Мой первый набор» в RegEx карт).
// Выбранный профиль и «Шансы сообщества» — вид вкладки на этом компьютере (`useBossesView`).
// «По логу» (F11) — не запись, а флаг вида поверх выбранного профиля (он — база): TTK и накладные из
// журнала, где заходов хватает, остальное — базы. Правки в этом режиме пишутся в базу; TTK и накладные
// боссов, взятые из лога, не правятся (их задаёт журнал).

export type { FarmBossSettings, FarmSettings };

/** Запись коллекции `farmProfiles`. */
export type FarmProfile = {
  id: string;
  /** 1–40 символов. */
  name: string;
  /** Общий IIQ для пулов `scalesWithQuantity`, целое 0–1000. */
  iiq: number;
  /** Id босса → свои значения; пустых боссов нет. */
  bosses: Record<string, FarmBossSettings>;
};

/** Числовые поля босса, которые правятся на месте: бой, между боями, своя IIQ. */
export type BossNumberField = "ttkSec" | "overheadSec" | "iiq";

const COLLECTION = "farmProfiles";
const SAVE_DELAY_MS = 400;
/** id черновика: его нет в базе, настоящий id выдаёт ядро при первом сохранении. */
export const DRAFT_ID = "draft";
export const DEFAULT_PROFILE_NAME = "Мой";
export const PROFILE_NAME_MAX = 40;

// Границы — как у сервера (`packages/domain/src/sync/farm-profile.ts`).
const IIQ_MAX = 1000;
const SECONDS_MAX = 36_000;
const CHANCE_MAX = 100_000;
const MAX_BOSSES = 200;
const MAX_CHANCES = 100;
const BOSS_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

/** Новый профиль — пустой: всё по умолчанию. */
function emptyProfile(id: string, name: string): FarmProfile {
  return { id, name, iiq: 0, bosses: {} };
}

const newDraft = () => emptyProfile(DRAFT_ID, DEFAULT_PROFILE_NAME);

/** Имя профиля: пробелы схлопнуты, до 40 символов. */
export const cleanProfileName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, PROFILE_NAME_MAX);

/** Настройки босса по правилам сервера; негодные поля отбрасываются. `null` — босс пуст. */
function normalizeBoss(value: unknown): FarmBossSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const boss: FarmBossSettings = {};
  const ttk = num(v.ttkSec);
  if (ttk !== undefined) boss.ttkSec = clampInt(ttk, 1, SECONDS_MAX);
  const overhead = num(v.overheadSec);
  if (overhead !== undefined) boss.overheadSec = clampInt(overhead, 1, SECONDS_MAX);
  const iiq = num(v.iiq);
  if (iiq !== undefined) boss.iiq = clampInt(iiq, 0, IIQ_MAX);
  if (typeof v.chances === "object" && v.chances !== null && !Array.isArray(v.chances)) {
    const chances: Record<string, number> = {};
    for (const [key, chance] of Object.entries(v.chances as Record<string, unknown>).slice(0, MAX_CHANCES)) {
      const c = num(chance);
      if (BOSS_KEY.test(key) && key.length <= 100 && c !== undefined && c >= 0) chances[key] = Math.min(c, CHANCE_MAX);
    }
    if (Object.keys(chances).length > 0) boss.chances = chances;
  }
  if (v.hidden === true) boss.hidden = true;
  return Object.keys(boss).length > 0 ? boss : null;
}

/** Профиль из базы или из файла: незнакомое и негодное отбрасывается. `null` — не профиль. */
export function normalizeProfile(value: unknown, id?: string): FarmProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const recordId = id ?? (typeof v.id === "string" ? v.id : null);
  if (!recordId) return null;
  const name = typeof v.name === "string" ? cleanProfileName(v.name) : "";
  const bosses: Record<string, FarmBossSettings> = {};
  if (typeof v.bosses === "object" && v.bosses !== null && !Array.isArray(v.bosses)) {
    for (const [bossId, settings] of Object.entries(v.bosses as Record<string, unknown>)) {
      if (Object.keys(bosses).length >= MAX_BOSSES) break;
      const boss = BOSS_KEY.test(bossId) && bossId.length <= 100 ? normalizeBoss(settings) : null;
      if (boss) bosses[bossId] = boss;
    }
  }
  const iiq = typeof v.iiq === "number" && Number.isFinite(v.iiq) ? clampInt(v.iiq, 0, IIQ_MAX) : 0;
  return { id: recordId, name: name || DEFAULT_PROFILE_NAME, iiq, bosses };
}

// ---------- профили ----------

type ProfilesState = {
  /** `null` — ещё не прочитаны из базы. */
  profiles: FarmProfile[] | null;
  draft: FarmProfile;
};

export const useFarmProfiles = create<ProfilesState>(() => ({ profiles: null, draft: newDraft() }));

/** Вид вкладки: группа, скрытые, сортировка, язык имён, выбранный профиль, шансы сообщества. Только этот компьютер. */
type ViewState = {
  group: GroupFilter;
  showHidden: boolean;
  sort: Sort;
  language: NameLanguage;
  /** Выбранный профиль (id записи `farmProfiles`); нет такого — первый по порядку. */
  profileId: string | null;
  /** «Шансы сообщества»: статистика вместо данных у всех дропов боссов со статистикой. */
  preferCommunity: boolean;
  /** Виртуальный профиль «По логу» поверх выбранного (`profileId` — его база). */
  logProfile: boolean;
  /** Вкладка страницы: калькулятор или журнал убийств. */
  tab: BossesTab;
  set: (patch: Partial<Omit<ViewState, "set">>) => void;
};

export type BossesTab = "calculator" | "journal";

export const useBossesView = create<ViewState>()(
  persist(
    (set) => ({
      group: "all",
      showHidden: false,
      sort: DEFAULT_SORT,
      language: "ru",
      profileId: null,
      preferCommunity: false,
      logProfile: false,
      tab: "calculator",
      set: (patch) => set(patch),
    }),
    {
      name: "poe-manager.bosses-view",
      version: 1,
      partialize: ({ group, showHidden, sort, language, profileId, preferCommunity, logProfile, tab }) => ({ group, showHidden, sort, language, profileId, preferCommunity, logProfile, tab }),
    },
  ),
);

const byOrder = (a: FarmProfile, b: FarmProfile) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function activeOf(state: ProfilesState, activeId: string | null): FarmProfile {
  return state.profiles?.find((p) => p.id === activeId) ?? state.profiles?.[0] ?? state.draft;
}

/** Профиль на экране: выбранный, иначе первый, иначе черновик «Мой». */
export function useActiveProfile(): FarmProfile {
  const activeId = useBossesView((s) => s.profileId);
  return useFarmProfiles((s) => activeOf(s, activeId));
}

export function activeProfile(): FarmProfile {
  return activeOf(useFarmProfiles.getState(), useBossesView.getState().profileId);
}

/**
 * «По логу» (F11): TTK и накладные боссов, у которых в журнале ≥ 3 заходов из лога, — медианы
 * последних 20 (`logTimings`); у остальных и всё прочее (IIQ, шансы, скрытие) — базового профиля.
 */
function withLog(bosses: Record<string, FarmBossSettings>, timings: Record<string, LogTiming>): Record<string, FarmBossSettings> {
  const merged = { ...bosses };
  for (const [bossId, t] of Object.entries(timings)) {
    merged[bossId] = { ...merged[bossId], ttkSec: t.ttkSec, ...(t.overheadSec !== null ? { overheadSec: t.overheadSec } : {}) };
  }
  return merged;
}

/** Настройки расчёта для команд ядра (`farm_bosses`, `farm_boss`): выбранный профиль (или «По логу») и шансы сообщества. */
export function currentFarmSettings(): FarmSettings {
  const profile = activeProfile();
  const view = useBossesView.getState();
  const bosses = view.logProfile ? withLog(profile.bosses, logTimings(useBossKills.getState().kills ?? [])) : profile.bosses;
  return { iiq: profile.iiq, preferCommunity: view.preferCommunity, bosses };
}

/** То же в React: объект меняется, только когда меняются IIQ, боссы профиля, переключатель или медианы лога. */
export function useFarmSettings(): FarmSettings {
  const profile = useActiveProfile();
  const preferCommunity = useBossesView((s) => s.preferCommunity);
  const log = useBossesView((s) => s.logProfile);
  const timings = useLogTimings();
  return useMemo(
    () => ({ iiq: profile.iiq, preferCommunity, bosses: log ? withLog(profile.bosses, timings) : profile.bosses }),
    [profile.iiq, profile.bosses, preferCommunity, log, timings],
  );
}

/** Медианы лога босса, если сейчас выбран «По логу» и заходов хватает. */
export function useBossLogTiming(bossId: string): LogTiming | null {
  const log = useBossesView((s) => s.logProfile);
  const timings = useLogTimings();
  return log ? (timings[bossId] ?? null) : null;
}

export const selectProfile = (id: string) => useBossesView.getState().set({ profileId: id, logProfile: false });

// ---------- запись ----------

/** Демо (`?demo=bosses`, без ядра): профили живут в памяти. */
let demoCounter = 0;

async function put(profile: Omit<FarmProfile, "id"> & { id?: string }): Promise<FarmProfile | null> {
  if (!inTauri) return { ...profile, id: profile.id ?? `demo-${Date.now()}-${demoCounter++}` };
  return normalizeProfile(await putRecord(COLLECTION, profile));
}

/** Ждут записи: при перечитывании базы их локальная версия новее. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export async function reloadProfiles(): Promise<void> {
  if (!inTauri) {
    if (useFarmProfiles.getState().profiles === null) useFarmProfiles.setState({ profiles: [] });
    return;
  }
  const records = await listRecords<unknown>(COLLECTION);
  const loaded = records.map((r) => normalizeProfile(r)).filter((p): p is FarmProfile => p !== null);
  const local = useFarmProfiles.getState().profiles ?? [];
  const merged = loaded.map((p) => (pending.has(p.id) ? (local.find((l) => l.id === p.id) ?? p) : p));
  useFarmProfiles.setState({ profiles: merged.sort(byOrder) });
  await migrateLegacySettings(merged.length === 0);
}

/** Профили в сторе — по состоянию синхронизации (приходят и с других устройств). Ставится страницей. */
export function useProfilesSync() {
  const count = useSync((s) => s.status?.counts[COLLECTION]);
  const revision = useSync((s) => s.status?.revision);
  useEffect(() => {
    reloadProfiles().catch((e: unknown) => toast({ status: "danger", title: "Профили фарма не прочитаны", description: String(e) }));
  }, [count, revision]);
}

/** Изменить профиль: сразу на экране, в базу — с задержкой. Правка черновика сохраняет его как новый профиль. */
export function updateProfile(id: string, change: (profile: FarmProfile) => FarmProfile): void {
  const state = useFarmProfiles.getState();
  if (id === DRAFT_ID) {
    useFarmProfiles.setState({ draft: change(state.draft) });
  } else {
    if (!state.profiles?.some((p) => p.id === id)) return;
    useFarmProfiles.setState({ profiles: state.profiles.map((p) => (p.id === id ? change(p) : p)) });
  }
  clearTimeout(pending.get(id));
  pending.set(
    id,
    setTimeout(() => void save(id), SAVE_DELAY_MS),
  );
}

/** Черновик пишется один раз: правки во время записи подхватывает сама запись. */
let draftSaving = false;

async function save(id: string): Promise<void> {
  pending.delete(id);
  try {
    if (id === DRAFT_ID) {
      if (draftSaving) return;
      draftSaving = true;
      try {
        await saveDraft();
      } finally {
        draftSaving = false;
      }
    } else if (inTauri) {
      const profile = useFarmProfiles.getState().profiles?.find((p) => p.id === id);
      if (profile) await putRecord(COLLECTION, profile);
    }
  } catch (e) {
    toast({ status: "danger", title: "Профиль не сохранён", description: String(e) });
  }
}

/** Черновик → новая запись; правки, сделанные во время записи, не теряются. */
async function saveDraft(): Promise<void> {
  const snapshot = useFarmProfiles.getState().draft;
  const { id: _draft, ...fields } = snapshot;
  const saved = await put(fields);
  if (!saved) return;

  clearTimeout(pending.get(DRAFT_ID));
  pending.delete(DRAFT_ID);
  const latest = useFarmProfiles.getState().draft;
  const profile = latest === snapshot ? saved : { ...latest, id: saved.id };
  useFarmProfiles.setState((s) => ({ profiles: [...(s.profiles ?? []), profile].sort(byOrder), draft: newDraft() }));
  selectProfile(profile.id);
  if (latest !== snapshot) updateProfile(profile.id, (p) => p);
}

/** Записать новый профиль и выбрать его. */
async function addProfile(fields: Omit<FarmProfile, "id">, failTitle: string): Promise<FarmProfile | null> {
  try {
    const saved = await put(fields);
    if (!saved) return null;
    useFarmProfiles.setState((s) => ({ profiles: [...(s.profiles ?? []), saved].sort(byOrder) }));
    selectProfile(saved.id);
    return saved;
  } catch (e) {
    toast({ status: "danger", title: failTitle, description: String(e) });
    return null;
  }
}

/** Новый пустой профиль. */
export const createProfile = (name: string) => addProfile({ name: cleanProfileName(name) || DEFAULT_PROFILE_NAME, iiq: 0, bosses: {} }, "Профиль не создан");

/** Копия профиля (и черновика) под новым именем. */
export function duplicateProfile(source: FarmProfile, name: string) {
  return addProfile({ name: cleanProfileName(name) || DEFAULT_PROFILE_NAME, iiq: source.iiq, bosses: structuredClone(source.bosses) }, "Профиль не скопирован");
}

/** Импорт: всегда новый профиль. */
export const importProfile = (profile: Omit<FarmProfile, "id">) => addProfile(profile, "Профиль не импортирован");

export function renameProfile(id: string, name: string): void {
  const clean = cleanProfileName(name);
  if (clean) updateProfile(id, (p) => ({ ...p, name: clean }));
}

/** Удалить профиль. Удалили последний — на экране снова пустой черновик «Мой». Черновик не удаляется: его нет в базе. */
export async function deleteProfile(id: string): Promise<void> {
  if (id === DRAFT_ID) return;
  clearTimeout(pending.get(id));
  pending.delete(id);
  try {
    if (inTauri) await deleteRecord(COLLECTION, id);
    useFarmProfiles.setState((s) => ({ profiles: (s.profiles ?? []).filter((p) => p.id !== id), draft: newDraft() }));
  } catch (e) {
    toast({ status: "danger", title: "Профиль не удалён", description: String(e) });
  }
}

// ---------- правки выбранного профиля ----------

/**
 * Босс без пустых полей: `undefined`, пустые `chances` и `hidden: false` убираются, пустой босс —
 * удаляется из `bosses` целиком (тот же профиль даёт тот же ключ кэша расчёта в ядре).
 */
function withBoss(profile: FarmProfile, bossId: string, update: (boss: FarmBossSettings) => FarmBossSettings): FarmProfile {
  const next: FarmBossSettings = { ...update({ ...(profile.bosses[bossId] ?? {}) }) };
  for (const key of Object.keys(next) as (keyof FarmBossSettings)[]) if (next[key] === undefined) delete next[key];
  if (next.chances && Object.keys(next.chances).length === 0) delete next.chances;
  if (next.hidden === false) delete next.hidden;
  const bosses = { ...profile.bosses };
  if (Object.keys(next).length === 0) delete bosses[bossId];
  else bosses[bossId] = next;
  return { ...profile, bosses };
}

const editActive = (change: (profile: FarmProfile) => FarmProfile) => updateProfile(activeProfile().id, change);

const BOSS_LIMITS: Record<BossNumberField, [number, number]> = { ttkSec: [1, SECONDS_MAX], overheadSec: [1, SECONDS_MAX], iiq: [0, IIQ_MAX] };

/** Правки выбранного профиля (TTK, накладные, IIQ, шансы, скрытие) — пишутся в `farmProfiles` с задержкой. */
export const farmEdits = {
  /** Общий IIQ (пулы `scalesWithQuantity`), %: целое 0–1000. */
  setIiq: (iiq: number) => editActive((p) => ({ ...p, iiq: clampInt(Number.isFinite(iiq) ? iiq : 0, 0, IIQ_MAX) })),
  /** Своё значение поля босса (целое, в границах сервера); `null` — снова по умолчанию (данные или общая IIQ). */
  setBossNumber: (bossId: string, field: BossNumberField, value: number | null) =>
    editActive((p) => withBoss(p, bossId, (b) => ({ ...b, [field]: value === null || !Number.isFinite(value) ? undefined : clampInt(value, ...BOSS_LIMITS[field]) }))),
  /** Свой шанс дропа: у `independent` — %, у `one-of` — вес пула (0–100000); `null` — шанс из данных. */
  setChance: (bossId: string, dropKey: string, value: number | null) =>
    editActive((p) =>
      withBoss(p, bossId, (b) => {
        const chances = { ...(b.chances ?? {}) };
        if (value === null || !Number.isFinite(value) || value < 0) delete chances[dropKey];
        else chances[dropKey] = Math.min(value, CHANCE_MAX);
        return { ...b, chances };
      }),
    ),
  setHidden: (bossId: string, hidden: boolean) => editActive((p) => withBoss(p, bossId, (b) => ({ ...b, hidden }))),
  /** Сбросить босса целиком: TTK, накладные, IIQ, шансы, скрытие. */
  resetBoss: (bossId: string) => editActive((p) => withBoss(p, bossId, () => ({}))),
};

// ---------- экспорт и импорт ----------

const EXPORT_FORMAT = "poe-manager.farm-profile";

/** Профиль в JSON для файла или буфера обмена (без id: импорт всегда создаёт новый профиль). */
export function exportProfile(profile: FarmProfile): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, profile: { name: profile.name, iiq: profile.iiq, bosses: profile.bosses } }, null, 2);
}

/** Разобрать экспорт (или голую запись профиля). Ошибка — текстом. */
export function parseProfileExport(text: string): Omit<FarmProfile, "id"> | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "Это не JSON";
  }
  const wrapped = typeof value === "object" && value !== null && (value as Record<string, unknown>).format === EXPORT_FORMAT ? (value as Record<string, unknown>).profile : value;
  if (typeof wrapped !== "object" || wrapped === null || Array.isArray(wrapped) || !("bosses" in wrapped || "iiq" in wrapped)) return "Не похоже на профиль фарма: нет полей iiq и bosses";
  const profile = normalizeProfile(wrapped, "import");
  if (!profile) return "Профиль не прочитан";
  const { id: _id, ...fields } = profile;
  return fields;
}

// ---------- перенос со старого хранилища ----------

/** До профилей настройки единственного «Мой» лежали в localStorage под этим ключом. */
const LEGACY_KEY = "poe-manager.farm-settings";
let migrating = false;

/**
 * Один раз: настройки из старого хранилища → профиль. Профилей нет — это «Мой», есть (пришли с
 * другого устройства) — отдельный «Мой (с этого ПК)». Пустые настройки просто удаляются.
 */
async function migrateLegacySettings(noProfiles: boolean): Promise<void> {
  if (migrating) return;
  let raw: string | null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  migrating = true;
  try {
    let settings: unknown = null;
    try {
      settings = (JSON.parse(raw) as { state?: { settings?: unknown } }).state?.settings ?? null;
    } catch {
      settings = null;
    }
    const profile = normalizeProfile(settings, DRAFT_ID);
    if (profile && (profile.iiq > 0 || Object.keys(profile.bosses).length > 0)) {
      const name = noProfiles ? DEFAULT_PROFILE_NAME : `${DEFAULT_PROFILE_NAME} (с этого ПК)`;
      const saved = await put({ name, iiq: profile.iiq, bosses: profile.bosses });
      if (!saved) return;
      useFarmProfiles.setState((s) => ({ profiles: [...(s.profiles ?? []).filter((p) => p.id !== saved.id), saved].sort(byOrder) }));
      if (noProfiles) selectProfile(saved.id);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    toast({ status: "warning", title: "Старые настройки фарма не перенесены", description: String(e) });
  } finally {
    migrating = false;
  }
}
