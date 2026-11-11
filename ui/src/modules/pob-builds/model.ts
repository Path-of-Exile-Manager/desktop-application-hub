import { invoke } from "@tauri-apps/api/core";
import type { PobBuild } from "@/generated/PobBuild";

// Библиотека билдов (план shared/docs/pob-trader.md, P6): записи коллекций pobBuilds и
// pobBuildGroups (формы /v1/sync, проверка — src-tauri/src/sync/records.rs). Код PoB хранится как
// есть, без пробелов; класс, восхождение и уровень берутся из кода при добавлении.

export type PobBuildSite = "POBBIN" | "PASTEBIN" | "POE_NINJA";

export type PobBuildRecord = {
  id: string;
  name: string;
  code: string;
  groupId: string | null;
  source: { site: PobBuildSite; idOnSite: string; url: string } | null;
  className: string;
  ascendancy: string | null;
  level: number | null;
  notes: string | null;
  /** Ручные цены строк экрана сборки (P7), chaos. */
  manualPrices: Record<string, number>;
  /** Правки поиска на сайте торговли по строкам (P8): форма интерфейса. */
  filterOverrides: Record<string, unknown>;
  sortKey: string;
  createdAt: string;
};

export type PobBuildGroup = { id: string; name: string; sortKey: string };

/** Выбор слева: все, без группы или группа по id. */
export type GroupFilter = { kind: "all" } | { kind: "none" } | { kind: "group"; id: string };

export const NAME_MAX = 150;
export const GROUP_NAME_MAX = 100;

/** Код экспорта без пробелов и переводов строк: так его хранит сервер. */
export const normalizeCode = (code: string) => code.replace(/\s+/g, "");

/** Код PoB → сборка (ядро, `pob-parser`). Ошибка — текстом для пользователя. */
export const decodeBuild = (code: string) => invoke<PobBuild>("pob_decode", { code });

/** Что показывать: восхождение, а без него — класс. */
export const classLabel = (b: { className: string; ascendancy: string | null }) => b.ascendancy ?? (b.className || "Класс не указан");

/** «Elementalist · 92 уровень». */
export function buildSubtitle(b: { className: string; ascendancy: string | null; level: number | null }): string {
  return b.level ? `${classLabel(b)} · ${b.level} уровень` : classLabel(b);
}

/** Две буквы вместо портрета: «Elementalist» → «EL». */
export const monogram = (b: { className: string; ascendancy: string | null }) => classLabel(b).slice(0, 2).toUpperCase();

/** Цвет монограммы по классу — цвет гнезда его атрибута (у гибридов — первого): сила, ловкость, интеллект. */
export const CLASS_TONE: Record<string, string> = {
  Marauder: "text-game-socket-red",
  Duelist: "text-game-socket-red",
  Templar: "text-game-socket-blue",
  Witch: "text-game-socket-blue",
  Shadow: "text-game-socket-green",
  Ranger: "text-game-socket-green",
  Scion: "text-game-socket-white",
};

/** Подходит ли билд под строку поиска: название, класс, восхождение. */
export function matchesQuery(b: PobBuildRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [b.name, b.className, b.ascendancy ?? ""].some((s) => s.toLowerCase().includes(q));
}

export function inGroup(b: PobBuildRecord, filter: GroupFilter, groupIds: Set<string>): boolean {
  if (filter.kind === "all") return true;
  // Билд удалённой (или ещё не пришедшей) группы — «без группы».
  const own = b.groupId && groupIds.has(b.groupId) ? b.groupId : null;
  return filter.kind === "none" ? own === null : own === filter.id;
}

/** Новые сверху. */
export const byCreatedDesc = (a: PobBuildRecord, b: PobBuildRecord) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU");

/** Запись нового билда из разобранного кода. */
export function newBuildRecord(input: { name: string; code: string; groupId: string | null; build: PobBuild; sortKey: string }): Omit<PobBuildRecord, "id"> {
  return {
    name: input.name.trim(),
    code: normalizeCode(input.code),
    groupId: input.groupId,
    source: null,
    className: (input.build.className || "Scion").slice(0, 40),
    ascendancy: input.build.ascendancy?.slice(0, 40) ?? null,
    level: input.build.level && input.build.level <= 100 ? input.build.level : null,
    notes: null,
    manualPrices: {},
    filterOverrides: {},
    sortKey: input.sortKey,
    createdAt: new Date().toISOString(),
  };
}
