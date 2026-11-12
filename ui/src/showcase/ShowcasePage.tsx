import { useState, type ReactNode } from "react";
import { Bookmark, Copy, ExternalLink, Inbox, Pencil, Search, Trash2 } from "lucide-react";
import {
  AffixBadge,
  AppLogo,
  Badge,
  LeagueSelect,
  Banner,
  Button,
  Card,
  CardHeader,
  CardSection,
  CheckMark,
  Checkbox,
  Chip,
  COLOR_TOKENS_FOR_SHOWCASE,
  CurrencyIcon,
  Dialog,
  EmptyState,
  Field,
  FreshnessTag,
  GoalCondition,
  Hotkey,
  HotkeyInput,
  IconButton,
  Input,
  ItemIcon,
  ItemStateBadge,
  Kbd,
  ListRow,
  Menu,
  ModLine,
  ModTypeTag,
  Pagination,
  PlanStep,
  PlanTotal,
  Popover,
  MarketPrice,
  Price,
  PriceConversion,
  PriceDisplayProvider,
  PriceModeSelect,
  PRICE_MODES,
  ProgressBar,
  RadioGroup,
  RarityBadge,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Sockets,
  StatusBadge,
  Switch,
  Tabs,
  TierBadge,
  Tooltip,
  Verdict,
  toast,
  usePriceText,
  type ItemMod,
  type PriceMode,
  type Rarity,
} from "./showcase-imports";
import { DIVINE_IN_CHAOS, DOOM_SHELL, DOOM_SHELL_DIVINE, DOOM_SHELL_PRICE, LEAGUES, SIMILAR_COUNT } from "./demo-data";
import { OverlayPriceCheck } from "@/modules/price-check/OverlayPriceCheck";
import { PriceCheckExample } from "./screens/PriceCheckExample";
import { CraftExample } from "./screens/CraftExample";
import { CatalogExample } from "./screens/CatalogExample";

const RARITIES: Rarity[] = ["normal", "magic", "rare", "unique", "gem", "currency", "divination"];

type View = "components" | "price" | "craft" | "catalog";
const VIEWS: { value: View; label: string }[] = [
  { value: "components", label: "Компоненты" },
  { value: "price", label: "Экран: Price check" },
  { value: "craft", label: "Экран: крафт" },
  { value: "catalog", label: "Экран: справочник" },
];

/** В режиме разработки вид можно открыть по адресу: `?module=showcase&screen=craft`. */
const initialView = (): View => {
  const v = new URLSearchParams(location.search).get("screen");
  return VIEWS.some((x) => x.value === v) ? (v as View) : "components";
};

/**
 * Витрина дизайн-системы — только в режиме разработки.
 * «Компоненты» — всё из @/design-system во всех состояниях; «Экраны» — эталонные экраны из макетов на демо-данных.
 * Исключение из правила «без прокрутки»: это служебная страница, она прокручивается.
 */
export function ShowcasePage() {
  const [view, setView] = useState<View>(initialView);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-300 flex-col gap-8 px-page-padding-x py-page-padding-y">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Витрина дизайн-системы</h1>
            <p className="text-label text-text-secondary">
              Компоненты из <span className="font-mono">@/design-system</span> и эталонные экраны на демо-данных. Правила — в docs/design-system.md.
            </p>
          </div>
          <SegmentedControl aria-label="Раздел витрины" value={view} onValueChange={setView} options={VIEWS} />
        </header>
        {view === "components" ? <Components /> : <ScreenFrame view={view} />}
      </div>
    </div>
  );
}

/** Эталонный экран в рамке размера области модуля (окно 1440×900). */
function ScreenFrame({ view }: { view: Exclude<View, "components"> }) {
  const Screen = { price: PriceCheckExample, craft: CraftExample, catalog: CatalogExample }[view];
  return (
    <div className="h-208 overflow-hidden rounded-lg border border-border-default bg-bg-app">
      <Screen />
    </div>
  );
}

function Components() {
  return (
    <>
        <ShellStates />
        <Tokens />
        <Typography />
        <Buttons />
        <Fields />
        <Toggles />
        <Navigation />
        <Popups />
        <Badges />
        <GameSection />
        <Lists />
        <FeedbackSection />
        <CraftSection />
        <OverlaySection />
        <DensitySection />
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 border-b border-border-subtle pb-2">
        <h2 className="text-body-lg font-semibold">{title}</h2>
        {note && <span className="text-label text-text-secondary">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label && <span className="w-32 shrink-0 text-label text-text-secondary">{label}</span>}
      {children}
    </div>
  );
}

function ShellStates() {
  const [league, setLeague] = useState(LEAGUES[0].id);
  const [priceMode, setPriceMode] = useState<PriceMode>("auto");
  return (
    <Section title="Оболочка" note="симуляция «игра не найдена» и повтор экрана запуска — на странице «Режим разработки»">
      <Row label="Знак">
        <AppLogo size={20} />
        <AppLogo size={40} />
        <AppLogo size={64} />
      </Row>
      <Row label="Лига">
        <LeagueSelect leagues={LEAGUES} value={league} onValueChange={setLeague} />
      </Row>
      <Row label="Валюта цен">
        <PriceModeSelect value={priceMode} onValueChange={setPriceMode} divineChaos={DIVINE_IN_CHAOS} />
        <PriceModeSelect value="auto" onValueChange={() => {}} divineChaos={null} />
        <span className="text-label text-text-secondary">вторая — без курса</span>
      </Row>
      <PriceDisplayProvider mode={priceMode} divineChaos={DIVINE_IN_CHAOS}>
        <Row label={`Цены · ${PRICE_MODES[priceMode].label}`}>
          {[3, 120, 450, -260].map((chaos) => (
            <Card key={chaos} className="px-3 py-2">
              <MarketPrice chaos={chaos} approx size="md" />
            </Card>
          ))}
          <MarketPrice chaos={450} approx size="xl" layout="stack" conversionClassName="text-body" />
          <PriceTextDemo />
        </Row>
      </PriceDisplayProvider>
    </Section>
  );
}

/** Строкой — для подсказок и `title`: режим и курс берутся из провайдера. */
function PriceTextDemo() {
  const text = usePriceText();
  return (
    <span className="font-mono text-label text-text-secondary">
      {text(3)} · {text(450)}
    </span>
  );
}

function Tokens() {
  return (
    <Section title="Цвета" note="класс = путь токена: bg-bg-surface, text-text-secondary, border-game-rarity-rare">
      <div className="grid grid-cols-6 gap-2">
        {COLOR_TOKENS_FOR_SHOWCASE.map(({ name, cssVar }) => (
          <div key={name} className="flex flex-col gap-1">
            <div className="h-10 rounded-md border border-border-default" style={{ background: `var(${cssVar})` }} />
            <span className="truncate font-mono text-caption text-text-secondary" title={cssVar}>
              {name}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Typography() {
  const sizes = [
    ["text-display", "Display 28"],
    ["text-title", "Title 22 — заголовок модуля"],
    ["text-title-sm", "Title-sm 18 — имя предмета"],
    ["text-body-lg", "Body-lg 16"],
    ["text-body", "Body 14 — основной текст, строки модов"],
    ["text-label", "Label 13 — метки, бейджи; минимум в оверлее"],
    ["text-caption", "Caption 12 — только основное окно"],
  ] as const;
  return (
    <Section title="Типографика" note="Inter + JetBrains Mono, табличные цифры">
      <div className="flex flex-col gap-2">
        {sizes.map(([cls, text]) => (
          <p key={cls} className={cls}>
            {text}
          </p>
        ))}
        <p className="flex items-baseline gap-4">
          <span className="font-mono text-number-xl font-semibold">~120</span>
          <span className="font-mono text-number-lg font-semibold">~120</span>
          <span className="font-mono text-body">+105 (100–109)</span>
        </p>
      </div>
    </Section>
  );
}

function Buttons() {
  return (
    <Section title="Кнопки" note="в группе не больше одной primary">
      <Row label="Варианты">
        <Button variant="primary" icon={ExternalLink}>Искать на сайте торговли</Button>
        <Button variant="secondary">В ассистент крафта</Button>
        <Button variant="ghost" icon={Bookmark}>В закладки</Button>
        <Button variant="danger-ghost" icon={Trash2}>Удалить</Button>
      </Row>
      <Row label="Неактивные">
        <Button variant="primary" disabled>Primary</Button>
        <Button variant="secondary" disabled>Secondary</Button>
        <Button variant="ghost" disabled>Ghost</Button>
      </Row>
      <Row label="Кнопки-иконки">
        <IconButton icon={Pencil} label="Изменить" />
        <IconButton icon={Copy} label="Копировать" tooltip={<>Копировать <Kbd>Ctrl C</Kbd></>} />
        <IconButton icon={Bookmark} label="Закрепить" active />
        <IconButton icon={Trash2} label="Удалить" disabled />
      </Row>
    </Section>
  );
}

function Fields() {
  const [text, setText] = useState("Settlers of Kalguur");
  const [search, setSearch] = useState("vaal");
  const [select, setSelect] = useState("chaos");
  const [keys, setKeys] = useState(["Ctrl", "D"]);
  return (
    <Section title="Поля ввода">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Поле" hint="Подсказка под полем">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <Field label="С ошибкой" error="Лига не найдена">
          {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} defaultValue="Necropolis" />}
        </Field>
        <Field label="Неактивное">{(p) => <Input id={p.id} disabled value="—" readOnly />}</Field>
        <Field label="Поиск">{() => <SearchInput value={search} onValueChange={setSearch} placeholder="Название предмета…" />}</Field>
        <Field label="Выпадающий список">
          {(p) => (
            <Select
              id={p.id}
              value={select}
              onValueChange={setSelect}
              options={[
                { value: "chaos", label: "Chaos Orb" },
                { value: "divine", label: "Divine Orb", hint: "≈ 200 c" },
                { value: "mirror", label: "Mirror of Kalandra", disabled: true },
              ]}
            />
          )}
        </Field>
        <Field label="Горячая клавиша" hint="Кликните и нажмите сочетание">
          {(p) => <HotkeyInput id={p.id} value={keys} onChange={setKeys} />}
        </Field>
      </div>
    </Section>
  );
}

function Toggles() {
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState("a");
  const [sw, setSw] = useState(true);
  const [slider, setSlider] = useState(440);
  return (
    <Section title="Переключатели">
      <Row label="Чекбокс">
        <Checkbox checked={check} onCheckedChange={setCheck} label="Только продаваемое" />
        <Checkbox checked="indeterminate" onCheckedChange={() => {}} label="Частично" />
        <Checkbox checked={false} onCheckedChange={() => {}} label="Неактивный" disabled />
      </Row>
      <Row label="Радио">
        <RadioGroup aria-label="Пример" orientation="horizontal" value={radio} onValueChange={setRadio} options={[{ value: "a", label: "chaos" }, { value: "b", label: "divine" }, { value: "c", label: "Нельзя", disabled: true }]} />
      </Row>
      <Row label="Switch">
        <Switch checked={sw} onCheckedChange={setSw} label="Закреплять оверлей" />
        <Switch checked={false} onCheckedChange={() => {}} label="Неактивный" disabled />
      </Row>
      <Row label="Слайдер">
        <Slider aria-label="Ширина" min={360} max={480} step={10} value={slider} onValueChange={setSlider} format={(v) => `${v} px`} className="w-80" />
      </Row>
    </Section>
  );
}

function Navigation() {
  const [tab, setTab] = useState("mods");
  const [seg, setSeg] = useState("all");
  const [chips, setChips] = useState<string[]>(["Body Armour"]);
  return (
    <Section title="Вкладки, сегменты, чипы">
      <Tabs
        value={tab}
        onValueChange={setTab}
        aria-label="Пример вкладок"
        items={[
          { value: "mods", label: "Моды", content: <p className="text-label text-text-secondary">Содержимое вкладки «Моды»</p> },
          { value: "price", label: "Цена", content: <p className="text-label text-text-secondary">Содержимое вкладки «Цена»</p> },
          { value: "off", label: "Недоступно", disabled: true },
        ]}
      />
      <Row label="Сегменты">
        <SegmentedControl aria-label="Редкость" value={seg} onValueChange={setSeg} options={[{ value: "all", label: "Все" }, { value: "normal", label: "Обычные" }, { value: "unique", label: "Уникальные" }]} />
      </Row>
      <Row label="Чипы-фильтры">
        {["Body Armour", "Helmet", "Ring", "Currency"].map((c) => (
          <Chip key={c} selected={chips.includes(c)} onSelectedChange={(on) => setChips(on ? [...chips, c] : chips.filter((x) => x !== c))}>
            {c}
          </Chip>
        ))}
      </Row>
    </Section>
  );
}

function Popups() {
  const [dialog, setDialog] = useState(false);
  return (
    <Section title="Всплывающие элементы">
      <Row>
        <Tooltip content="Подсказка: задержка 400 мс">
          <Button>Наведите — подсказка</Button>
        </Tooltip>
        <Popover trigger={<Button>Поповер</Button>}>
          <p className="font-semibold">Окно игры найдено</p>
          <p className="text-label text-text-secondary">Path of Exile · Оконный без рамки</p>
        </Popover>
        <Menu
          trigger={<Button>Меню</Button>}
          items={[
            { type: "label", label: "Предмет" },
            { label: "Копировать текст", icon: Copy, shortcut: "Ctrl C", onSelect: () => toast({ status: "success", title: "Скопировано" }) },
            { label: "В закладки", icon: Bookmark, onSelect: () => {} },
            { type: "separator" },
            { label: "Недоступно", icon: Search, disabled: true, onSelect: () => {} },
          ]}
        />
        <Button onClick={() => setDialog(true)}>Модальное окно</Button>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Удалить закладку?"
          description="Поиск «Doom Shell 6L» будет удалён без возможности восстановления."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>Отмена</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>Удалить</Button>
            </>
          }
        />
      </Row>
      <Row label="Тосты">
        {(["success", "warning", "danger", "info"] as const).map((st) => (
          <Button key={st} variant="secondary" onClick={() => toast({ status: st, title: `Тост: ${st}`, description: st === "danger" ? "Закрывается вручную" : "Скроется через 5 секунд" })}>
            {st}
          </Button>
        ))}
      </Row>
    </Section>
  );
}

function Badges() {
  return (
    <Section title="Бейджи, клавиши" note="бейдж всегда содержит текст">
      <Row label="Нейтральные">
        <Badge>MIRRORED</Badge>
        <Badge tone="muted">23 похожих</Badge>
        <Badge caps>Split</Badge>
      </Row>
      <Row label="Статусы">
        <StatusBadge status="success">данные свежие · 2 мин</StatusBadge>
        <StatusBadge status="warning">старше часа</StatusBadge>
        <StatusBadge status="danger">ошибка</StatusBadge>
        <StatusBadge status="info">информация</StatusBadge>
      </Row>
      <Row label="Клавиши">
        <Hotkey keys={["Ctrl", "D"]} />
        <Hotkey keys={["Ctrl", "K"]} variant="single" />
        <Kbd>Esc</Kbd>
      </Row>
      <Row label="Прогресс">
        <ProgressBar value={64} label="Обновление данных" />
      </Row>
    </Section>
  );
}

const MOD_EXAMPLES: ItemMod[] = [
  { affix: "prefix", tier: 1, segments: [{ value: "+105", range: [100, 109] }, " to maximum Energy Shield"] },
  { affix: "suffix", tier: 3, segments: [{ value: "+38", range: [36, 41] }, "% to Fire Resistance"] },
  { affix: "suffix", kind: "crafted", tier: null, segments: [{ value: "+15", range: [15, 16] }, "% to Cold Resistance"] },
  { affix: "prefix", kind: "fractured", tier: 2, segments: [{ value: "+87", range: [80, 89] }, " to maximum Life"] },
  { kind: "implicit", segments: ["Adds ", { value: "5", range: [4, 6] }, " to ", { value: "10", range: [9, 12] }, " Fire Damage to Attacks"] },
  { kind: "enchant", segments: [{ value: "40%", range: [40, 40] }, " increased Fireball Damage"] },
];

function GameSection() {
  return (
    <Section title="Игровые компоненты" note="игровые цвета — только по смыслу и всегда с текстом или формой">
      <Row label="Редкость">
        {RARITIES.map((r) => (
          <RarityBadge key={r} rarity={r} />
        ))}
      </Row>
      <Row label="Редкость sm">
        {RARITIES.map((r) => (
          <RarityBadge key={r} rarity={r} size="sm" />
        ))}
      </Row>
      <Row label="Аффикс, тир, тип">
        <AffixBadge affix="prefix" />
        <AffixBadge affix="suffix" />
        <TierBadge tier={1} />
        <TierBadge tier={2} />
        <TierBadge tier={null} />
        <ModTypeTag kind="crafted" />
        <ModTypeTag kind="fractured" />
        <ModTypeTag kind="implicit" />
        <ModTypeTag kind="enchant" />
      </Row>
      <Row label="Состояние">
        <ItemStateBadge state="corrupted" />
        <ItemStateBadge state="mirrored" />
        <ItemStateBadge state="split" />
        <ItemStateBadge state="unidentified" />
      </Row>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Строки модов" aside="ModLine md" />
          <CardSection className="flex flex-col gap-2">
            {MOD_EXAMPLES.map((m, i) => (
              <ModLine key={i} mod={m} />
            ))}
          </CardSection>
        </Card>
        <Card>
          <CardHeader title="Компактные строки" aside="ModLine sm — панель «Текущий предмет»" />
          <CardSection className="flex w-75 flex-col gap-1.5">
            {MOD_EXAMPLES.map((m, i) => (
              <ModLine key={i} mod={m} size="sm" />
            ))}
          </CardSection>
        </Card>
      </div>
      <Row label="Цена">
        <Price price={DOOM_SHELL_PRICE} approx size="xl" />
        <Price price={DOOM_SHELL_PRICE} approx size="lg" />
        <Price price={{ amount: 105, currency: "chaos" }} size="md" />
        <PriceConversion price={DOOM_SHELL_DIVINE} />
        <FreshnessTag fresh>данные свежие · 2 мин</FreshnessTag>
        <FreshnessTag fresh={false}>старше часа</FreshnessTag>
      </Row>
      <Row label="Валюта">
        <CurrencyIcon currency="chaos" size={24} />
        <CurrencyIcon currency="divine" size={24} />
        <CurrencyIcon currency="exalted" size={24} />
        <CurrencyIcon currency="mirror" size={24} />
      </Row>
      <Row label="Сокеты">
        <Sockets groups={[["B", "B", "B", "B", "B", "G"]]} />
        <Sockets groups={[["R", "R"], ["G", "B", "W"]]} />
        <Sockets groups={[["B", "B", "B", "B", "B", "G"]]} variant="text" />
      </Row>
      <Row label="Иконки предметов">
        {([[1, 1], [1, 3], [2, 2], [2, 3], [2, 4]] as [number, number][]).map((size) => (
          <div key={size.join("x")} className="w-32 overflow-hidden rounded-lg border border-border-default">
            <ItemIcon size={size} alt="Заглушка" />
          </div>
        ))}
        <ItemIcon size={[2, 3]} alt="Миниатюра" variant="thumb" />
        <ItemIcon size={[1, 1]} alt="Миниатюра" variant="thumb" />
      </Row>
    </Section>
  );
}

function Lists() {
  const [page, setPage] = useState(3);
  const [selected, setSelected] = useState("2");
  return (
    <Section title="Списки и пагинация" note="вместо прокрутки — постранично">
      <Card className="w-110 overflow-hidden">
        {[
          { id: "1", title: "Doom Shell", subtitle: "Vaal Regalia · 6L", price: "~120 c" },
          { id: "2", title: "Headhunter", subtitle: "Leather Belt", price: "~38 div" },
          { id: "3", title: "Tabula Rasa", subtitle: "Simple Robe", price: "~10 c" },
        ].map((r) => (
          <ListRow
            key={r.id}
            selected={selected === r.id}
            onClick={() => setSelected(r.id)}
            leading={<ItemIcon size={[2, 3]} alt={r.title} variant="thumb" />}
            title={r.title}
            subtitle={r.subtitle}
            trailing={<span className="font-mono">{r.price}</span>}
          />
        ))}
      </Card>
      <Pagination page={page} pageSize={12} total={240} onPageChange={setPage} />
    </Section>
  );
}

function FeedbackSection() {
  return (
    <Section title="Баннеры, пусто, загрузка">
      <Banner status="danger" title="Окно игры не найдено — горячие клавиши сейчас не работают" actions={<><Button>Указать окно</Button><Button variant="ghost">Подробнее</Button></>}>
        Запустите Path of Exile или укажите окно вручную.
      </Banner>
      <Banner status="warning" title="Данные обновляются">Цены могут быть неточными ещё пару минут.</Banner>
      <Banner status="success" title="Набор данных 3.29.3.3 установлен" />
      <Banner status="info" title="Расширение браузера не подключено">Оно нужно только для закладок.</Banner>
      <div className="grid grid-cols-2 gap-4">
        <Card className="h-60">
          <EmptyState icon={Inbox} title="История пуста" action={<Hotkey keys={["Ctrl", "D"]} />}>
            Наведите на предмет в игре и нажмите сочетание.
          </EmptyState>
        </Card>
        <Card>
          <CardSection className="flex flex-col gap-2.5">
            <Skeleton className="h-4.5 w-20" />
            <Skeleton className="h-6 w-48" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-5" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4.5 w-6.5" />
              </div>
            ))}
            <Skeleton className="mt-2 h-9 w-32" />
          </CardSection>
        </Card>
      </div>
    </Section>
  );
}

function CraftSection() {
  return (
    <Section title="Ассистент крафта" note="только расчёт и подсказки">
      <Verdict state="continue" title="Продолжай · шаг 2" summary={<><CheckMark ok>Life T2</CheckMark> · <CheckMark ok={false}>ES T4</CheckMark></>} />
      <Verdict state="done" title="Цель достигнута" summary={<><CheckMark ok>Life T2</CheckMark> · <CheckMark ok>ES T1</CheckMark></>} />
      <div className="grid grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <CardHeader title="Условия" className="border-b-0" />
          <GoalCondition status="ok" title="+# to maximum Life" requirement="тир T1–T2" current="сейчас T2" />
          <GoalCondition status="fail" title="+# to maximum Energy Shield" requirement="тир T1–T2" current="сейчас T4" />
          <GoalCondition status="pending" title="Два сопротивления" requirement="любые, тир ≥ T3" current="ждёт шага 3" />
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Шаги" className="border-b-0" />
          <PlanStep index={1} state="done" title="Essence of Greed" chance="100%" cost="~4 c" attempts="1 попытка" />
          <PlanStep index={2} state="current" title="Реролл до ES T1–T2" chance="~8%" cost="~4 c" attempts="~12 попыток" />
          <PlanStep index={3} state="pending" title="Верстак" chance="100%" cost="~8 c" attempts="1 попытка" />
          <PlanTotal expected="~60 chaos" aside="потрачено ~8" />
        </Card>
      </div>
    </Section>
  );
}

function OverlaySection() {
  const [pinned, setPinned] = useState(false);
  const scene = (light: boolean) => (
    <div
      className={light ? "bg-text-primary" : "bg-bg-app"}
      style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 24px, var(--color-border-default) 24px 26px)" }} // tokens-allow: штриховка заглушки
    >
      <div className="flex flex-col gap-2 p-6">
        <span className={light ? "text-label text-text-inverse" : "text-label text-text-secondary"}>
          Заглушка: {light ? "светлая" : "тёмная"} игровая локация
        </span>
        <OverlayPriceCheck
          item={DOOM_SHELL}
          price={DOOM_SHELL_PRICE}
          conversion={DOOM_SHELL_DIVINE}
          similar={SIMILAR_COUNT}
          pinned={pinned}
          onPinnedChange={setPinned}
          onClose={() => toast({ status: "info", title: "Оверлей закрыт" })}
          onOpenInWindow={() => {}}
          onOpenCraft={() => {}}
        />
      </div>
    </div>
  );
  return (
    <Section title="Оверлей поверх игры" note="экран A4: фон 94% + blur, текст ≥ 13 px">
      <div className="grid grid-cols-2 gap-4 overflow-hidden rounded-lg border border-border-default">
        {scene(false)}
        {scene(true)}
      </div>
    </Section>
  );
}

function DensitySection() {
  return (
    <Section title="Плотность" note='data-density="compact" — оверлей и расширение браузера'>
      <div className="grid grid-cols-2 gap-4">
        {(["default", "compact"] as const).map((d) => (
          <Card key={d} data-density={d === "compact" ? "compact" : undefined}>
            <CardHeader title={d} />
            <CardSection className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Button variant="primary">Искать</Button>
                <Button>Отмена</Button>
                <IconButton icon={Bookmark} label="В закладки" />
              </div>
              <Input placeholder="Поле" />
              <Switch checked onCheckedChange={() => {}} label="Переключатель" />
              <Hotkey keys={["Ctrl", "D"]} />
            </CardSection>
          </Card>
        ))}
      </div>
    </Section>
  );
}
