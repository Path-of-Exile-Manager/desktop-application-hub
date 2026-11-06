import { FlaskConical } from "lucide-react";
import { Badge, Tooltip } from "@/design-system";

/** Пометка режима Development в шапке: статусный (warning) цвет, иконка и текст. */
export function DevBadge() {
  return (
    <Tooltip content="Режим Development (DEVELOPMENT=true): доступны Админка и Витрина" side="bottom">
      <Badge
        caps
        tabIndex={0}
        aria-label="Режим Development"
        className="gap-1 border-status-warning-border bg-status-warning-bg text-caption text-status-warning-fg"
      >
        <FlaskConical aria-hidden size={12} />
        Dev
      </Badge>
    </Tooltip>
  );
}
