//! Проверка движка на настоящем `crafting.json`: точные вероятности против Монте-Карло по
//! отдельным модам, планы целей на условных ценах. Для сверки с Craft of Exile.
//!
//! `cargo run --release -p craft-engine --example evaluate -- <путь к crafting.json> [прогонов]`

use std::collections::HashMap;
use std::time::Instant;

use craft_engine::{
    AltPolicy, Base, BaseOffer, Engine, Method, Prices, Rarity, alt_policy_probability,
    harvest_hit_probability, plan_target, reroll_hit_probability, simulate_alt_policy,
    simulate_harvest, simulate_reroll,
};

/// Цели вида «размер, notable…» — самые играемые на Allflame (11.11.2026).
const CASES: &[(&str, &[&str])] = &[
    ("large", &["Martial Prowess"]),
    ("large", &["Prismatic Heart"]),
    ("large", &["Widespread Destruction"]),
    ("large", &["Prismatic Heart", "Widespread Destruction"]),
    ("large", &["Fuel the Fight", "Martial Prowess"]),
    ("large", &["Feed the Fury", "Fuel the Fight"]),
    ("medium", &["Unwaveringly Evil"]),
    ("medium", &["Empowered Envoy", "Endbringer"]),
    ("small", &["Prodigious Defence"]),
    ("small", &["Enduring Composure"]),
];

const ITEM_LEVEL: u32 = 84;

const POLICIES: [(&str, AltPolicy); 4] = [
    (
        "перемены",
        AltPolicy {
            augment: false,
            regal: false,
            exalt: false,
        },
    ),
    (
        "+ усиление",
        AltPolicy {
            augment: true,
            regal: false,
            exalt: false,
        },
    ),
    (
        "+ царь",
        AltPolicy {
            augment: true,
            regal: true,
            exalt: false,
        },
    ),
    (
        "+ возвышение",
        AltPolicy {
            augment: true,
            regal: true,
            exalt: true,
        },
    ),
];

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("путь к crafting.json");
    let runs: u32 = args
        .next()
        .map_or(200_000, |value| value.parse().expect("число прогонов"));
    let engine = Engine::from_json(&std::fs::read(path).expect("crafting.json"))
        .expect("разбор crafting.json");
    let prices = example_prices(&engine);
    let mut worst_z: f64 = 0.0;
    let all_started = Instant::now();

    for (size, notables) in CASES {
        let target: Vec<String> = notables.iter().map(|name| (*name).to_owned()).collect();
        let enchants = engine
            .fitting_enchants(size, ITEM_LEVEL, &target)
            .expect("энчанты");

        println!(
            "{size} {} — энчантов {}",
            notables.join(" + "),
            enchants.len()
        );

        let Some(enchant) = enchants.first() else {
            continue;
        };
        let base = Base {
            size,
            enchant,
            item_level: ITEM_LEVEL,
        };
        let pool = engine.pool(base, &[], &target).expect("пул");

        if runs > 1 {
            println!("  проверка на энчанте {enchant}:");

            for (label, policy) in POLICIES {
                let exact = alt_policy_probability(&pool, policy);
                let simulated = simulate_alt_policy(&pool, policy, runs, 3);

                worst_z = worst_z.max(report(label, exact, simulated, runs));
            }

            let exact = reroll_hit_probability(&pool, Rarity::RareJewel);

            worst_z = worst_z.max(report(
                "хаос",
                exact,
                simulate_reroll(&pool, Rarity::RareJewel, runs, 5),
                runs,
            ));

            for tag in pool.target_tags() {
                let exact = harvest_hit_probability(&pool, &tag);
                let simulated = simulate_harvest(&pool, &tag, runs, 9);

                worst_z = worst_z.max(report(&format!("harvest {tag}"), exact, simulated, runs));
            }
        }

        // Базы: все подходящие энчанты, уровень 84, условная цена 2c (дороже на «популярных»).
        let offers: Vec<BaseOffer> = enchants
            .iter()
            .enumerate()
            .map(|(index, enchant)| BaseOffer {
                enchant: (*enchant).to_owned(),
                item_level: ITEM_LEVEL,
                price: 2.0 + index as f64,
            })
            .collect();
        let started = Instant::now();
        let plans =
            plan_target(&engine, size, &target, &offers, &prices, Some(60.0), 3).expect("план");

        for plan in &plans {
            println!(
                "    {:<22} {:<38} шанс {:>8.4} %  попыток {:>8.1} (p90 {:>6})  вложения {:>8.1} c (p90 {:>8.1})  прибыль {:>7.1}",
                method_label(&engine, &plan.estimate.method),
                plan.base.enchant,
                plan.estimate.probability * 100.0,
                plan.estimate.attempts.mean,
                plan.estimate.attempts.p90,
                plan.total_cost,
                plan.total_cost_p90,
                plan.profit.unwrap_or(0.0)
            );
        }

        println!(
            "    план — {:.0} мс",
            started.elapsed().as_secs_f64() * 1000.0
        );
    }

    println!("всего {:.1} с", all_started.elapsed().as_secs_f64());

    if runs > 1 {
        println!("наибольшее расхождение с Монте-Карло: {worst_z:.2} σ");
    }
}

/// Печатает точную и смоделированную вероятность; возвращает расхождение в стандартных отклонениях.
fn report(label: &str, exact: f64, simulated: f64, runs: u32) -> f64 {
    let sigma = (exact * (1.0 - exact) / f64::from(runs)).sqrt();
    let z = if sigma > 0.0 {
        (simulated - exact).abs() / sigma
    } else if simulated == exact {
        0.0
    } else {
        f64::INFINITY
    };

    println!(
        "    {label:<14} точно {:>8.4} %  Монте-Карло {:>8.4} %  ({z:.2} σ)",
        exact * 100.0,
        simulated * 100.0
    );

    z
}

fn method_label(engine: &Engine, method: &Method) -> String {
    match method {
        Method::Alteration => "перемены".to_owned(),
        Method::AltAug => "перемены+усил.".to_owned(),
        Method::AltAugRegal => "перем.+усил.+царь".to_owned(),
        Method::AltAugRegalExalt => "перем.+усил.+царь+возв.".to_owned(),
        Method::Chaos => "хаос".to_owned(),
        Method::Harvest { craft, .. } => format!("Harvest {craft}"),
        Method::Fossil { fossils, .. } => fossils
            .iter()
            .filter_map(|id| engine.fossil(id))
            .map(|fossil| fossil.name.trim_end_matches(" Fossil").to_owned())
            .collect::<Vec<_>>()
            .join("+"),
    }
}

/// Условные цены: порядок величин, не рынок.
fn example_prices(engine: &Engine) -> Prices {
    let currency = &engine.data().currency;
    let mut prices: HashMap<String, f64> = HashMap::new();
    let mut set = |id: &str, price: f64| {
        prices.insert(id.to_owned(), price);
    };

    if let Some(id) = &currency.transmutation {
        set(id, 0.05);
    }

    if let Some(id) = &currency.alchemy {
        set(id, 0.3);
    }

    set(&currency.alteration, 0.15);
    set(&currency.augmentation, 0.05);
    set(&currency.regal, 0.5);
    set(&currency.exalted, 4.0);
    set(&currency.chaos, 1.0);
    set(&currency.scouring, 0.3);
    set(&currency.annulment, 3.0);

    for resonator in &currency.resonators {
        let price = [0.5, 1.0, 3.0, 6.0][usize::from(resonator.sockets.clamp(1, 4)) - 1];

        for id in &resonator.item_ids {
            set(id, price);
        }
    }

    if let Some(harvest) = &engine.data().harvest {
        for (colour, id) in &harvest.lifeforce {
            set(id, if colour == "vivid" { 0.28 } else { 0.035 });
        }
    }

    for fossil in &engine.data().fossils {
        set(&fossil.item_id, 1.0);
    }

    Prices::new(prices)
}
