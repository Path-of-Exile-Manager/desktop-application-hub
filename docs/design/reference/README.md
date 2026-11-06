# Макеты-эталоны

Исходники экранов варианта A из дизайн-холста. Это **эскизы концепции**: по ним сверяют раскладку, иерархию, данные и состояния. Код из них не переносится — компоненты пишутся заново на токенах.

## Формат файлов `.dc.html`

Это HTML с маленьким шаблонизатором редактора дизайна, в браузере напрямую не открывается как готовая страница:

- `<x-dc>` — корень разметки; `<helmet>` — подключение шрифтов;
- `{{name}}` — подстановка значения из `renderVals()` в `<script type="text/x-dc">` внизу файла;
- `<sc-for list="{{items}}" as="it">` — цикл; `<sc-if value="{{flag}}">` — условие;
- `<dc-import name="ModPrice">` — вставка другого файла (`ModPrice.dc.html`) как дочернего компонента; атрибуты становятся его свойствами (`screen="craft"`, `collapsed="{{ true }}"`).

Данные экранов (моды, цены, план крафта, предметы справочника) лежат в `renderVals()` соответствующего файла.

## Цвета в макетах → токены

В макетах цвета записаны значениями. Соответствие:

| В макете | Токен |
|---|---|
| `#0c090b` | `color.bg.app`, `color.text.on-accent` |
| `#130f12` | `color.bg.surface` |
| `#1a1618` | `color.bg.raised` |
| `#211d1f` | `color.bg.hover` |
| `#292528` | `color.bg.active`, `color.border.subtle` |
| `#363134` | `color.border.default` |
| `#4b4649` | `color.border.strong` |
| `#676165` | `color.text.disabled` |
| `#847e82` | `color.text.muted` |
| `#a8a3a6` | `color.text.secondary`, `color.icon.default`, `color.status.info.fg` |
| `#cdc9cb` | `color.icon.strong` (в макетах также вторичный текст повышенной важности — используйте `text.primary` или `text.secondary`) |
| `#f1edef` | `color.text.primary` |
| `#ec4aa0` | `color.accent.solid` |
| `#ff72b7` | `color.text.accent`, `color.border.focus`, `color.accent.solid-hover` |
| `#a9246e` | `color.accent.border` |
| `rgba(236,74,160,0.12)` | `color.bg.selected`, `color.accent.subtle` |
| `rgba(236,74,160,0.08)` | `color.accent.subtle-strong` |
| `#61cb7c` / `#fca942` / `#f47759` | `color.status.success / warning / danger.fg` |
| `rgba(19,15,18,0.94)` | `color.bg.overlay` |
| `rgba(12,9,11,0.6)` | `color.bg.scrim` |
| `#C8C8C8 #8888FF #FFFF77 #D07940 #1BA29B #AA9E82 #0EBAFF` | `game.rarity.*` |
| `#B4B4FF` / `#A29162` | `game.mod.crafted` / `fractured` |
| `#F3413C` | `game.state.corrupted` |
| `#6F8DE8` / `#6FBF5A` | `game.socket.blue` / `green` |

## Файлы

`ShellA` — оболочка (свойства `screen`, `collapsed`, `palette`, `error`); `ScrA2…A6`, `ChkA` — экраны; `ModPrice`, `ModCraft`, `ModCatalog` — модули; `OvA` — виджет оверлея; `GameScene` — заглушка игрового экрана для превью; `Summary` — описание варианта и список предложений.

Растровые снимки экранов можно выгрузить из холста дизайна (меню Share › Export) и положить в `reference/screens/`.
