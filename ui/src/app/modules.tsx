import type { ComponentType } from "react";
import { LayoutGrid, Settings, ShieldCheck, Tag, type LucideIcon } from "lucide-react";
import type { NavGroup } from "@/design-system";
import { PriceCheckPage } from "@/modules/price-check/PriceCheckPage";
import { SettingsPage } from "@/modules/settings/SettingsPage";
import { AdminPage } from "@/modules/admin/AdminPage";
import { ShowcasePage } from "@/showcase/ShowcasePage";
import { DEVELOPMENT } from "./env";

/**
 * Описание модуля. Чтобы добавить модуль: сделать страницу в `modules/<имя>/`
 * и одну запись в MODULES — навигация, палитра Ctrl+K и «Передать в модуль» подхватят её сами.
 * В навигацию попадают только работающие модули: заглушек «в разработке» нет.
 */
export type ModuleDef = {
  id: string;
  /** Подпись в навигации ≤ 22 символов. */
  label: string;
  icon: LucideIcon;
  /** Группа навигации; `footer` — внизу сайдбара; `dev` — только в режиме Development. */
  group: "check" | "craft" | "data" | "dev" | "footer";
  component: ComponentType;
  /** Можно ли передать в модуль текущий предмет. */
  acceptsItem?: boolean;
  /** Доп. слова для поиска в палитре. */
  keywords?: string;
};

/** Инструменты разработчика — только с DEVELOPMENT=true (app/env.ts). */
const DEV_MODULES: ModuleDef[] = [
  { id: "admin", label: "Админка", icon: ShieldCheck, group: "dev", component: AdminPage, keywords: "admin разработка отладка devtools" },
  { id: "showcase", label: "Витрина", icon: LayoutGrid, group: "dev", component: ShowcasePage, keywords: "дизайн-система компоненты экраны" },
];

export const MODULES: ModuleDef[] = [
  { id: "price-check", label: "Price check", icon: Tag, group: "check", component: PriceCheckPage, acceptsItem: true, keywords: "цена проверка" },
  ...(DEVELOPMENT ? DEV_MODULES : []),
  { id: "settings", label: "Настройки", icon: Settings, group: "footer", component: SettingsPage, keywords: "горячие клавиши" },
];

const GROUP_LABELS: Record<Exclude<ModuleDef["group"], "footer">, string> = {
  check: "Проверка",
  craft: "Крафт",
  data: "Данные",
  dev: "Разработка",
};

const toNav = (m: ModuleDef) => ({ id: m.id, label: m.label, icon: m.icon });

export const NAV_GROUPS: NavGroup[] = (Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[])
  .map((g) => ({ id: g, label: GROUP_LABELS[g], items: MODULES.filter((m) => m.group === g).map(toNav) }))
  .filter((g) => g.items.length > 0);

export const NAV_FOOTER = MODULES.filter((m) => m.group === "footer").map(toNav);

export const findModule = (id: string) => MODULES.find((m) => m.id === id) ?? MODULES[0];
