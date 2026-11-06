import { Card, CardSection, ItemHeader, ItemProperties, ItemStateBadge, ModList, Sockets, type Item } from "@/design-system";

/** Карточка разобранного предмета: шапка, свойства и сокеты, моды, состояние. */
export function ItemCard({ item, className }: { item: Item; className?: string }) {
  return (
    <Card className={className}>
      <CardSection className="flex flex-col gap-1.5">
        <ItemHeader item={item} size="lg" />
        {(item.properties?.length || item.sockets) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-4">
            <ItemProperties item={item} />
            {item.sockets && <Sockets groups={item.sockets} />}
          </div>
        )}
      </CardSection>
      {item.mods.length > 0 && (
        <CardSection>
          <ModList mods={item.mods} />
        </CardSection>
      )}
      {item.states?.length ? (
        <CardSection className="flex flex-wrap gap-2">
          {item.states.map((s) => (
            <ItemStateBadge key={s} state={s} />
          ))}
        </CardSection>
      ) : null}
    </Card>
  );
}
