import { useState } from "react";
import { ChevronsLeft, ChevronsRight, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { Tooltip } from "../components/Tooltip";
import { groupLabelClasses } from "../components/Menu";

export type NavItem = {
  id: string;
  /** Подпись ≤ 22 символов: в навигации многоточие запрещено (guide.md, п. 6). */
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export type SidebarProps = {
  groups: NavGroup[];
  /** Пункты внизу (например, «Настройки»). */
  footerItems?: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * Боковая навигация (components.md, п. 18): 256 px, сворачивается до 64 (только иконки, подпись в подсказке).
 * Группы можно свернуть кликом по заголовку — так навигация выдерживает 10–15 модулей без прокрутки.
 */
export function Sidebar({ groups, footerItems = [], activeId, onSelect, collapsed, onCollapsedChange }: SidebarProps) {
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const ToggleIcon = collapsed ? ChevronsRight : ChevronsLeft;
  const toggleLabel = collapsed ? "Развернуть панель" : "Свернуть панель";

  return (
    <nav
      aria-label="Модули"
      className={cx(
        "flex shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-bg-surface px-2 py-3",
        "transition-[width] duration-(--motion-duration-base) ease-standard",
        collapsed ? "w-sidebar-width-collapsed" : "w-sidebar-width",
      )}
    >
      <div className={cx("flex min-h-0 flex-1 flex-col overflow-hidden", collapsed ? "gap-1.5" : "gap-3.5")}>
        {groups.map((group) => {
          const open = collapsed || !closedGroups[group.id];
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              {collapsed ? (
                <span aria-hidden className="mx-2.5 mt-1 mb-1.5 h-px bg-border-default" />
              ) : (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setClosedGroups((s) => ({ ...s, [group.id]: open }))}
                  className={cx(groupLabelClasses, "self-start rounded-sm px-2.5 pb-1 text-left hover:text-text-secondary")}
                >
                  {group.label}
                </button>
              )}
              {open && group.items.map((item) => <NavButton key={item.id} item={item} active={item.id === activeId} collapsed={collapsed} onSelect={onSelect} />)}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border-subtle pt-2">
        {footerItems.map((item) => (
          <NavButton key={item.id} item={item} active={item.id === activeId} collapsed={collapsed} onSelect={onSelect} />
        ))}
        <Tooltip content={collapsed ? toggleLabel : null} side="right">
          <button
            type="button"
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            className={cx(
              "flex h-row-height items-center gap-2.5 rounded-md px-3 text-label text-text-secondary transition-colors hover:bg-bg-hover",
              collapsed && "justify-center px-0",
            )}
          >
            <ToggleIcon aria-hidden size={18} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{toggleLabel}</span>}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

function NavButton({ item, active, collapsed, onSelect }: { item: NavItem; active: boolean; collapsed: boolean; onSelect: (id: string) => void }) {
  const Icon = item.icon;
  const button = (
    <button
      type="button"
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      disabled={item.disabled}
      onClick={() => onSelect(item.id)}
      className={cx(
        "flex h-row-height items-center gap-2.5 rounded-md px-3 text-body whitespace-nowrap transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-bg-selected font-semibold text-text-primary"
          : "text-icon-strong enabled:hover:bg-bg-hover enabled:hover:text-text-primary",
        "disabled:cursor-default disabled:text-text-disabled",
      )}
    >
      <Icon aria-hidden size={18} className={cx("shrink-0", active ? "text-icon-accent" : "text-icon-default")} />
      {!collapsed && <span>{item.label}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
