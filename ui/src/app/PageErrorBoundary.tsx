import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, EmptyState } from "@/design-system";

/**
 * Ошибка внутри вкладки не должна гасить всё окно (без границы React размонтирует приложение —
 * остаётся чёрный экран): вкладка показывает ошибку и кнопку «Открыть снова», шапка и навигация
 * работают. Сбрасывается сменой `resetKey` (другая вкладка).
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  public state: { error: Error | null } = { error: null };

  public static getDerivedStateFromError(error: Error) {
    return { error };
  }

  public componentDidCatch(error: Error) {
    console.error("[page]", error);
  }

  public componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  public render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <EmptyState icon={AlertTriangle} title="Во вкладке произошла ошибка" className="h-full">
        <span className="flex flex-col items-center gap-3">
          <span className="max-w-xl font-mono text-caption break-words text-text-secondary">{error.message}</span>
          <Button icon={RotateCcw} onClick={() => this.setState({ error: null })}>
            Открыть снова
          </Button>
        </span>
      </EmptyState>
    );
  }
}
