# Контрасты

WCAG 2.x, отношение контраста. Требование: основной текст ≥ 4.5:1 везде, включая оверлей над светлой локацией.

| Токен | Цвет | на bg.app | на bg.surface | на bg.raised | оверлей над белым* | Итог |
|---|---|---|---|---|---|---|
| `color.text.primary` | `#f1edef` | 17.1 | 16.4 | 15.4 | 14.4 | AA |
| `color.text.secondary` | `#a8a3a6` | 8.0 | 7.7 | 7.2 | 6.7 | AA |
| `color.text.muted` | `#847e82` | 5.0 | 4.8 | 4.5 | 4.2 | AA только в окне |
| `color.text.disabled` | `#676165` | 3.3 | 3.1 | 3.0 | 2.8 | неактивный текст, AA не требуется |
| `color.text.accent` | `#ff72b7` | 7.9 | 7.6 | 7.1 | 6.6 | AA |
| `color.status.success.fg` | `#61cb7c` | 9.8 | 9.4 | 8.8 | 8.2 | AA |
| `color.status.warning.fg` | `#fca942` | 10.3 | 9.9 | 9.3 | 8.6 | AA |
| `color.status.danger.fg` | `#f47759` | 7.2 | 6.9 | 6.5 | 6.0 | AA |
| `color.status.info.fg` | `#a8a3a6` | 8.0 | 7.7 | 7.2 | 6.7 | AA |
| `game.rarity.normal` | `#C8C8C8` | 11.8 | 11.4 | 10.7 | 10.0 | AA |
| `game.rarity.magic` | `#8888FF` | 6.6 | 6.3 | 6.0 | 5.6 | AA |
| `game.rarity.rare` | `#FFFF77` | 18.7 | 17.9 | 16.9 | 15.7 | AA |
| `game.rarity.unique` | `#D07940` | 6.1 | 5.9 | 5.5 | 5.1 | AA |
| `game.rarity.gem` | `#1BA29B` | 6.3 | 6.1 | 5.7 | 5.3 | AA |
| `game.rarity.currency` | `#AA9E82` | 7.5 | 7.2 | 6.8 | 6.3 | AA |
| `game.rarity.divination` | `#0EBAFF` | 9.0 | 8.6 | 8.1 | 7.5 | AA |
| `game.mod.crafted` | `#B4B4FF` | 10.3 | 9.9 | 9.3 | 8.7 | AA |
| `game.mod.fractured` | `#A29162` | 6.4 | 6.1 | 5.8 | 5.4 | AA |
| `game.state.corrupted` | `#F3413C` | 5.3 | 5.1 | 4.8 | 4.5 | AA только в окне |
| `game.raw.unique` | `#AF6025` | 4.3 | 4.1 | 3.9 | 3.6 | не использовать |

| Пара | Цвета | Контраст | Итог |
|---|---|---|---|
| `color.text.on-accent` на `color.accent.solid` | `#0c090b` / `#ec4aa0` | 5.7 | AA |
| белый на `color.accent.solid` | `#ffffff` / `#ec4aa0` | 3.5 | запрещено |

*Худший случай: фон оверлея (94%) над чисто белым участком игры, итоговый цвет `#211d20`.

Выводы: `color.text.muted` в оверлее не используется; `game.state.corrupted` в оверлее — только как жирный капс-бейдж с ромбом (крупный/неосновной текст).
