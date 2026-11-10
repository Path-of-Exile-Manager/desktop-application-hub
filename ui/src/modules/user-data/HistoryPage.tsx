import { useState } from "react";
import { ExternalLink, History, Trash2, Zap } from "lucide-react";
import { Button, Card, CardSection, Dialog, EmptyState, IconButton, Page, StatusBadge, toast } from "@/design-system";
import { removeRecord, tradeUrl, useRecords, type HistoryEntry } from "@/app/user-data";
import { openWithToast } from "./BookmarksPage";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const leagueLabel = (league: string) => {
  try {
    return decodeURIComponent(league);
  } catch {
    return league;
  }
};

/** История поисков на сайте торговли PoE 1 (из расширения): открыть, удалить, очистить. */
export function HistoryPage() {
  const entries = useRecords<HistoryEntry>("history");
  const [clearing, setClearing] = useState(false);
  const sorted = [...(entries ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return (
    <Page
      title="История"
      subtitle="Поиски, открытые на сайте торговли PoE 1 с расширением"
      actions={
        <Button icon={Trash2} disabled={sorted.length === 0} onClick={() => setClearing(true)}>
          Очистить
        </Button>
      }
    >
      {entries === null ? null : sorted.length === 0 ? (
        <EmptyState icon={History} title="История пуста">
          Поиски появятся здесь, когда вы откроете их на сайте торговли с расширением poe-manager.
        </EmptyState>
      ) : (
        <Card>
          <CardSection>
            <ul className="flex flex-col">
              {sorted.map((h) => (
                <li key={h.id} className="flex items-center gap-3 border-b border-border-subtle py-1.5 last:border-b-0">
                  <span className="w-24 shrink-0 font-mono text-caption text-text-secondary">{when(h.createdAt)}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-body hover:text-text-accent" onClick={() => openWithToast(tradeUrl(h.tradeType, h.league, h.slug))}>
                    {h.title}
                  </button>
                  {h.isLive && (
                    <StatusBadge status="info">
                      <Zap aria-hidden className="size-3" /> live
                    </StatusBadge>
                  )}
                  <span className="shrink-0 text-caption text-text-secondary">{leagueLabel(h.league)}</span>
                  <IconButton icon={ExternalLink} label="Открыть на сайте торговли" onClick={() => openWithToast(tradeUrl(h.tradeType, h.league, h.slug))} />
                  <IconButton icon={Trash2} label="Удалить из истории" onClick={() => removeRecord("history", h.id).catch(fail("Не удалено"))} />
                </li>
              ))}
            </ul>
          </CardSection>
        </Card>
      )}
      <Dialog
        open={clearing}
        onOpenChange={setClearing}
        title="Очистить историю?"
        description="Записи удалятся здесь, в расширении и в аккаунте."
        footer={
          <>
            <Button onClick={() => setClearing(false)}>Отмена</Button>
            <Button
              variant="primary"
              icon={Trash2}
              onClick={async () => {
                for (const h of sorted) await removeRecord("history", h.id).catch(fail("Не удалено"));
                setClearing(false);
              }}
            >
              Очистить
            </Button>
          </>
        }
      />
    </Page>
  );
}
