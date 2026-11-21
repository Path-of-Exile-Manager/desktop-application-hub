import { useState } from "react";
import { Page, Tabs } from "@/design-system";
import { useCurrentLeague } from "@/app/leagues";
import { DustTab } from "./DustTab";

// «Kingsmarch» — город лиги Settlers of Kalguur. Подвкладки по механикам города; первая — «Пыль»
// (разбор уникальных у Rog: что выгоднее всего купить на пыль по текущим ценам).

type Section = "dust";

export function KingsmarchPage() {
  const league = useCurrentLeague();
  const [section, setSection] = useState<Section>("dust");
  return (
    <Page title="Kingsmarch" subtitle={`Город Kalguur: что выгодно делать по ценам лиги ${league?.name ?? "—"}`}>
      <Tabs
        aria-label="Разделы Kingsmarch"
        value={section}
        onValueChange={(v) => setSection(v as Section)}
        items={[{ value: "dust", label: "Пыль" }]}
      />
      {section === "dust" && <DustTab />}
    </Page>
  );
}
