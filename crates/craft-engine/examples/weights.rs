//! Веса модов пустой базы — для сверки с таблицей весов Craft of Exile.
//!
//! `cargo run -p craft-engine --example weights -- <crafting.json> <размер> <энчант> [уровень]`
//! Строки: сторона, вес, английский текст мода (через « / » для нескольких строк).

use craft_engine::{Base, Engine};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [path, size, enchant, rest @ ..] = args.as_slice() else {
        panic!("crafting.json, размер, энчант [уровень]");
    };
    let item_level = rest
        .first()
        .map_or(84, |value| value.parse().expect("уровень"));
    let engine = Engine::from_json(&std::fs::read(path).expect("crafting.json")).expect("разбор");
    let base = Base {
        size,
        enchant,
        item_level,
    };
    let pool = engine.pool(base, &[], &[]).expect("пул");
    let mods = &engine.data().clusters.mods;

    for (source, weight) in pool.mod_weights() {
        let cluster_mod = &mods[source];
        let affix = match cluster_mod.affix {
            craft_engine::data::Affix::Prefix => "prefix",
            craft_engine::data::Affix::Suffix => "suffix",
        };

        println!(
            "{affix}\t{weight}\t{}",
            cluster_mod.text.en.replace('\n', " / ")
        );
    }
}
