//! Расчёт «Выгодных кластеров» на снимках ответов сервера, без приложения: время и итоги.
//!
//! `cargo run --release -p poe-manager --example clusters_offline -- <crafting.json> <clusters.json> <prices.json>`
//! где `clusters.json` и `prices.json` — ответы `GET /v1/crafting/clusters/:league` и
//! `GET /v1/prices/:league` (с конвертом `{ result, errors }` или без).

use std::collections::HashMap;
use std::time::Instant;

use craft_engine::Engine;
use poe_manager_lib::cluster_plans::{compute, ClusterName, ClustersReply, MarketData};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceLine {
    item_id: String,
    variant_key: String,
    chaos_value: f64,
}

#[derive(Deserialize)]
struct LeaguePrices {
    prices: Vec<PriceLine>,
}

struct Snapshot {
    by_item: HashMap<String, Vec<(String, f64)>>,
}

impl MarketData for Snapshot {
    fn chaos(&self, item_id: &str) -> Option<f64> {
        self.by_item.get(item_id)?.iter().find(|(variant, _)| variant.is_empty()).map(|(_, chaos)| *chaos)
    }

    fn variants(&self, item_id: &str) -> Vec<(String, f64)> {
        self.by_item.get(item_id).cloned().unwrap_or_default()
    }

    fn item_name(&self, _item_id: &str) -> Option<ClusterName> {
        None
    }
}

fn unwrap_envelope(bytes: &[u8]) -> serde_json::Value {
    let value: serde_json::Value = serde_json::from_slice(bytes).expect("JSON");
    match value.get("result") {
        Some(result) => result.clone(),
        None => value,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [crafting, clusters, prices] = args.as_slice() else { panic!("crafting.json clusters.json prices.json") };
    let engine = Engine::from_json(&std::fs::read(crafting).expect("crafting.json")).expect("разбор crafting.json");
    let reply: ClustersReply = serde_json::from_value(unwrap_envelope(&std::fs::read(clusters).expect("clusters.json"))).expect("разбор целей");
    let league: LeaguePrices = serde_json::from_value(unwrap_envelope(&std::fs::read(prices).expect("prices.json"))).expect("разбор цен");
    let mut by_item: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for line in league.prices {
        by_item.entry(line.item_id).or_default().push((line.variant_key, line.chaos_value));
    }
    let snapshot = Snapshot { by_item };

    let started = Instant::now();
    let computed = compute(&engine, &snapshot, &reply, &HashMap::new());
    if let Some(row) = computed.rows.iter().find(|row| row.notables.len() == 2 && row.best.is_some()) {
        let detail = &computed.details[&row.key];
        println!("пример запросов сайта торговли ({}):", row.key);
        println!("  цель: {}", detail.trade_target.as_ref().map_or("—".to_owned(), |q| q.to_string()));
        println!("  база: {}", row.best.as_ref().and_then(|b| b.trade_base.as_ref()).map_or("—".to_owned(), |q| q.to_string()));
    }
    let elapsed = started.elapsed();

    let mut issues: HashMap<String, u32> = HashMap::new();
    for row in &computed.rows {
        *issues.entry(row.issue.map_or("—".to_owned(), |issue| format!("{issue:?}"))).or_default() += 1;
    }
    let planned = computed.rows.iter().filter(|row| row.best.is_some()).count();
    println!("целей {}, с планом {planned}, расчёт {:.2} с; проблемы: {issues:?}", computed.rows.len(), elapsed.as_secs_f64());

    let mut ranked: Vec<_> = computed.rows.iter().filter_map(|row| row.best.as_ref().and_then(|best| best.roi.map(|roi| (roi, row, best)))).collect();
    ranked.sort_by(|left, right| right.0.total_cmp(&left.0));
    let bands = [(2.0, "≥ 200 %"), (1.0, "100–200 %"), (0.5, "50–100 %"), (0.0, "0–50 %"), (f64::NEG_INFINITY, "убыток")];
    for (index, (floor, label)) in bands.iter().enumerate() {
        let ceiling = if index == 0 { f64::INFINITY } else { bands[index - 1].0 };
        let count = ranked.iter().filter(|(roi, _, _)| *roi >= *floor && *roi < ceiling).count();
        println!("  ROI {label}: {count}");
    }
    println!("лучшие по ROI:");
    for (roi, row, best) in ranked.iter().take(15) {
        let notables: Vec<&str> = row.notables.iter().map(|n| n.en.as_str()).collect();
        println!(
            "  {:>6.0} %  {:<6} {:>2}п  {:<48} {:?} {} ilvl {}  база {:.1}c + крафт {:.1}c = {:.1}c (p90 {:.1}c) → {:.1}c, {} шт. на рынке",
            roi * 100.0,
            row.size,
            row.passives,
            notables.join(" + "),
            best.method,
            best.enchant.en,
            best.item_level,
            best.base_price,
            best.craft_cost.mean,
            best.total_cost,
            best.total_cost_p90,
            row.market.as_ref().and_then(|m| m.price_chaos).unwrap_or(0.0),
            row.market.as_ref().and_then(|m| m.listings).unwrap_or(0),
        );
    }
}
