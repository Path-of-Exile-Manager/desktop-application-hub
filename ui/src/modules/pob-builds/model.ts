import { invoke } from "@tauri-apps/api/core";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobFetched } from "@/generated/PobFetched";
import type { PobLink } from "@/generated/PobLink";
import type { PobSite } from "@/generated/PobSite";

// Библиотека билдов (план shared/docs/pob-trader.md, P6): записи коллекций pobBuilds и
// pobBuildGroups (формы /v1/sync, проверка — src-tauri/src/sync/records.rs). Код PoB хранится как
// есть, без пробелов; класс, восхождение и уровень берутся из кода при добавлении.

export type PobBuildSite = PobSite;

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

/** Ссылка pobb.in / Pastebin / poe.ninja → код и сборка (ядро скачивает само). */
export const fetchBuild = (url: string) => invoke<PobFetched>("pob_fetch", { url });

/** Ссылка, а не код: есть схема или начинается с сайта (как `looks_like_link` в pob-parser). */
export function looksLikeLink(input: string): boolean {
  const s = input.trim().toLowerCase();
  return s.includes("://") || ["pobb.in/", "pastebin.com/", "poe.ninja/", "www."].some((p) => s.startsWith(p));
}

/** Открыть страницу сборки на её сайте (ядро проверяет адрес по белому списку). */
export const openSourcePage = (url: string) => invoke<void>("pob_open_page", { url });

export const SITE_LABEL: Record<PobSite, string> = { POBBIN: "pobb.in", PASTEBIN: "Pastebin", POE_NINJA: "poe.ninja" };

export const sourceOf = (link: PobLink | null): PobBuildRecord["source"] => (link ? { site: link.site, idOnSite: link.idOnSite, url: link.url } : null);

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
export function newBuildRecord(input: { name: string; code: string; groupId: string | null; build: PobBuild; link: PobLink | null; sortKey: string }): Omit<PobBuildRecord, "id"> {
  return {
    name: input.name.trim(),
    code: normalizeCode(input.code),
    groupId: input.groupId,
    source: sourceOf(input.link),
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
