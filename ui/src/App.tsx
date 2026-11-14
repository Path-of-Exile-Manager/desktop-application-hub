import { useEffect } from "react";
import { Coins, PanelRightClose, PanelRightOpen, Wrench } from "lucide-react";
import {
  AppShell,
  CommandPalette,
  CurrencyIconsProvider,
  CurrentItemPanel,
  DesignSystemProvider,
  IconButton,
  PRICE_MODES,
  Sidebar,
  SplashScreen,
  StatusBar,
  TitleBar,
  WindowControls,
  useHotkey,
  type PaletteItem,
  type PriceMode,
} from "@/design-system";
import { PriceDisplay, PriceModePicker, usePriceMode, usePriceModeSync } from "@/app/price-mode";
import { useEquippedWeaponSync } from "@/app/weapon";
import { useShell } from "@/app/store";
import { DEVELOPER_MODULE_ID, useModules } from "@/app/modules";
import { useWindowControls } from "@/app/window";
import { gameStatusItem, useGameStatus, useGameStatusSync } from "@/app/game";
import { serverStatusItem, useServerStatus, useServerStatusSync } from "@/app/server";
import { extensionStatusItem, useExtensionStatus, useExtensionStatusSync } from "@/app/extension";
import { useDiscordStatusSync } from "@/app/discord";
import { useMarketSync } from "@/app/market";
import { useBuildPriceEventsSync } from "@/app/build-tracking";
import { datasetStatusItem, NeedConnection, useDataset, useDatasetStatusSync } from "@/app/dataset";
import { LeaguePicker, useLeaguesStatusSync } from "@/app/leagues";
import { useCaptureSync } from "@/app/appraise";
import { useGameHotkeysSync } from "@/app/hotkeys";
import { useAccountStatusSync } from "@/app/account";
import { useSyncStatusSync } from "@/app/sync";
import { useWatchlistSync } from "@/app/watchlist";
import { pricesStatusItem, usePrices, usePricesSync, useCurrencyIcons } from "@/app/prices";
import { useStartup } from "@/app/startup";
import { splashVersion } from "@/app/SplashReplay";
import { DevBadge } from "@/app/DevBadge";
import { MandatoryUpdateScreen, UpdateTitleAction, useUpdaterStatusSync, WhatsNewDialog } from "@/app/updater";

/** При ширине окна меньше 1360 правая панель скрывается автоматически (app-shell.md). */
const NARROW_QUERY = "(max-width: 1359px)";

/** В режиме разработки экран запуска можно пропустить: `?splash=0` (для скриншотов). */
const SKIP_SPLASH = import.meta.env.DEV && new URLSearchParams(location.search).get("splash") === "0";

export default function App() {
  const s = useShell();
  const windowControls = useWindowControls();
  const { modules, navGroups, navFooter, find } = useModules();
  const active = find(s.activeModule);
  const ActivePage = active.component;
  const startup = useStartup(SKIP_SPLASH);

  useGameStatusSync();
  useServerStatusSync();
  useExtensionStatusSync();
  useDiscordStatusSync();
  useMarketSync();
  useBuildPriceEventsSync();
  useDatasetStatusSync();
  useLeaguesStatusSync();
  usePricesSync();
  usePriceModeSync();
  useEquippedWeaponSync();
  useCaptureSync();
  useGameHotkeysSync();
  useAccountStatusSync();
  useSyncStatusSync();
  useWatchlistSync();
  useUpdaterStatusSync();
  const currencyIcons = useCurrencyIcons();
  const prices = usePrices((p) => p.status);
  const priceMode = usePriceMode((p) => p.mode);
  const setPriceMode = usePriceMode((p) => p.setMode);
  const game = useGameStatus();
  const server = useServerStatus();
  const extension = useExtensionStatus();
  const dataset = useDataset((d) => d.status);
  // Без справочника модули работать не могут; настройки и режим разработки — могут (там чинят адрес сервера).
  const needConnection = dataset?.state === "missing" && active.id !== DEVELOPER_MODULE_ID && active.id !== "settings";

  useHotkey(s.hotkeys.palette.join("+"), () => s.setPaletteOpen(true), startup.phase === "done");

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const apply = () => mq.matches && useShell.getState().setPanelHidden(true);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Панель «Текущий предмет» — только когда предмет есть.
  const item = s.currentItem;
  const showPanel = !!item && !s.panelHidden;

  const paletteItems: PaletteItem[] = [
    ...modules.map((m) => ({
      id: `module-${m.id}`,
      group: "Модули",
      label: m.label,
      icon: m.icon,
      keywords: m.keywords,
      onSelect: () => s.openModule(m.id),
    })),
    ...(item
      ? [
          {
            id: "cmd-panel",
            group: "Команды",
            label: s.panelHidden ? "Показать текущий предмет" : "Скрыть текущий предмет",
            icon: s.panelHidden ? PanelRightOpen : PanelRightClose,
            onSelect: () => s.setPanelHidden(!s.panelHidden),
          },
        ]
      : []),
    ...(Object.keys(PRICE_MODES) as PriceMode[])
      .filter((mode) => mode !== priceMode)
      .map((mode) => ({
        id: `cmd-price-mode-${mode}`,
        group: "Команды",
        label: `Валюта цен: ${PRICE_MODES[mode].label}`,
        icon: Coins,
        keywords: `валюта цены chaos divine ${PRICE_MODES[mode].hint}`,
        onSelect: () => setPriceMode(mode),
      })),
  ];

  return (
    <DesignSystemProvider>
      <CurrencyIconsProvider icons={currencyIcons}>
      <PriceDisplay>
      <AppShell
        titlebar={
          <TitleBar
            badge={s.developerMode && <DevBadge />}
            league={<LeaguePicker />}
            currency={<PriceModePicker />}
            onSearchClick={() => s.setPaletteOpen(true)}
            actions={
              <>
                <UpdateTitleAction />
                {s.developerMode && (
                  <IconButton
                    icon={Wrench}
                    label="Режим разработки"
                    active={active.id === DEVELOPER_MODULE_ID}
                    onClick={() => s.openModule(DEVELOPER_MODULE_ID)}
                    className="size-7"
                  />
                )}
                {item && s.panelHidden && (
                  <IconButton icon={PanelRightOpen} label="Показать текущий предмет" onClick={() => s.setPanelHidden(false)} className="size-7" />
                )}
              </>
            }
            windowControls={windowControls && <WindowControls {...windowControls} />}
          />
        }
        sidebar={
          <Sidebar
            groups={navGroups}
            footerItems={navFooter}
            activeId={active.id}
            onSelect={s.openModule}
            collapsed={s.sidebarCollapsed}
            onCollapsedChange={s.setSidebarCollapsed}
          />
        }
        panel={
          showPanel && (
            <CurrentItemPanel
              item={item}
              caught={s.caughtAt ? `пойман в ${s.caughtAt}` : undefined}
              targets={modules.filter((m) => m.acceptsItem).map((m) => ({ id: m.id, label: m.label, icon: m.icon }))}
              activeModuleId={active.id}
              onSend={s.openModule}
              onHide={() => s.setPanelHidden(true)}
              checkHotkey={s.hotkeys.check}
            />
          )
        }
        statusbar={<StatusBar items={[gameStatusItem(game), serverStatusItem(server), datasetStatusItem(dataset), pricesStatusItem(prices), extensionStatusItem(extension)].filter((i) => i !== null)} hint={`${s.hotkeys.palette.join(" + ")} — поиск и команды`} />}
      >
        {needConnection && dataset ? <NeedConnection status={dataset} /> : <ActivePage key={active.id} />}
      </AppShell>
      <MandatoryUpdateScreen />
      <WhatsNewDialog enabled={startup.phase === "done"} />
      <CommandPalette open={s.paletteOpen} onOpenChange={s.setPaletteOpen} items={paletteItems} groups={["Модули", "Команды"]} />
      {startup.phase !== "done" && <SplashScreen steps={startup.steps} version={splashVersion(s.developerMode)} leaving={startup.phase === "leaving"} />}
      </PriceDisplay>
      </CurrencyIconsProvider>
    </DesignSystemProvider>
  );
}
