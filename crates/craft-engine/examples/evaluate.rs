//! Проверка движка на настоящем `crafting.json`: точная вероятность против Монте-Карло по
//! отдельным модам и оценки методов на условных ценах. Для сверки с Craft of Exile.
//!
//! `cargo run --release -p craft-engine --example evaluate -- <путь к crafting.json> [прогонов]`

use std::collections::HashMap;
use std::time::Instant;

use craft_engine::{
    Base, Engine, Method, Prices, Rarity, evaluate_one_step, reroll_hit_probability,
    simulate_reroll,
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

    for (size, notables) in CASES {
        let target: Vec<String> = notables.iter().map(|name| (*name).to_owned()).collect();
        let started = Instant::now();
        let enchants = engine
            .fitting_enchants(size, ITEM_LEVEL, &target)
            .expect("энчанты");
        let Some(enchant) = enchants.iter().copied().max_by(|left, right| {
            rare_chance(&engine, size, left, &target)
                .total_cmp(&rare_chance(&engine, size, right, &target))
        }) else {
            println!("{size} {notables:?}: ни на одном энчанте");
            continue;
        };
        let base = Base {
            size,
            enchant,
            item_level: ITEM_LEVEL,
        };
        let pool = engine.pool(base, &[], &target).expect("пул");

        println!(
            "{size} {} — энчант {enchant} (подходит {} шт.)",
            notables.join(" + "),
            enchants.len()
        );

        for (label, rarity) in [("перемены", Rarity::Magic), ("хаос", Rarity::RareJewel)]
        {
            let exact = reroll_hit_probability(&pool, rarity);
            let simulated = simulate_reroll(&pool, rarity, runs, 7);

            worst_z = worst_z.max(report(label, exact, simulated, runs));
        }

        let estimates = evaluate_one_step(&engine, base, &target, &prices).expect("оценка");

        for estimate in &estimates {
            if let Method::Fossil { fossils, .. } = &estimate.method {
                let chosen: Vec<_> = fossils.iter().filter_map(|id| engine.fossil(id)).collect();
                let names: Vec<&str> = chosen.iter().map(|fossil| fossil.name.as_str()).collect();
                let pool = engine
                    .pool(base, &chosen, &target)
                    .expect("пул с ископаемыми");
                let simulated = simulate_reroll(&pool, Rarity::RareJewel, runs, 11);

                worst_z = worst_z.max(report(
                    &format!("ископаемые {}", names.join(" + ")),
                    estimate.probability,
                    simulated,
                    runs,
                ));
            }
        }

        for estimate in &estimates {
            println!(
                "    {:<12} попыток {:>9.1} (p50 {:>6}, p90 {:>7})  стоимость {:>9.1} c (p90 {:>9.1} c)",
                method_label(&estimate.method),
                estimate.attempts.mean,
                estimate.attempts.p50,
                estimate.attempts.p90,
                estimate.cost.mean,
                estimate.cost.p90
            );
        }

        println!("    {:.0} мс", started.elapsed().as_secs_f64() * 1000.0);
    }

    println!("наибольшее расхождение с Монте-Карло: {worst_z:.2} σ");
}

fn rare_chance(engine: &Engine, size: &str, enchant: &str, target: &[String]) -> f64 {
    let pool = engine
        .pool(
            Base {
                size,
                enchant,
                item_level: ITEM_LEVEL,
            },
            &[],
            target,
        )
        .expect("пул");

    reroll_hit_probability(&pool, Rarity::RareJewel)
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
        "    {label:<40} точно {:>8.4} %  Монте-Карло {:>8.4} %  ({z:.2} σ)",
        exact * 100.0,
        simulated * 100.0
    );

    z
}

fn method_label(method: &Method) -> String {
    match method {
        Method::Alteration => "перемены".to_owned(),
        Method::Chaos => "хаос".to_owned(),
        Method::Fossil {
            resonator_sockets, ..
        } => format!("ископ. ×{resonator_sockets}"),
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

    for fossil in &engine.data().fossils {
        set(&fossil.item_id, 1.0);
    }

    Prices::new(prices)
}
