import { useState } from "react";
import { ExternalLink, Pin as PinIcon, PinOff } from "lucide-react";
import { Button, Dialog, EmptyState, Page, Price, toast, type CurrencyId } from "@/design-system";
import { removeRecord, tradeUrl, useRecords, type Pin } from "@/app/user-data";
import { ItemCard } from "@/modules/price-check/ItemCard";
import { openWithToast } from "./BookmarksPage";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Валюта цены, как её пишет сайт торговли («Divine Orb»), → валюта дизайн-системы. */
const CURRENCY: Record<string, CurrencyId> = { "Chaos Orb": "chaos", "Divine Orb": "divine", "Exalted Orb": "exalted", "Mirror of Kalandra": "mirror" };

function PinPrice({ price }: { price: Pin["price"] }) {
  if (!price) return <span className="text-label text-text-secondary">без цены</span>;
  const currency = CURRENCY[price.currency];
  return currency ? (
    <Price price={{ amount: price.amount, currency }} size="md" />
  ) : (
    <span className="font-mono text-body">
      {price.amount} {price.currency}
    </span>
  );
}

/** Закреплённые лоты с сайта торговли PoE 1 (из расширения): карточка предмета, цена, продавец, поиск. */
export function PinsPage() {
  const pins = useRecords<Pin>("pins");
  const [clearing, setClearing] = useState(false);
  const sorted = [...(pins ?? [])].sort((a, b) => (a.pinnedAt < b.pinnedAt ? 1 : a.pinnedAt > b.pinnedAt ? -1 : 0));

  return (
    <Page
      title="Закреплённые"
      subtitle="Лоты, закреплённые на сайте торговли PoE 1 с расширением"
      actions={
        <Button icon={PinOff} disabled={sorted.length === 0} onClick={() => setClearing(true)}>
          Открепить все
        </Button>
      }
    >
      {pins === null ? null : sorted.length === 0 ? (
        <EmptyState icon={PinIcon} title="Закреплённых нет">
          Нажмите «Закрепить» у лота на сайте торговли — он появится здесь.
        </EmptyState>
      ) : (
        <div className="grid min-h-0 grid-cols-2 items-start gap-4">
          {sorted.map((p) => (
            <div key={p.id} className="flex min-w-0 flex-col gap-2">
              <ItemCard item={p.item} />
              <div className="flex flex-wrap items-center gap-3 px-1">
                <PinPrice price={p.price} />
                {p.seller?.account && <span className="truncate text-label text-text-secondary">продавец {p.seller.account}</span>}
                <span className="min-w-0 flex-1 truncate text-label text-text-secondary">· {p.searchTitle}</span>
                <Button variant="ghost" icon={ExternalLink} className="h-7 text-label" onClick={() => openWithToast(tradeUrl(p.tradeType, p.league, p.slug))}>
                  Поиск
                </Button>
                <Button variant="ghost" icon={PinOff} className="h-7 text-label" onClick={() => removeRecord("pins", p.id).catch(fail("Не откреплено"))}>
                  Открепить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={clearing}
        onOpenChange={setClearing}
        title="Открепить все лоты?"
        description="Лоты открепятся здесь, в расширении и в аккаунте."
        footer={
          <>
            <Button onClick={() => setClearing(false)}>Отмена</Button>
            <Button
              variant="primary"
              icon={PinOff}
              onClick={async () => {
                for (const p of sorted) await removeRecord("pins", p.id).catch(fail("Не откреплено"));
                setClearing(false);
              }}
            >
              Открепить все
            </Button>
          </>
        }
      />
    </Page>
  );
}
