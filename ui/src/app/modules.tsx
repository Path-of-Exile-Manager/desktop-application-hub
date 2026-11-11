import type { ComponentType } from "react";
import { Bookmark, Dices, Eye, Gem, History, LayoutGrid, Library, Pin, Regex, Settings, Tag, Wrench, type LucideIcon } from "lucide-react";
import type { NavGroup } from "@/design-system";
import { PriceCheckPage } from "@/modules/price-check/PriceCheckPage";
import { AncientOrbPage } from "@/modules/ancient-orb/AncientOrbPage";
import { MapRegexPage } from "@/modules/map-regex/MapRegexPage";
import { ClustersPage } from "@/modules/clusters/ClustersPage";
import { PobBuildsPage } from "@/modules/pob-builds/PobBuildsPage";
import { WatchlistPage } from "@/modules/watchlist/WatchlistPage";
import { BookmarksPage } from "@/modules/user-data/BookmarksPage";
import { HistoryPage } from "@/modules/user-data/HistoryPage";
import { PinsPage } from "@/modules/user-data/PinsPage";
import { SettingsPage } from "@/modules/settings/SettingsPage";
import { DeveloperPage } from "@/modules/developer/DeveloperPage";
import { ShowcasePage } from "@/showcase/ShowcasePage";
import { useShell } from "./store";

/**
 * Описание модуля. Чтобы добавить модуль: сделать страницу в `modules/<имя>/`
 * и одну запись в списке ниже — навигация, палитра Ctrl+K и «Передать в модуль» подхватят её сами.
 * В навигацию попадают только работающие модули: заглушек «в разработке» нет.
 */
export type ModuleDef = {
  id: string;
  /** Подпись в навигации ≤ 22 символов. */
  label: string;
  icon: LucideIcon;
  /** Группа навигации; `footer` — внизу сайдбара; `dev` — только при включённом режиме разработчика. */
  group: "check" | "builds" | "craft" | "data" | "dev" | "footer";
  component: ComponentType;
  /** Можно ли передать в модуль текущий предмет. */
  acceptsItem?: boolean;
  /** Доп. слова для поиска в палитре. */
  keywords?: string;
};

export const DEVELOPER_MODULE_ID = "developer";

/** Инструменты разработчика — только при включённом режиме разработчика (Настройки). */
const DEV_MODULES: ModuleDef[] = [
  {
    id: DEVELOPER_MODULE_ID,
    label: "Режим разработки",
    icon: Wrench,
    group: "dev",
    component: DeveloperPage,
    keywords: "разработчик разработка отладка devtools сервер симуляция",
  },
  { id: "showcase", label: "Витрина", icon: LayoutGrid, group: "dev", component: ShowcasePage, keywords: "дизайн-система компоненты экраны" },
];

const PRICE_CHECK: ModuleDef = {
  id: "price-check",
  label: "Price check",
  icon: Tag,
  group: "check",
  component: PriceCheckPage,
  acceptsItem: true,
  keywords: "цена проверка",
};

const WATCHLIST: ModuleDef = {
  id: "watchlist",
  label: "Watchlist",
  icon: Eye,
  group: "check",
  component: WatchlistPage,
  keywords: "отслеживание избранное цены список",
};

/** Данные сайта торговли — общие с расширением браузера (Ф10). */
const TRADE_DATA: ModuleDef[] = [
  { id: "bookmarks", label: "Закладки", icon: Bookmark, group: "data", component: BookmarksPage, keywords: "папки поиски сайт торговли trade" },
  { id: "history", label: "История", icon: History, group: "data", component: HistoryPage, keywords: "поиски сайт торговли trade" },
  { id: "pins", label: "Закреплённые", icon: Pin, group: "data", component: PinsPage, keywords: "пины лоты сайт торговли trade" },
];

const ANCIENT_ORB: ModuleDef = {
  id: "ancient-orb",
  label: "Ancient Orb",
  icon: Dices,
  group: "craft",
  component: AncientOrbPage,
  keywords: "ancient древняя сфера казино учёт headhunter mageblood пояса",
};

const MAP_REGEX: ModuleDef = {
  id: "map-regex",
  label: "RegEx карт",
  icon: Regex,
  group: "craft",
  component: MapRegexPage,
  keywords: "regex регекс карты атлас моды сундук поиск map mods stash",
};

const CLUSTERS: ModuleDef = {
  id: "clusters",
  label: "Выгодные кластеры",
  icon: Gem,
  group: "craft",
  component: ClustersPage,
  keywords: "кластер кластерный самоцвет cluster jewel крафт craft фоссил ископаемые fossil notable прибыль roi",
};

/** Библиотека сборок Path of Building (план shared/docs/pob-trader.md). */
const POB_BUILDS: ModuleDef = {
  id: "pob-builds",
  label: "Билды",
  icon: Library,
  group: "builds",
  component: PobBuildsPage,
  keywords: "pob path of building билд сборка гайд библиотека группы pobb trade покупки",
};

const SETTINGS: ModuleDef = {
  id: "settings",
  label: "Настройки",
  icon: Settings,
  group: "footer",
  component: SettingsPage,
  keywords: "горячие клавиши режим разработчика",
};

const GROUP_LABELS: Record<Exclude<ModuleDef["group"], "footer">, string> = {
  check: "Проверка",
  builds: "Билды",
  craft: "Крафт",
  data: "Данные",
  dev: "Разработка",
};

const toNav = (m: ModuleDef) => ({ id: m.id, label: m.label, icon: m.icon });

export type ModuleSet = {
  modules: ModuleDef[];
  navGroups: NavGroup[];
  navFooter: ReturnType<typeof toNav>[];
  /** Модуль по id; скрытый или неизвестный — первый (Price check). */
  find: (id: string) => ModuleDef;
};

function buildModuleSet(developerMode: boolean): ModuleSet {
  const modules = [PRICE_CHECK, WATCHLIST, POB_BUILDS, ANCIENT_ORB, MAP_REGEX, CLUSTERS, ...TRADE_DATA, ...(developerMode ? DEV_MODULES : []), SETTINGS];
  return {
    modules,
    navGroups: (Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[])
      .map((g) => ({ id: g, label: GROUP_LABELS[g], items: modules.filter((m) => m.group === g).map(toNav) }))
      .filter((g) => g.items.length > 0),
    navFooter: modules.filter((m) => m.group === "footer").map(toNav),
    find: (id) => modules.find((m) => m.id === id) ?? modules[0],
  };
}

const SETS = { off: buildModuleSet(false), on: buildModuleSet(true) };

/** Модули с учётом режима разработчика: переключатель в Настройках сразу меняет навигацию. */
export function useModules(): ModuleSet {
  return useShell((s) => (s.developerMode ? SETS.on : SETS.off));
}
