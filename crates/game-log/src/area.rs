/// Hubs of league mechanics a player waits in between maps, by `WorldAreas` id (patch 3.30).
const HUBS: &[&str] = &[
    "HeistHub",
    "HeistHubEndless",
    "Delve_Hub",
    "Menagerie_Hub",
    "Synthesis_Hub",
    "Metamorphosis_Hub",
    "KalguuranSettlersLeague",
    "Labyrinth_Airlock",
    "1_Labyrinth_AirlockClean",
    "pvpTown",
];

/// A town, a hideout or a league hub: where a player goes between runs (to stash, to sell, after a
/// death) and may come back to the arena from. Going there pauses a run instead of ending it.
/// Act towns are `1_1_town` … `2_11_endgame_town`, hideouts `Hideout…`.
pub fn is_safe_area(area_id: &str) -> bool {
    area_id.starts_with("Hideout") || area_id.ends_with("_town") || HUBS.contains(&area_id)
}
