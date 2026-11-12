import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { CurrencyIconsProvider, DesignSystemProvider, displayPrice } from "@/design-system";
import type { Appraisal } from "@/app/appraise";
import { useDatasetStatusSync } from "@/app/dataset";
import { appraisalToItem } from "@/app/item-view";
import { formatAge, isFresh, useCurrencyIcons, usePrices, type PricesStatus } from "@/app/prices";
import { PriceDisplay, usePriceMode, usePriceModeSync } from "@/app/price-mode";
import { OverlayPriceCheck } from "@/modules/price-check/OverlayPriceCheck";

/**
 * Окно оверлея поверх игры (src-tauri/src/overlay.rs): последняя оценка предмета.
 * Esc — закрыть и вернуть фокус игре; клик мимо — закрыть, если не закреплён.
 * Высота окна подгоняется под содержимое, фон прозрачный.
 */
export function OverlayApp() {
  const [appraisal, setAppraisal] = useState<Appraisal | null>(null);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const root = useRef<HTMLDivElement>(null);

  useDatasetStatusSync();
  usePriceModeSync();
  const currencyIcons = useCurrencyIcons();
  const prices = usePrices((p) => p.status);
  const priceMode = usePriceMode((p) => p.mode);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const window = getCurrentWindow();
    const unlisteners = [
      listen<Appraisal>("item-appraised", (e) => setAppraisal(e.payload)),
      listen<PricesStatus>("prices-status", (e) => usePrices.setState({ status: e.payload })),
      window.onFocusChanged(({ payload: focused }) => {
        if (!focused && !pinnedRef.current) void invoke("overlay_hide", { restoreGame: false });
      }),
    ];
    invoke<Appraisal | null>("item_last_appraisal").then((last) => last && setAppraisal(last));
    invoke<PricesStatus>("prices_status").then((status) => usePrices.setState({ status }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("overlay_hide", { restoreGame: true });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  // Окно — по размеру рамки: прозрачные поля окна всё равно перехватывали бы клики по игре.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) void getCurrentWindow().setSize(new LogicalSize(Math.ceil(width), Math.ceil(height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [appraisal]);

  if (!appraisal) return null;
  const price = appraisal.price;
  const shown = price ? displayPrice(price.chaosValue, prices?.divineChaos, priceMode) : null;
  const note = !price
    ? appraisal.catalogItem
      ? "в этой лиге цены нет"
      : "предмета нет в справочнике"
    : [
        appraisal.priceMatch === "nearest" && "ближайший вариант",
        !price.reliable && "мало данных",
        isFresh(price.updatedAt) ? `свежие · ${formatAge(price.updatedAt)}` : `${formatAge(price.updatedAt)} назад`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <DesignSystemProvider toasts={false}>
      <CurrencyIconsProvider icons={currencyIcons}>
        <PriceDisplay>
        <div ref={root} className="inline-block">
          <OverlayPriceCheck
            item={appraisalToItem(appraisal)}
            price={shown?.primary ?? null}
            conversion={shown?.secondary ?? null}
            priceNote={note}
            pinned={pinned}
            onPinnedChange={setPinned}
            onClose={() => void invoke("overlay_hide", { restoreGame: true })}
            onOpenInWindow={() => void invoke("overlay_open_main")}
          />
        </div>
        </PriceDisplay>
      </CurrencyIconsProvider>
    </DesignSystemProvider>
  );
}
