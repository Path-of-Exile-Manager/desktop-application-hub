import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@/design-system";
import { deleteRecord, listRecords, putRecord, sortKeyBetween, useSync } from "@/app/sync";
import { inTauri } from "@/app/window";
import { DEFAULT_NAME, normalizePreset, presetDefaults, type GameLang, type MapRegexPreset } from "./model";

// Наборы вкладки «RegEx карт» — коллекция `mapRegexPresets` в user.db, с аккаунтом синхронизируется
// между устройствами. Правка видна сразу, а пишется в базу с задержкой: серия кликов — одна запись.
// Пока наборов нет, на экране черновик «Мой первый набор»: он сохраняется при первой правке,
// поэтому новое устройство не плодит пустых наборов, которые после входа задвоились бы.

const COLLECTION = "mapRegexPresets";
const SAVE_DELAY_MS = 400;
/** id черновика: его нет в базе, настоящий id выдаёт ядро при первом сохранении. */
export const DRAFT_ID = "draft";

type PresetsState = {
  /** `null` — ещё не прочитаны из базы. */
  presets: MapRegexPreset[] | null;
  draft: MapRegexPreset;
};

function newDraft(): MapRegexPreset {
  return { ...presetDefaults(), id: DRAFT_ID, name: DEFAULT_NAME, sortKey: "", createdAt: "" };
}

export const useMapRegexPresets = create<PresetsState>(() => ({ presets: null, draft: newDraft() }));

/** Вид вкладки — настройка этого компьютера, не данные набора. */
type ViewState = {
  activePresetId: string | null;
  showNightmare: boolean;
  showAffix: boolean;
  groupByAffix: boolean;
  /** Столбик наборов свёрнут пользователем (ещё сворачивается сам, когда справа тесно). */
  railCollapsed: boolean;
  setActivePreset: (id: string) => void;
  setView: (view: Partial<Pick<ViewState, "showNightmare" | "showAffix" | "groupByAffix" | "railCollapsed">>) => void;
};

export const useMapRegexView = create<ViewState>()(
  persist(
    (set) => ({
      activePresetId: null,
      showNightmare: true,
      showAffix: false,
      groupByAffix: false,
      railCollapsed: false,
      setActivePreset: (id) => set({ activePresetId: id }),
      setView: (view) => set(view),
    }),
    { name: "poe-manager.map-regex-view", version: 1 },
  ),
);

/** Набор на экране: выбранный, иначе первый, иначе черновик. */
export function useActivePreset(): MapRegexPreset {
  const activeId = useMapRegexView((s) => s.activePresetId);
  return useMapRegexPresets((s) => s.presets?.find((p) => p.id === activeId) ?? s.presets?.[0] ?? s.draft);
}

const bySortKey = (a: MapRegexPreset, b: MapRegexPreset) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Ждут записи: при перечитывании базы их локальная версия новее. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export async function reloadPresets(): Promise<void> {
  if (!inTauri) {
    useMapRegexPresets.setState({ presets: [] });
    return;
  }
  const records = await listRecords<unknown>(COLLECTION);
  const loaded = records.map(normalizePreset).filter((p): p is MapRegexPreset => p !== null);
  const local = useMapRegexPresets.getState().presets ?? [];
  const merged = loaded.map((p) => (pending.has(p.id) ? (local.find((l) => l.id === p.id) ?? p) : p));
  useMapRegexPresets.setState({ presets: merged.sort(bySortKey) });
}

/** Наборы в сторе — по состоянию синхронизации (приходят и с других устройств). Ставится страницей. */
export function usePresetsSync() {
  const count = useSync((s) => s.status?.counts[COLLECTION]);
  const revision = useSync((s) => s.status?.revision);
  useEffect(() => {
    reloadPresets().catch((e: unknown) => toast({ status: "danger", title: "Наборы не прочитаны", description: String(e) }));
  }, [count, revision]);
}

/** Изменить набор: сразу на экране, в базу — с задержкой. Правка черновика сохраняет его как новый набор. */
export function updatePreset(id: string, change: (preset: MapRegexPreset) => MapRegexPreset): void {
  const state = useMapRegexPresets.getState();
  if (id === DRAFT_ID) {
    useMapRegexPresets.setState({ draft: change(state.draft) });
  } else {
    if (!state.presets?.some((p) => p.id === id)) return;
    useMapRegexPresets.setState({ presets: state.presets.map((p) => (p.id === id ? change(p) : p)) });
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
  if (!inTauri) return;
  try {
    if (id === DRAFT_ID) {
      if (draftSaving) return;
      draftSaving = true;
      try {
        await saveDraft();
      } finally {
        draftSaving = false;
      }
    } else {
      const preset = useMapRegexPresets.getState().presets?.find((p) => p.id === id);
      if (preset) await putRecord(COLLECTION, preset);
    }
  } catch (e) {
    toast({ status: "danger", title: "Набор не сохранён", description: String(e) });
  }
}

/** Новый пустой набор в конце списка; язык — как у текущего (язык клиента игры у пользователя один). */
export async function createPreset(name: string, lang: GameLang): Promise<void> {
  if (!inTauri) return;
  try {
    const last = useMapRegexPresets.getState().presets?.at(-1)?.sortKey ?? null;
    const sortKey = await sortKeyBetween(last, null);
    const saved = normalizePreset(await putRecord(COLLECTION, { ...presetDefaults(), name, lang, sortKey, createdAt: new Date().toISOString() }));
    if (!saved) return;
    useMapRegexPresets.setState((s) => ({ presets: [...(s.presets ?? []), saved].sort(bySortKey) }));
    useMapRegexView.getState().setActivePreset(saved.id);
  } catch (e) {
    toast({ status: "danger", title: "Набор не создан", description: String(e) });
  }
}

/**
 * Записать импортированные наборы по порядку в конец списка; `replace` — сначала удалить все текущие.
 * Активным становится набор `activeIndex`. Возвращает, сколько записано.
 */
export async function importPresets(drafts: Omit<MapRegexPreset, "id" | "sortKey" | "createdAt">[], replace: boolean, activeIndex: number): Promise<number> {
  if (!inTauri || !drafts.length) return 0;
  const existing = useMapRegexPresets.getState().presets ?? [];
  if (replace) {
    for (const p of existing) {
      clearTimeout(pending.get(p.id));
      pending.delete(p.id);
      await deleteRecord(COLLECTION, p.id);
    }
  }
  let last = replace ? null : (existing.at(-1)?.sortKey ?? null);
  const saved: MapRegexPreset[] = [];
  for (const draft of drafts) {
    const sortKey = await sortKeyBetween(last, null);
    const record = normalizePreset(await putRecord(COLLECTION, { ...draft, sortKey, createdAt: new Date().toISOString() }));
    if (!record) continue;
    saved.push(record);
    last = sortKey;
  }
  useMapRegexPresets.setState({ presets: [...(replace ? [] : existing), ...saved].sort(bySortKey) });
  const active = saved[activeIndex] ?? saved[0];
  if (active) useMapRegexView.getState().setActivePreset(active.id);
  return saved.length;
}

/** Удалить набор. Удалили последний — на экране снова черновик. Черновик не удаляется: его нет в базе. */
export async function deletePreset(id: string): Promise<void> {
  if (id === DRAFT_ID || !inTauri) return;
  clearTimeout(pending.get(id));
  pending.delete(id);
  try {
    await deleteRecord(COLLECTION, id);
    useMapRegexPresets.setState((s) => ({ presets: (s.presets ?? []).filter((p) => p.id !== id) }));
  } catch (e) {
    toast({ status: "danger", title: "Набор не удалён", description: String(e) });
  }
}

/** Черновик → новая запись в конце списка; правки, сделанные во время записи, не теряются. */
async function saveDraft(): Promise<void> {
  const snapshot = useMapRegexPresets.getState().draft;
  const last = useMapRegexPresets.getState().presets?.at(-1)?.sortKey ?? null;
  const { id: _draft, ...fields } = snapshot;
  const sortKey = await sortKeyBetween(last, null);
  const saved = normalizePreset(await putRecord(COLLECTION, { ...fields, sortKey, createdAt: new Date().toISOString() }));
  if (!saved) return;

  clearTimeout(pending.get(DRAFT_ID));
  pending.delete(DRAFT_ID);
  const latest = useMapRegexPresets.getState().draft;
  const preset = latest === snapshot ? saved : { ...latest, id: saved.id, sortKey: saved.sortKey, createdAt: saved.createdAt };
  useMapRegexPresets.setState((s) => ({ presets: [...(s.presets ?? []), preset].sort(bySortKey), draft: newDraft() }));
  useMapRegexView.getState().setActivePreset(preset.id);
  if (latest !== snapshot) updatePreset(preset.id, (p) => p);
}
