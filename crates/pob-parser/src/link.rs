//! Ссылки на сборки сайтов, которые понимает сам Path of Building (`Modules/BuildSiteTools.lua`):
//! pobb.in, Pastebin, poe.ninja. Ссылка → сайт, id сборки на нём, адрес страницы и адрес кода.
//! Другие сайты и адреса не принимаются: приложение ходит только по этому белому списку.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Сайт сборки. Значения — те же, что `PobBuildSite` на сервере (`source.site` записи билда).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum PobSite {
    Pobbin,
    Pastebin,
    PoeNinja,
}

impl PobSite {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pobbin => "pobb.in",
            Self::Pastebin => "Pastebin",
            Self::PoeNinja => "poe.ninja",
        }
    }

    /// Id сайта в протоколе `pob://<id>/<сборка>`, который открывает сборку в Path of Building.
    pub fn protocol_id(self) -> &'static str {
        match self {
            Self::Pobbin => "pobbin",
            Self::Pastebin => "pastebin",
            Self::PoeNinja => "poeninja",
        }
    }
}

/// Разобранная ссылка на сборку.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PobLink {
    pub site: PobSite,
    /// Id сборки на сайте: `9Euza4KFahGY`.
    pub id_on_site: String,
    /// Страница сборки: `https://pobb.in/9Euza4KFahGY`.
    pub url: String,
    /// Где лежит сам код: `https://pobb.in/pob/9Euza4KFahGY`.
    pub raw_url: String,
}

/// Почему ссылку не взяли.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// `http://` — только HTTPS.
    NotHttps,
    /// Сайт не из списка.
    UnknownSite,
    /// Сайт из списка, но адрес не ведёт на сборку.
    NotABuild(PobSite),
}

impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotHttps => f.write_str("ссылка должна начинаться с https://"),
            Self::UnknownSite => {
                f.write_str("поддерживаются ссылки pobb.in, Pastebin и poe.ninja/pob")
            }
            Self::NotABuild(site) => write!(f, "это ссылка {}, но не на сборку", site.label()),
        }
    }
}

impl std::error::Error for LinkError {}

/// Похоже ли на ссылку (а не на код экспорта): есть схема или начинается с известного сайта.
pub fn looks_like_link(input: &str) -> bool {
    let s = input.trim().to_ascii_lowercase();
    s.contains("://")
        || ["pobb.in/", "pastebin.com/", "poe.ninja/", "www."]
            .iter()
            .any(|p| s.starts_with(p))
}

/// Id: буквы, цифры, `_` и `-`, до 100 символов. У Pastebin и poe.ninja — только буквы и цифры.
fn site_id(value: &str, extra: bool) -> Option<String> {
    let ok = (1..=100).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || (extra && (b == b'_' || b == b'-')));
    ok.then(|| value.to_string())
}

/// Разбирает ссылку. Без схемы считается `https://`; запрос и якорь отбрасываются.
pub fn parse_link(input: &str) -> Result<PobLink, LinkError> {
    let input = input.trim();
    let rest = match input.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("https") => rest,
        Some((scheme, _)) if scheme.eq_ignore_ascii_case("http") => {
            return Err(LinkError::NotHttps);
        }
        Some(_) => return Err(LinkError::UnknownSite),
        None => input,
    };
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();

    match host {
        "pobb.in" => {
            let site = PobSite::Pobbin;
            // `/<id>` — страница, `/pob/<id>` — сам код (так пишет PoB в importLink)
            let id = match parts.as_slice() {
                [id] => site_id(id, true),
                ["pob", id] => site_id(id, true),
                _ => None,
            }
            .ok_or(LinkError::NotABuild(site))?;
            Ok(PobLink {
                site,
                url: format!("https://pobb.in/{id}"),
                raw_url: format!("https://pobb.in/pob/{id}"),
                id_on_site: id,
            })
        }
        "pastebin.com" => {
            let site = PobSite::Pastebin;
            let id = match parts.as_slice() {
                [id] => site_id(id, false),
                ["raw", id] => site_id(id, false),
                _ => None,
            }
            .ok_or(LinkError::NotABuild(site))?;
            Ok(PobLink {
                site,
                url: format!("https://pastebin.com/{id}"),
                raw_url: format!("https://pastebin.com/raw/{id}"),
                id_on_site: id,
            })
        }
        "poe.ninja" => {
            let site = PobSite::PoeNinja;
            let id = match parts.as_slice() {
                ["pob", id]
                | ["poe1", "pob", id]
                | ["pob", "raw", id]
                | ["poe1", "pob", "raw", id] => site_id(id, false),
                _ => None,
            }
            .ok_or(LinkError::NotABuild(site))?;
            Ok(PobLink {
                site,
                url: format!("https://poe.ninja/poe1/pob/{id}"),
                raw_url: format!("https://poe.ninja/poe1/pob/raw/{id}"),
                id_on_site: id,
            })
        }
        _ => Err(LinkError::UnknownSite),
    }
}
