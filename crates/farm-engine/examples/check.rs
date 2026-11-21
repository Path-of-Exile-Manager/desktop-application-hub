//! Сверка движка с расчётом руками на трёх выдуманных боссах и замер скорости.
//!
//! `cargo run -p farm-engine --example check --release`
//!
//! - Uber Shaper: гарантированный one-of 50/50, уникальный one-of, независимые со IIQ, `chance: null`,
//!   дроп без цены;
//! - T17: ступени IIQ (λ > 1), независимый пул без IIQ с λ = 1,5;
//! - вход ×4: шанс сообщества у `weight: null`, свой вес, `quantity.default`, `{ none: true }`;
//!   затем он же без цены входа.

use std::collections::HashMap;
use std::time::Instant;

use farm_engine::{BossData, BossEstimate, DropRef, MonteCarlo, Settings, estimate};

const BOSSES: &str = r#"{
  "version": "test",
  "bosses": [
    {
      "id": "uber-shaper", "group": "pinnacle-uber", "name": { "en": "Uber Shaper" },
      "entry": [{ "ref": { "itemId": "frag" }, "qty": 1 }],
      "pools": [
        { "id": "guaranteed", "kind": "one-of", "entries": [
          { "key": "shape", "ref": { "itemId": "shape" }, "weight": 50 },
          { "key": "knowledge", "ref": { "itemId": "knowledge" }, "weight": 50 } ] },
        { "id": "uniques", "kind": "one-of", "entries": [
          { "key": "starforge", "ref": { "itemId": "starforge" }, "weight": 2 },
          { "key": "voidforge", "ref": { "itemId": "voidforge" }, "weight": 3 },
          { "key": "dominance", "ref": { "itemId": "dominance" }, "weight": 15 } ] },
        { "id": "extra", "kind": "independent", "scalesWithQuantity": true, "entries": [
          { "key": "unid-sublime-vision", "ref": { "quote": "unid-sublime-vision" }, "chance": 2 },
          { "key": "royal-visage", "ref": { "itemId": "royal" }, "chance": null },
          { "key": "shapers-touch", "ref": { "itemId": "touch" }, "chance": 10 } ] }
      ],
      "quantity": { "default": 0, "steps": null },
      "defaults": { "ttkSec": 60, "overheadSec": 30 },
      "futureField": 1
    },
    {
      "id": "t17-fortress", "group": "t17", "name": { "en": "Fortress" },
      "entry": [],
      "pools": [
        { "id": "fragments", "kind": "independent", "scalesWithQuantity": true, "entries": [
          { "key": "t17-fragment", "ref": { "itemId": "t17frag" }, "chance": 100 } ] },
        { "id": "uniques", "kind": "one-of", "entries": [
          { "key": "a", "ref": { "itemId": "a" }, "weight": 1 },
          { "key": "b", "ref": { "itemId": "b" }, "weight": 3 } ] },
        { "id": "extra", "kind": "independent", "entries": [
          { "key": "divine", "ref": { "itemId": "divine" }, "chance": 150 } ] },
        { "id": "future", "kind": "weighted-later", "entries": [] }
      ],
      "quantity": { "default": 0, "steps": [
        { "iiq": 0, "mult": 2 }, { "iiq": 235, "mult": 2.5 }, { "iiq": 251, "mult": 3 } ] },
      "defaults": { "ttkSec": 40, "overheadSec": 20 }
    },
    {
      "id": "four-writs", "group": "invitation", "name": { "en": "Four writs" },
      "entry": [{ "ref": { "itemId": "writ" }, "qty": 4 }],
      "pools": [
        { "id": "uniques", "kind": "one-of", "entries": [
          { "key": "e1", "ref": { "itemId": "e1" }, "weight": null },
          { "key": "e2", "ref": { "itemId": "e2" }, "weight": 60 },
          { "key": "e3", "ref": { "itemId": "e3" }, "weight": 40 } ] },
        { "id": "extra", "kind": "independent", "scalesWithQuantity": true, "entries": [
          { "key": "gem", "ref": { "itemId": "gem" }, "chance": 40 },
          { "key": "nothing", "ref": { "none": true }, "chance": 50 } ] }
      ],
      "quantity": { "default": 20 }
    }
  ],
  "quotes": []
}"#;

fn prices() -> HashMap<&'static str, f64> {
    HashMap::from([
        ("frag", 200.0),
        ("shape", 10.0),
        ("knowledge", 30.0),
        ("starforge", 3000.0),
        ("voidforge", 500.0),
        ("dominance", 50.0),
        ("unid-sublime-vision", 5000.0),
        ("royal", 100.0),
        ("t17frag", 40.0),
        ("a", 200.0),
        ("divine", 100.0),
        ("writ", 50.0),
        ("e1", 1000.0),
        ("e2", 100.0),
        ("e3", 50.0),
        ("gem", 100.0),
    ])
}

fn price(table: &HashMap<&'static str, f64>, drop_ref: &DropRef) -> Option<f64> {
    drop_ref
        .item_id()
        .or(drop_ref.quote_id())
        .and_then(|id| table.get(id).copied())
}

fn close(label: &str, actual: f64, expected: f64) {
    let ok = (actual - expected).abs() <= 1e-9 * expected.abs().max(1.0);

    println!(
        "  {label:<16} {actual:>14.4}   руками {expected:>14.4}   {}",
        if ok { "ok" } else { "MISMATCH" }
    );
    assert!(ok, "{label}: {actual} != {expected}");
}

/// Среднее дохода дропа за убийство по Монте-Карло против EV.
fn monte_carlo(result: &BossEstimate) {
    let hour = result.hour.expect("hour");
    let income = hour.mean / f64::from(hour.kills) + result.entry_cost.unwrap_or(0.0);
    let error = (income - result.ev) / result.ev;

    println!(
        "  МК: {} уб. × {} прогонов, доход/уб. {income:.3} (EV {:.3}, {:+.3} %), p10 {:.0} p50 {:.0} p90 {:.0}, минус {:.1} %",
        hour.kills,
        hour.runs,
        result.ev,
        error * 100.0,
        hour.p10,
        hour.p50,
        hour.p90,
        hour.loss_chance * 100.0
    );
    assert!(error.abs() < 0.01, "МК далеко от EV");
}

fn main() {
    let data: BossData = serde_json::from_str(BOSSES).expect("bosses.json");
    let table = prices();
    let mc = MonteCarlo::default();

    // Uber Shaper, IIQ 50.
    let shaper = data.boss("uber-shaper").unwrap();
    let settings = Settings {
        iiq: 50.0,
        ..Settings::default()
    };
    let result = estimate(shaper, |r| price(&table, r), &settings, mc);

    println!("uber-shaper");
    // guaranteed 0,5·10 + 0,5·30 = 20; uniques 0,1·3000 + 0,15·500 + 0,75·50 = 412,5;
    // extra λ = 0,02·1,5 = 0,03 → 150; touch без цены, royal — шанс неизвестен.
    close("EV", result.ev, 582.5);
    close("вход", result.entry_cost.unwrap(), 200.0);
    close("прибыль/уб.", result.profit.unwrap(), 382.5);
    close("уб./ч", result.kills_per_hour.unwrap(), 40.0);
    close("прибыль/ч", result.profit_per_hour.unwrap(), 15300.0);
    // σ²: 500 − 400 = 100; 939 375 − 412,5² = 769 218,75; 0,03·0,97·5000² = 727 500.
    close("σ/уб.", result.sigma, 1_496_818.75_f64.sqrt());
    close("доля редких", result.rare_share.unwrap(), 150.0 / 582.5);
    assert_eq!(result.rare_top.as_deref(), Some("unid-sublime-vision"));
    assert_eq!(result.unpriced, ["shapers-touch"]);
    assert_eq!(result.unknown_chance, ["royal-visage"]);
    monte_carlo(&result);

    // Свой шанс у royal-visage (1 % → λ 0,015 со IIQ 50) и шансы сообщества по переключателю.
    let settings = Settings {
        iiq: 50.0,
        chances: HashMap::from([("royal-visage".to_string(), 1.0)]),
        community: HashMap::from([("unid-sublime-vision".to_string(), 4.0)]),
        prefer_community: true,
        ..Settings::default()
    };
    let result = estimate(shaper, |r| price(&table, r), &settings, mc);

    // + royal 0,015·100 = 1,5; sublime 0,04·5000 = 200 вместо 150 (без IIQ).
    close("EV (правки)", result.ev, 582.5 + 1.5 + 50.0);
    assert!(result.unknown_chance.is_empty());

    // T17, ступени IIQ.
    let t17 = data.boss("t17-fortress").unwrap();

    println!("t17-fortress");

    for (iiq, fragments) in [(100.0, 80.0), (240.0, 100.0), (251.0, 120.0)] {
        let settings = Settings {
            iiq,
            ..Settings::default()
        };
        let result = estimate(t17, |r| price(&table, r), &settings, mc);

        // фрагменты λ = mult · 1 · 40; a 0,25·200 = 50; divine 1,5·100 = 150.
        close(
            &format!("EV iiq {iiq}"),
            result.ev,
            fragments + 50.0 + 150.0,
        );
    }

    let settings = Settings {
        iiq: 240.0,
        ..Settings::default()
    };
    let result = estimate(t17, |r| price(&table, r), &settings, mc);

    // σ²: λ 2,5 → 0,25·40² = 400; 0,25·200² − 50² = 7500; λ 1,5 → 0,25·100² = 2500.
    close("σ/уб.", result.sigma, 10_400.0_f64.sqrt());
    close("прибыль/ч", result.profit_per_hour.unwrap(), 18_000.0);
    close("доля редких", result.rare_share.unwrap(), 0.0);
    assert_eq!(result.unpriced, ["b"]);
    monte_carlo(&result);

    // Вход ×4.
    let writs = data.boss("four-writs").unwrap();
    let settings = Settings {
        ttk_sec: Some(30.0),
        overhead_sec: Some(30.0),
        chances: HashMap::from([("e3".to_string(), 20.0)]),
        community: HashMap::from([("e1".to_string(), 10.0)]),
        ..Settings::default()
    };
    let result = estimate(writs, |r| price(&table, r), &settings, mc);

    println!("four-writs");
    // e1 сообщество 10 %; e2 и e3 (свой вес 20) делят 90 % как 60 : 20 → 0,675 и 0,225.
    // uniques 100 + 67,5 + 11,25 = 178,75; gem λ = 0,4 / 1,2 → 33,333…; nothing — 0.
    let ev = 178.75 + 100.0 / 3.0;

    close("вход", result.entry_cost.unwrap(), 200.0);
    close("EV", result.ev, ev);
    close("прибыль/уб.", result.profit.unwrap(), ev - 200.0);
    close(
        "прибыль/ч",
        result.profit_per_hour.unwrap(),
        (ev - 200.0) * 60.0,
    );
    // σ²: 107 312,5 − 178,75² = 75 360,9375; (1/3)(2/3)·100² = 2222,22…
    close(
        "σ/уб.",
        result.sigma,
        (75_360.937_5_f64 + 20_000.0 / 9.0).sqrt(),
    );
    assert!(result.unpriced.is_empty() && result.unknown_chance.is_empty());
    monte_carlo(&result);

    let journal = farm_engine::expect_kills(&result, 100);

    close("журнал 100 уб.", journal.income, ev * 100.0);
    close("σ 100 уб.", journal.sigma, result.sigma * 10.0);

    // Нет цены входа.
    let mut without_writ = table.clone();

    without_writ.remove("writ");

    let result = estimate(writs, |r| price(&without_writ, r), &settings, mc);

    assert!(result.profit.is_none() && result.profit_gap.is_some() && result.hour.is_none());
    println!(
        "  без цены входа: прибыль нет, причина {:?}",
        result.profit_gap.unwrap()
    );

    // Скорость: 40 боссов с Монте-Карло.
    let bosses: Vec<_> = data.bosses.iter().cycle().take(40).collect();
    let settings = Settings {
        iiq: 240.0,
        ttk_sec: Some(30.0),
        overhead_sec: Some(30.0),
        ..Settings::default()
    };

    for runs in [5_000, 10_000, 20_000] {
        let mc = MonteCarlo {
            runs,
            ..MonteCarlo::default()
        };
        let started = Instant::now();
        let kills: u32 = bosses
            .iter()
            .filter_map(|boss| estimate(boss, |r| price(&table, r), &settings, mc).hour)
            .map(|hour| hour.kills)
            .sum();

        println!(
            "40 боссов, {runs} прогонов ({kills} уб./ч в сумме): {:.1} мс",
            started.elapsed().as_secs_f64() * 1000.0
        );
    }

    // Тяжёлый босс: one-of на 4 и 12 строк, 15 независимых — распределение убийства сжимается
    // до 4096 точек; среднее при сжатии сохраняется.
    let heavy = heavy_boss();
    let heavy_price = |drop_ref: &DropRef| {
        let id = drop_ref.item_id()?;

        id.strip_prefix('p')
            .and_then(|price| price.split('-').next()?.parse().ok())
    };
    let started = Instant::now();
    let results: Vec<_> = (0..40)
        .map(|_| estimate(&heavy, heavy_price, &settings, MonteCarlo::default()))
        .collect();

    println!(
        "40 тяжёлых боссов, 20000 прогонов × {} уб.: {:.1} мс",
        results[0].hour.unwrap().kills,
        started.elapsed().as_secs_f64() * 1000.0
    );
    monte_carlo(&results[0]);

    let started = Instant::now();

    for _ in 0..40 {
        estimate(
            &heavy,
            heavy_price,
            &settings,
            MonteCarlo {
                runs: 0,
                ..MonteCarlo::default()
            },
        );
    }

    println!(
        "  из них без Монте-Карло: {:.1} мс",
        started.elapsed().as_secs_f64() * 1000.0
    );
}

fn heavy_boss() -> farm_engine::Boss {
    let entries = |count: usize, field: &str, step: usize| -> String {
        (0..count)
            .map(|index| {
                format!(
                    r#"{{ "key": "k{field}{index}", "ref": {{ "itemId": "p{}-{field}{index}" }}, "{field}": {} }}"#,
                    10 + index * step,
                    1 + index % 7
                )
            })
            .collect::<Vec<_>>()
            .join(",")
    };
    let json = format!(
        r#"{{ "id": "heavy", "group": "other", "name": {{ "en": "Heavy" }},
            "entry": [{{ "ref": {{ "itemId": "p100-entry" }}, "qty": 2 }}],
            "pools": [
              {{ "id": "g", "kind": "one-of", "entries": [{}] }},
              {{ "id": "u", "kind": "one-of", "entries": [{}] }},
              {{ "id": "x", "kind": "independent", "scalesWithQuantity": true, "entries": [{}] }} ] }}"#,
        entries(4, "weight", 13),
        entries(12, "weight", 97),
        entries(15, "chance", 311)
    );

    serde_json::from_str(&json).expect("heavy boss")
}
