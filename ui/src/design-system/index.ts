// Единая точка импорта дизайн-системы: `import { Button, ModLine } from "@/design-system";`
// Стили подключаются отдельно и один раз: `import "@/design-system/styles.css";`

export { cx } from "./lib/cx";
export { DesignSystemProvider } from "./DesignSystemProvider";

// Хуки
export { usePageSize } from "./hooks/usePageSize";
export { useHotkey, matchesHotkey } from "./hooks/useHotkey";

// Базовые компоненты
export { Button, IconButton, type ButtonProps, type ButtonVariant, type IconButtonProps } from "./components/Button";
export { Tooltip, TooltipProvider } from "./components/Tooltip";
export { Field, Input, fieldClasses, type FieldProps, type InputProps } from "./components/Field";
export { SearchInput } from "./components/SearchInput";
export { Select, type SelectOption } from "./components/Select";
export { Checkbox, RadioGroup, Switch } from "./components/Toggles";
export { Slider } from "./components/Slider";
export { HotkeyInput, keysFromEvent } from "./components/HotkeyInput";
export { Tabs, SegmentedControl, type TabItem } from "./components/Tabs";
export { Popover, Menu, popoverClasses, menuItemClasses, groupLabelClasses, type MenuEntry } from "./components/Menu";
export { Dialog } from "./components/Dialog";
export { Badge, StatusBadge, badgeBase } from "./components/Badge";
export { Chip } from "./components/Chip";
export { Kbd, Hotkey } from "./components/Kbd";
export { Card, CardHeader, CardSection, Panel } from "./components/Card";
export { ListRow } from "./components/ListRow";
export { Table, type Column, type SortState } from "./components/Table";
export { Pagination, pageNumbers } from "./components/Pagination";
export { Banner, EmptyState, Skeleton, ProgressBar } from "./components/Feedback";
export { toast, Toaster } from "./components/Toast";
export { StatusIcon, STATUS_ICONS, STATUS_CLASSES, type Status } from "./components/StatusIcon";

// Игровые компоненты
export * from "./game/types";
export { RarityBadge, RARITY_LABEL, RARITY_TEXT, RARITY_BORDER } from "./game/Rarity";
export { AffixBadge, TierBadge, ModTypeTag, ItemStateBadge } from "./game/ModBadges";
export { ModLine, ModList, ModText, formatRange, modToText } from "./game/ModLine";
export { Price, PriceConversion, CurrencyIcon, FreshnessTag, CURRENCY, formatAmount } from "./game/Price";
export { Sockets, socketsToText, maxLinks } from "./game/Sockets";
export { ItemIcon } from "./game/ItemIcon";
export { ItemHeader, ItemBaseLine, ItemProperties } from "./game/ItemHeader";
export { Verdict, CheckMark, GoalCondition, PlanStep, PlanTotal, type ConditionStatus, type PlanStepState } from "./game/Craft";

// Оболочка окна
export { AppShell, Page, type PageProps } from "./shell/AppShell";
export { TitleBar, WindowControls, LeagueSelect, type League } from "./shell/TitleBar";
export { Sidebar, type NavGroup, type NavItem } from "./shell/Sidebar";
export { StatusBar, type StatusItem } from "./shell/StatusBar";
export { CurrentItemPanel, type SendTarget } from "./shell/CurrentItemPanel";
export { CommandPalette, type PaletteItem } from "./shell/CommandPalette";
export { AppLogo } from "./shell/AppLogo";
export { SplashScreen, type SplashStep, type SplashStepState } from "./shell/SplashScreen";

// Оверлей
export { OverlayFrame, OverlaySection } from "./overlay/OverlayFrame";
