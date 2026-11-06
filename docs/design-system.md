# Дизайн-система в коде

> Источник: передача от дизайнера в [docs/design](design/handoff-README.md) — правила ([guide.md](design/guide.md)), спецификация компонентов ([components.md](design/components.md)), оболочка ([app-shell.md](design/app-shell.md)), макеты ([reference/mockups](design/reference/README.md)).
> Этот документ — о том, **как этим пользоваться в React-коде**.

## Коротко

- Стек: **React + Tailwind CSS v4 + Radix UI** (поведение: фокус, клавиатура, позиционирование) + **Lucide** (иконки).
- Всё лежит в `ui/src/design-system/`, импорт из одной точки: `import { Button, ModLine } from "@/design-system"`.
- В компонентах и страницах — **только токены**. Цвет, размер, радиус, тень — через утилиты темы. Проверяет `pnpm check:tokens`.
- Витрина: модуль **«Витрина»** в навигации (группа «Разработка», только при включённом режиме разработчика: Настройки → «Режим разработчика» — см. architecture.md, «Режим разработчика»). Раздел «Компоненты» — всё во всех состояниях; разделы «Экран: …» — эталонные экраны из макетов (Price check с ценой, ассистент крафта, справочник) на демо-данных.
- **В рабочем интерфейсе — только настоящее.** Демо-данные живут только в витрине (`showcase/demo-data.ts`). В навигацию попадают только работающие модули, без заглушек «в разработке»; панель «Текущий предмет» появляется, когда предмет пойман; в строке статусов — только реальные статусы.

## Структура

```
ui/src/
├─ design-system/
│  ├─ tokens/        tokens.json (источник) → tokens.css, theme.css, tokens.ts (генерируются: pnpm tokens)
│  ├─ base/          базовые стили поверх preflight Tailwind
│  ├─ styles.css     точка входа стилей (подключается один раз в main.tsx)
│  ├─ components/    базовые: Button, Field/Input, Select, Toggles, Slider, Tabs, Menu, Dialog, Badge, Card, Table…
│  ├─ game/          игровые: RarityBadge, ModLine, TierBadge, Price, Sockets, ItemIcon, ItemHeader, Craft…
│  ├─ shell/         оболочка окна: AppShell, Page, TitleBar, Sidebar, StatusBar, CurrentItemPanel, CommandPalette
│  ├─ overlay/       OverlayFrame — рамка виджета поверх игры
│  ├─ hooks/         usePageSize (сколько влезает без прокрутки), useHotkey
│  ├─ lib/cx.ts      склейка классов (clsx + tailwind-merge с нашей темой)
│  └─ index.ts       публичный вход
├─ app/              состояние оболочки (store.ts), реестр модулей (modules.tsx), окно Tauri, демо-данные
├─ modules/          страницы модулей: price-check, craft, catalog, settings…
└─ showcase/         витрина (только dev)
```

## Токены → классы Tailwind

Правило одно: **имя класса = путь токена**. Стандартная палитра и шкалы Tailwind выключены — `bg-red-500`, `rounded-2xl`, `shadow-lg` просто не сработают.

| Токен | Класс | Пример |
|---|---|---|
| `color.bg.surface` | `bg-bg-surface` | фон карточки |
| `color.text.secondary` | `text-text-secondary` | подписи |
| `color.border.default` | `border-border-default` | рамка карточки |
| `color.accent.solid` | `bg-accent-solid` | основная кнопка |
| `color.status.danger.fg` | `text-status-danger-fg` | ошибка |
| `game.rarity.rare` | `text-game-rarity-rare`, `border-game-rarity-rare` | имя редкого предмета |
| `font.size.body` | `text-body` (с line-height) | основной текст |
| `font.family.mono` | `font-mono` | числа, моды, цены |
| `font.letter-spacing.caps` | `tracking-caps` | подписи капсом |
| `size.control-height` | `h-control-height` | высота контролов (32 / 28 в compact) |
| `size.page-padding-x` | `px-page-padding-x` | отступ страницы |
| `layout.sidebar.width` | `w-sidebar-width` | ширина сайдбара |
| `radius.md` | `rounded-md` | кнопки, поля |
| `shadow.popover` | `shadow-popover` | меню, подсказки |
| `blur.overlay` | `backdrop-blur-overlay` | оверлей |
| `motion.easing.standard` | `ease-standard` | (по умолчанию у `transition-colors`) |
| `z.popover` | `z-(--z-popover)` | слои |

Отступы — обычная шкала Tailwind с шагом 4 px, она совпадает с `space.*`: `p-3` = 12, `gap-2.5` = 10, `h-4.5` = 18.

Значения, которых нет в шкале, записываются через переменные: `h-[calc(var(--size-control-height)-var(--space-1))]`. **Нельзя:** `w-[20px]`, `text-[13px]`, `bg-[#fff]`, `rgba(…)` — это ловит `pnpm check:tokens`. Если правило действительно надо нарушить (например, 1 px в градиенте), поставьте в конце строки комментарий `tokens-allow` и объясните почему.

**Плотность.** `data-density="compact"` на любом контейнере переключает `size.*` (высоты контролов, отступы). Для своих классов есть вариант `density-compact:` — например `density-compact:text-label`.

## Как сделать новую страницу

1. Создать `ui/src/modules/<имя>/<Имя>Page.tsx`:

```tsx
import { Hammer } from "lucide-react";
import { Button, Card, CardHeader, CardSection, ModList, Page } from "@/design-system";
import { useShell } from "@/app/store";

export function HarvestPage() {
  const { currentItem } = useShell();
  return (
    <Page title="Harvest" subtitle="Что выгоднее и сколько стоит" actions={<Button variant="primary">Посчитать</Button>}>
      <div className="flex min-h-0 flex-wrap items-start gap-4">
        <Card className="min-w-0 grow basis-90">
          <CardHeader title="Предмет" />
          <CardSection>{currentItem && <ModList mods={currentItem.mods} />}</CardSection>
        </Card>
      </div>
    </Page>
  );
}
```

2. Добавить одну запись в `MODULES` в [app/modules.tsx](../ui/src/app/modules.tsx):

```ts
{ id: "harvest", label: "Harvest", icon: Sprout, group: "craft", component: HarvestPage, acceptsItem: true },
```

Навигация, палитра `Ctrl+K` и «Передать в модуль» подхватят модуль сами.

### Правила страницы

- **Без прокрутки.** Страница помещается в 1440×900 и не ломается на 1280×720. Колонки — `flex flex-wrap` с `grow basis-*` (`basis-90` = 360 px), чтобы при нехватке ширины они переносились. Большие списки — постранично: `usePageSize` считает, сколько элементов влезает, `Pagination` листает (пример — [CatalogExample](../ui/src/showcase/screens/CatalogExample.tsx)).
- Заголовок и действия — через `Page` (`title`, `subtitle`, `actions`). В группе действий не больше одной `primary`.
- Секции — `Card` + `CardHeader` + `CardSection`, без вложенных карточек.
- Пустые данные — `EmptyState`, загрузка — `Skeleton`, ошибка — `Banner status="danger"` с действием.
- Игровые цвета (`game.*`) — только для того, что они значат в игре, и всегда с текстом или формой (`RarityBadge`, `ItemStateBadge`, `AffixBadge`). Текст обычного мода — `text-text-primary`, не синий.
- Статус всегда с иконкой (`StatusBadge`, `Banner`, `StatusIcon`).
- Никаких элементов автоматизации действий в игре («Авто», «Старт/стоп»): одна клавиша — одно действие игрока.

## Каталог компонентов

| Группа | Компоненты |
|---|---|
| Кнопки | `Button` (primary / secondary / ghost / danger-ghost, `icon`, `block`), `IconButton` (обязателен `label`) |
| Поля | `Field` (подпись + подсказка/ошибка), `Input`, `SearchInput`, `Select`, `HotkeyInput` |
| Переключатели | `Checkbox`, `RadioGroup`, `Switch`, `Slider` |
| Навигация | `Tabs`, `SegmentedControl`, `Chip`, `Pagination` |
| Всплывающие | `Tooltip`, `Popover`, `Menu`, `Dialog`, `toast()` |
| Метки | `Badge`, `StatusBadge`, `Kbd`, `Hotkey`, `StatusIcon`, `ProgressBar` |
| Контейнеры | `Card`, `CardHeader`, `CardSection`, `Panel`, `ListRow`, `Table` |
| Состояния | `Banner`, `EmptyState`, `Skeleton` |
| Игровые | `RarityBadge`, `AffixBadge`, `TierBadge`, `ModTypeTag`, `ItemStateBadge`, `ModLine`, `ModList`, `ModText`, `Price`, `PriceConversion`, `CurrencyIcon`, `FreshnessTag`, `Sockets`, `ItemIcon`, `ItemHeader`, `ItemBaseLine`, `ItemProperties` |
| Крафт | `Verdict`, `CheckMark`, `GoalCondition`, `PlanStep`, `PlanTotal` |
| Оболочка | `AppShell`, `Page`, `TitleBar`, `WindowControls`, `LeagueSelect`, `Sidebar`, `StatusBar`, `CurrentItemPanel`, `CommandPalette`, `AppLogo` (временная монограмма), `SplashScreen` (экран запуска) |
| Оверлей | `OverlayFrame`, `OverlaySection` |
| Хуки | `usePageSize`, `useHotkey` |

Игровые типы (`Item`, `ItemMod`, `ModSegment`, `Rarity`…) — в [game/types.ts](../ui/src/design-system/game/types.ts). По форме они повторяют то, что будет отдавать Rust-парсер (`crates/item-parser`).

## Как менять токены

1. Править `ui/src/design-system/tokens/tokens.json` (формат W3C Design Tokens).
2. `pnpm tokens` — пересобирает `tokens.css`, `theme.css`, `tokens.ts`. Сгенерированные файлы руками не трогать.
3. Новый токен сразу доступен как класс по правилу «класс = путь токена».

Генератор — [scripts/build-tokens.mjs](../scripts/build-tokens.mjs) (перенос `build_tokens.py` из передачи на Node; при переносе вывод `tokens.css` сверен с исходным байт в байт).

**Токены, добавленные при переносе** (в передаче их не было):

| Токен | Значение | Зачем |
|---|---|---|
| `font.letter-spacing.caps` | 0.06em | разрядка подписей капсом (бейджи, заголовки групп) |
| `font.size.micro` | 11px | только буква внутри сокета (components.md, п. 22) |

## Проверки

| Команда | Что проверяет |
|---|---|
| `pnpm check` | `tsc` + `check:tokens` + тесты |
| `pnpm check:tokens` | нет «сырых» цветов, px-значений в произвольных классах, примитивов |
| `pnpm test` | поведение и доступность компонентов (Vitest + Testing Library) |
| `scripts/screenshots.ps1` | скриншоты экранов 1440×900 и 1280×720 для сверки с макетами (нужен `pnpm dev` и Chrome) |

В режиме разработки нужное состояние можно открыть по адресу: `http://localhost:1420/?module=showcase&screen=craft&collapsed=1&demo=problems&palette=1&splash=0` (`splash=0` — без экрана запуска, `screen=price|craft|catalog` — эталонный экран в витрине).

## Экран запуска

`SplashScreen` (знак, название, полоса прогресса, шаги) показывается поверх оболочки при каждом запуске и гаснет, когда шаги пройдены. Шаги — в [app/startup.ts](../ui/src/app/startup.ts): каждый шаг — асинхронная функция, которая возвращает подпись справа или бросает ошибку (шаг станет красным). Сейчас проверка версии, рукопожатие с API и проверка набора данных — **заглушки с задержкой**; «Поиск окна игры» уже настоящий. Реальная логика подставляется в `run`, экран менять не нужно. Повторить экран запуска можно кнопкой в витрине.

## Отличия от передачи

- **Tauri вместо Electron.** Своя шапка окна: `decorations: false` в `tauri.conf.json`, перетаскивание — атрибут `data-tauri-drag-region` (вместо `-webkit-app-region`), кнопки окна — через `@tauri-apps/api/window` (права — в `src-tauri/capabilities/default.json`).
- **Сайдбар:** группы сворачиваются кликом по заголовку — так навигация выдерживает 10–15 модулей без прокрутки. Автоматического сворачивания при нехватке высоты пока нет.
- **i18n пока не подключён:** строки интерфейса — на русском прямо в коде.
- Светлая тема не делалась: заложена через семантические токены (переопределить `--color-*` на `[data-theme="light"]`).
