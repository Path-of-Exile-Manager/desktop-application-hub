import { useEffect } from "react";
import { PanelRightClose, PanelRightOpen, ShieldCheck } from "lucide-react";
import {
  AppShell,
  CommandPalette,
  CurrentItemPanel,
  DesignSystemProvider,
  IconButton,
  Sidebar,
  SplashScreen,
  StatusBar,
  TitleBar,
  WindowControls,
  useHotkey,
  type PaletteItem,
} from "@/design-system";
import { useShell } from "@/app/store";
import { MODULES, NAV_FOOTER, NAV_GROUPS, findModule } from "@/app/modules";
import { useWindowControls } from "@/app/window";
import { gameStatusItem, useGameStatus, useGameStatusSync } from "@/app/game";
import { serverStatusItem, useServerStatus, useServerStatusSync } from "@/app/server";
import { extensionStatusItem, useExtensionStatus, useExtensionStatusSync } from "@/app/extension";
import { useStartup } from "@/app/startup";
import { SPLASH_VERSION } from "@/app/SplashReplay";
import { DEVELOPMENT } from "@/app/env";
import { DevBadge } from "@/app/DevBadge";

/** При ширине окна меньше 1360 правая панель скрывается автоматически (app-shell.md). */
const NARROW_QUERY = "(max-width: 1359px)";

/** В режиме разработки экран запуска можно пропустить: `?splash=0` (для скриншотов). */
const SKIP_SPLASH = import.meta.env.DEV && new URLSearchParams(location.search).get("splash") === "0";

export default function App() {
  const s = useShell();
  const windowControls = useWindowControls();
  const active = findModule(s.activeModule);
  const ActivePage = active.component;
  const startup = useStartup(SKIP_SPLASH);

  useGameStatusSync();
  useServerStatusSync();
  useExtensionStatusSync();
  const game = useGameStatus(s.demoProblems);
  const server = useServerStatus(s.demoServerDown);
  const extension = useExtensionStatus(s.demoExtensionConnected);

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
    ...MODULES.map((m) => ({
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
  ];

  return (
    <DesignSystemProvider>
      <AppShell
        titlebar={
          <TitleBar
            badge={DEVELOPMENT && <DevBadge />}
            onSearchClick={() => s.setPaletteOpen(true)}
            actions={
              <>
                {DEVELOPMENT && (
                  <IconButton
                    icon={ShieldCheck}
                    label="Админка"
                    active={active.id === "admin"}
                    onClick={() => s.openModule("admin")}
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
            groups={NAV_GROUPS}
            footerItems={NAV_FOOTER}
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
              targets={MODULES.filter((m) => m.acceptsItem).map((m) => ({ id: m.id, label: m.label, icon: m.icon }))}
              activeModuleId={active.id}
              onSend={s.openModule}
              onHide={() => s.setPanelHidden(true)}
              checkHotkey={s.hotkeys.check}
            />
          )
        }
        statusbar={<StatusBar items={[gameStatusItem(game), serverStatusItem(server), extensionStatusItem(extension)]} hint={`${s.hotkeys.palette.join(" + ")} — поиск и команды`} />}
      >
        <ActivePage key={active.id} />
      </AppShell>
      <CommandPalette open={s.paletteOpen} onOpenChange={s.setPaletteOpen} items={paletteItems} groups={["Модули", "Команды"]} />
      {startup.phase !== "done" && <SplashScreen steps={startup.steps} version={SPLASH_VERSION} leaving={startup.phase === "leaving"} />}
    </DesignSystemProvider>
  );
}
