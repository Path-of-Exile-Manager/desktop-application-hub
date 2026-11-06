import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bookmark } from "lucide-react";
import { Button, IconButton } from "./Button";
import { TooltipProvider } from "./Tooltip";
import { Chip } from "./Chip";
import { Pagination, pageNumbers } from "./Pagination";
import { Switch } from "./Toggles";
import { Table, type Column } from "./Table";
import { keysFromEvent } from "./HotkeyInput";
import { Field, Input } from "./Field";

describe("Button", () => {
  it("по умолчанию type=button, вызывает onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Искать</Button>);
    const button = screen.getByRole("button", { name: "Искать" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("неактивная кнопка не реагирует и не прозрачна", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabled onClick={onClick}>
        Искать
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button").className).not.toMatch(/opacity/);
  });
});

describe("IconButton", () => {
  it("подпись идёт в aria-label, активное состояние — в aria-pressed", () => {
    render(
      <TooltipProvider>
        <IconButton icon={Bookmark} label="Закрепить" active />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Закрепить" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Chip", () => {
  it("переключает выбор и отражает его в aria-pressed", async () => {
    const onChange = vi.fn();
    render(
      <Chip selected={false} onSelectedChange={onChange}>
        Ring
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Ring" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch", () => {
  it("клик по подписи переключает", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Только продаваемое" />);
    await userEvent.click(screen.getByText("Только продаваемое"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Field", () => {
  it("связывает подпись с полем и показывает ошибку", () => {
    render(<Field label="Лига" error="Лига не найдена">{(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} />}</Field>);
    const input = screen.getByLabelText("Лига");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Лига не найдена");
  });
});

describe("Pagination", () => {
  it("номера страниц с многоточиями", () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(6, 20)).toEqual([1, "…", 5, 6, 7, "…", 20]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, "…", 20]);
  });

  it("показывает диапазон и листает", async () => {
    const onPage = vi.fn();
    render(
      <TooltipProvider>
        <Pagination page={1} pageSize={10} total={35} onPageChange={onPage} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("navigation")).toHaveTextContent("1–10 из 35");
    expect(screen.getByRole("button", { name: "Предыдущая страница" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    expect(onPage).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Страница 1" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Table", () => {
  type Row = { id: string; name: string; price: number };
  const columns: Column<Row>[] = [
    { key: "name", header: "Название" },
    { key: "price", header: "Цена", numeric: true, sortable: true },
  ];

  it("сортировка: первый клик — по убыванию, второй — по возрастанию", async () => {
    const onSort = vi.fn();
    const { rerender } = render(
      <Table columns={columns} rows={[{ id: "a", name: "A", price: 1 }]} rowKey={(r) => r.id} sort={null} onSortChange={onSort} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Цена" }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "price", direction: "desc" });

    rerender(
      <Table columns={columns} rows={[{ id: "a", name: "A", price: 1 }]} rowKey={(r) => r.id} sort={{ key: "price", direction: "desc" }} onSortChange={onSort} />,
    );
    expect(screen.getByRole("columnheader", { name: /Цена/ })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /Цена/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "price", direction: "asc" });
  });
});

describe("keysFromEvent", () => {
  const ev = (key: string, code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  it("собирает сочетание", () => {
    expect(keysFromEvent(ev("d", "KeyD", { ctrlKey: true }))).toEqual(["Ctrl", "D"]);
    expect(keysFromEvent(ev("!", "Digit1", { shiftKey: true, altKey: true }))).toEqual(["Alt", "Shift", "1"]);
    expect(keysFromEvent(ev("F5", "F5"))).toEqual(["F5"]);
  });

  it("одни модификаторы — не сочетание", () => {
    expect(keysFromEvent(ev("Control", "ControlLeft", { ctrlKey: true }))).toBeNull();
  });
});
