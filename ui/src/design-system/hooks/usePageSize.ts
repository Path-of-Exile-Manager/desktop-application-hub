import { useLayoutEffect, useRef, useState } from "react";

/**
 * Сколько элементов помещается в доступную высоту (или сетку) без прокрутки.
 * Правило app-shell.md: большие наборы — постранично, число элементов на странице
 * считается от доступной высоты через ResizeObserver.
 *
 * ```tsx
 * const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: 32 });
 * <div ref={ref} className="min-h-0 flex-1">…</div>
 * ```
 */
export function usePageSize<T extends HTMLElement>({
  itemHeight,
  itemMinWidth,
  gap = 0,
  min = 1,
}: {
  /** Высота элемента (строки или плитки), px. */
  itemHeight: number;
  /** Для сеток: минимальная ширина плитки, px. Без неё — одна колонка. */
  itemMinWidth?: number;
  /** Зазор между элементами, px. */
  gap?: number;
  min?: number;
}) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ pageSize: min, columns: 1, rows: min });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const rows = Math.max(1, Math.floor((height + gap) / (itemHeight + gap)));
      const columns = itemMinWidth ? Math.max(1, Math.floor((width + gap) / (itemMinWidth + gap))) : 1;
      const pageSize = Math.max(min, rows * columns);
      setSize((prev) => (prev.pageSize === pageSize && prev.columns === columns && prev.rows === rows ? prev : { pageSize, columns, rows }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Подстраховка: высота соседей меняется после загрузки шрифтов, окно — при ресайзе.
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && measure());
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [itemHeight, itemMinWidth, gap, min]);

  return { ref, ...size };
}
