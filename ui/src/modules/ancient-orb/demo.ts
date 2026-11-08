import type { AncientData, OrbEvent, Tracker } from "./model";

/** Демо-данные для скриншотов (`?demo=ancient`, только dev-сервер). */
export function ancientDemoData(now = Date.now()): AncientData {
  const hour = 3_600_000;
  const belts: Tracker = {
    id: "demo-belts",
    title: "Пояса",
    targets: [
      { id: "demo-hh", name: "Headhunter" },
      { id: "demo-mb", name: "Mageblood" },
    ],
    expected: 1200,
    season: "Mercenaries",
    createdAt: now - 60 * 24 * hour,
  };
  const rings: Tracker = {
    id: "demo-rings",
    title: "Кольца",
    targets: [{ id: "demo-kt", name: "Kalandra's Touch" }],
    expected: null,
    season: "Mercenaries",
    createdAt: now - 10 * 24 * hour,
  };

  let n = 0;
  let at = now - 14 * 24 * hour;
  const events: OrbEvent[] = [];
  const spend = (amount: number, season = belts.season) => {
    at += 3 * hour;
    events.push({ id: `demo-${n++}`, trackerId: belts.id, season, at, source: "manual", kind: "spend", amount });
  };
  const hit = (target: "demo-hh" | "demo-mb", season = belts.season) => {
    at += hour;
    const name = target === "demo-hh" ? "Headhunter" : "Mageblood";
    events.push({ id: `demo-${n++}`, trackerId: belts.id, season, at, source: "manual", kind: "hit", targetId: target, targetName: name });
  };

  spend(800, "Settlers");
  spend(700, "Settlers");
  hit("demo-hh", "Settlers");
  spend(400);
  spend(600);
  spend(340);
  hit("demo-hh");
  spend(980);
  hit("demo-mb");
  spend(1200);
  spend(410);
  hit("demo-hh");
  spend(300);
  spend(150);
  spend(220);
  spend(75);

  return { activeTrackerId: belts.id, trackers: [belts, rings], events };
}
