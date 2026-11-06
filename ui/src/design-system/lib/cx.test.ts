import { describe, expect, it } from "vitest";
import { cx } from "./cx";

describe("cx", () => {
  it("отличает размер шрифта от цвета текста", () => {
    expect(cx("text-body text-text-secondary", "text-label")).toBe("text-text-secondary text-label");
    expect(cx("text-body text-text-secondary", "text-text-primary")).toBe("text-body text-text-primary");
  });

  it("понимает размеры плотности и раскладки", () => {
    expect(cx("h-control-height px-3", "h-row-height")).toBe("px-3 h-row-height");
    expect(cx("w-sidebar-width", "w-sidebar-width-collapsed")).toBe("w-sidebar-width-collapsed");
  });

  it("заменяет цвет фона и радиус", () => {
    expect(cx("bg-bg-surface rounded-md", "bg-bg-hover rounded-lg")).toBe("bg-bg-hover rounded-lg");
  });

  it("пропускает ложные условия", () => {
    expect(cx("a", false && "b", undefined, "c")).toBe("a c");
  });
});
