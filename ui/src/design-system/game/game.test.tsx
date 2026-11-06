import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModLine, formatRange, modToText } from "./ModLine";
import { RarityBadge } from "./Rarity";
import { TierBadge, ItemStateBadge, AffixBadge } from "./ModBadges";
import { Sockets, maxLinks, socketsToText } from "./Sockets";
import { Price, formatAmount } from "./Price";
import { pickFairly } from "../shell/CommandPalette";
import type { ItemMod } from "./types";

const crafted: ItemMod = {
  affix: "suffix",
  kind: "crafted",
  tier: null,
  segments: [{ value: "+15", range: [15, 16] }, "% to Cold Resistance"],
};

describe("текст модов", () => {
  it("диапазон с en dash", () => {
    expect(formatRange([100, 109])).toBe("(100–109)");
    expect(formatRange([40, 40])).toBe("(40)");
  });

  it("мод одной строкой", () => {
    expect(modToText(crafted.segments)).toBe("+15 (15–16)% to Cold Resistance");
  });
});

describe("смысл не только цветом", () => {
  it("редкость подписана текстом", () => {
    render(<RarityBadge rarity="unique" />);
    expect(screen.getByText("Unique")).toHaveClass("uppercase");
  });

  it("строка мода: аффикс, тег типа и тир текстом", () => {
    render(<ModLine mod={crafted} />);
    expect(screen.getByLabelText("Суффикс")).toHaveTextContent("S");
    expect(screen.getByText("crafted")).toBeInTheDocument();
    expect(screen.getByLabelText("Без тира")).toHaveTextContent("—");
  });

  it("тир T1 выделен, остальные нейтральны", () => {
    render(
      <>
        <TierBadge tier={1} />
        <TierBadge tier={3} />
      </>,
    );
    expect(screen.getByLabelText("Тир 1")).toHaveClass("text-text-accent");
    expect(screen.getByLabelText("Тир 3")).toHaveClass("text-text-secondary");
  });

  it("префикс и суффикс различаются формой", () => {
    render(
      <>
        <AffixBadge affix="prefix" />
        <AffixBadge affix="suffix" />
      </>,
    );
    expect(screen.getByLabelText("Префикс")).toHaveClass("rounded-sm");
    expect(screen.getByLabelText("Суффикс")).toHaveClass("rounded-full");
  });

  it("порча — ромб и текст", () => {
    render(<ItemStateBadge state="corrupted" />);
    expect(screen.getByText("Corrupted")).toBeInTheDocument();
  });
});

describe("сокеты", () => {
  const groups = [["B", "B", "B", "B", "B", "G"]] as const;

  it("текстовая форма и связи", () => {
    expect(socketsToText([[...groups[0]]])).toBe("B-B-B-B-B-G");
    expect(socketsToText([["R", "R"], ["G"]])).toBe("R-R G");
    expect(maxLinks([["R", "R"], ["G", "B", "W"]])).toBe(3);
  });

  it("доступная подпись", () => {
    render(<Sockets groups={[[...groups[0]]]} />);
    expect(screen.getByRole("img", { name: "Сокеты: B-B-B-B-B-G, 6 связей" })).toBeInTheDocument();
  });
});

describe("цена", () => {
  it("оценка со знаком ~ и подписью валюты", () => {
    render(<Price price={{ amount: 120, currency: "chaos" }} approx />);
    expect(screen.getByText("~120")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chaos Orb" })).toBeInTheDocument();
  });

  it("формат чисел", () => {
    expect(formatAmount(0.6)).toBe("0.6");
    expect(formatAmount(120)).toBe("120");
  });
});

describe("палитра Ctrl+K", () => {
  it("делит 8 строк между группами по очереди", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => ({ group: "Предметы", id: `i${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ group: "Модули", id: `m${i}` })),
      { group: "Команды", id: "c0" },
    ];
    const picked = pickFairly(items, ["Предметы", "Модули", "Команды"], 8);
    expect(picked).toHaveLength(8);
    expect(picked.map((p) => p.group)).toEqual(["Предметы", "Предметы", "Предметы", "Предметы", "Модули", "Модули", "Модули", "Команды"]);
  });
});
