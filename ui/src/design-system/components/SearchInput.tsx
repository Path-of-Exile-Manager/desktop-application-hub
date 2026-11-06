import type { ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { cx } from "../lib/cx";
import { fieldClasses } from "./Field";

export type SearchInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Подпись для скринридера, если нет видимой подписи. */
  label?: string;
};

/** Поиск: лупа слева, кнопка очистки справа появляется при вводе (components.md, п. 2). */
export function SearchInput({ value, onValueChange, label = "Поиск", className, ...props }: SearchInputProps) {
  return (
    <div className={cx("relative w-full", className)}>
      <Search
        aria-hidden
        size={16}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-icon-default"
      />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onValueChange("");
          }
        }}
        className={cx(fieldClasses, "pl-8.5", value && "pr-8", "[&::-webkit-search-cancel-button]:appearance-none")}
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить"
          onClick={() => onValueChange("")}
          className={cx(
            "absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm",
            "text-icon-default transition-colors hover:bg-bg-hover hover:text-icon-strong",
          )}
        >
          <X aria-hidden size={14} />
        </button>
      )}
    </div>
  );
}
