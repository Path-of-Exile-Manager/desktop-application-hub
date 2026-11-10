import type { ComponentType } from "react";
import { Dices, Eye, LayoutGrid, Settings, Tag, Wrench, type LucideIcon } from "lucide-react";
import type { NavGroup } from "@/design-system";
import { PriceCheckPage } from "@/modules/price-check/PriceCheckPage";
import { AncientOrbPage } from "@/modules/ancient-orb/AncientOrbPage";
import { WatchlistPage } from "@/modules/watchlist/WatchlistPage";
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
  group: "check" | "craft" | "data" | "dev" | "footer";
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

const ANCIENT_ORB: ModuleDef = {
  id: "ancient-orb",
  label: "Ancient Orb",
  icon: Dices,
  group: "craft",
  component: AncientOrbPage,
  keywords: "ancient древняя сфера казино учёт headhunter mageblood пояса",
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
  const modules = [PRICE_CHECK, WATCHLIST, ANCIENT_ORB, ...(developerMode ? DEV_MODULES : []), SETTINGS];
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
