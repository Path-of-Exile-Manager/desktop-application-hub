//! Сайт торговли GGG для искателя пула (план shared/docs/build-price-tracking.md, 4.4): поиск и
//! 10 самых дешёвых предложений, без входа, с IP пользователя. Заголовки лимитов читаются в каждом
//! ответе; в них видны и поиски самого человека в браузере — искатель уступает им.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const TRADE: &str = "https://www.pathofexile.com/api/trade";
const TIMEOUT: Duration = Duration::from_secs(30);
/// Предложений в одном fetch и в отчёте.
pub const FETCH_LIMIT: usize = 10;
/// Пауза после 429 без `Retry-After`.
const DEFAULT_RETRY_AFTER: u64 = 60;

/// Одно правило лимита: не больше `max` запросов за `period` секунд.
#[derive(Debug, Clone, Copy)]
struct Rule {
    max: u32,
    period: u64,
    hits: u32,
    /// Сайт уже ограничил запросы на столько секунд.
    restricted: u64,
}

/// Последнее, что сайт сказал о политике (`trade-search-request-limit`…), и когда.
#[derive(Debug, Clone)]
struct PolicyState {
    rules: Vec<Rule>,
    observed: Instant,
}

pub struct Listing {
    pub amount: f64,
    pub currency: String,
    /// sha256 имени аккаунта продавца (первые 16 знаков): только чтобы брать одно предложение с продавца.
    pub seller: Option<String>,
    pub indexed_at: Option<String>,
}

pub struct SearchOutcome {
    pub total: u32,
    pub listings: Vec<Listing>,
}

pub enum TradeError {
    /// 429 или правило уже ограничено: ждать столько секунд.
    RateLimited(u64),
    /// Сеть, сайт, неожиданный ответ — словами.
    Failed(String),
}

pub struct TradeClient {
    agent: ureq::Agent,
    policies: HashMap<String, PolicyState>,
}

/// Ответ поиска: id запроса (для fetch и ссылки на сайт), сколько всего и id первых предложений (до 100).
#[derive(Deserialize)]
pub struct SearchResponse {
    pub id: String,
    pub total: u32,
    #[serde(default)]
    pub result: Vec<String>,
}

impl TradeClient {
    /// `purpose` — для User-Agent: сайт видит, кто и зачем ищет.
    pub fn new(purpose: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .user_agent(format!("poe-manager-desktop/{} ({purpose})", env!("CARGO_PKG_VERSION")))
            .timeout_global(Some(TIMEOUT))
            .build()
            .into();
        Self { agent, policies: HashMap::new() }
    }

    /// Сколько ждать до запроса политики поиска: правило ограничено или использовано на 2/3 —
    /// до конца его окна (от момента, когда сайт это сообщил). 0 — можно.
    pub fn search_wait(&self) -> u64 {
        self.wait_for("trade-search-request-limit").max(self.wait_for("trade-fetch-request-limit"))
    }

    /// Сколько ждать до запроса человека: только если правило уже исчерпано или сайт ограничил
    /// запросы. Фоновый искатель уступает раньше (`search_wait`), человек — ищет, пока можно.
    pub fn wait_strict(&self, policy: &str) -> u64 {
        self.wait_with(policy, |rule| if rule.restricted > 0 { rule.restricted } else if rule.hits >= rule.max { rule.period } else { 0 })
    }

    fn wait_for(&self, policy: &str) -> u64 {
        self.wait_with(policy, |rule| if rule.restricted > 0 { rule.restricted } else if rule.hits * 3 >= rule.max * 2 { rule.period } else { 0 })
    }

    fn wait_with(&self, policy: &str, window: impl Fn(&Rule) -> u64) -> u64 {
        let Some(state) = self.policies.get(policy) else { return 0 };
        let elapsed = state.observed.elapsed().as_secs();
        state.rules.iter().map(|rule| window(rule).saturating_sub(elapsed)).max().unwrap_or(0)
    }

    /// Поиск: id запроса, сколько всего, id первых до 100 предложений. `league` — как его называет сайт.
    pub fn search(&mut self, league: &str, payload: &Value) -> Result<SearchResponse, TradeError> {
        let url = format!("{TRADE}/search/{}", encode(league));
        let response = self.agent.post(&url).header("Accept", "application/json").send_json(payload);
        self.read(response)
    }

    /// Предложения по id (не больше 10 за раз) из поиска `query`: ответ сайта как есть.
    pub fn fetch(&mut self, ids: &[String], query: &str) -> Result<Vec<Value>, TradeError> {
        let ids: Vec<&str> = ids.iter().take(FETCH_LIMIT).map(String::as_str).collect();
        let url = format!("{TRADE}/fetch/{}?query={}", ids.join(","), encode(query));
        let response = self.agent.get(&url).header("Accept", "application/json").call();
        let fetched: Value = self.read(response)?;
        Ok(fetched.get("result").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter(|v| !v.is_null()).collect())
    }

    /// Поиск и, если предложений хотя бы 3, 10 самых дешёвых. `league` — как его называет сайт.
    pub fn quote(&mut self, league: &str, payload: &Value) -> Result<SearchOutcome, TradeError> {
        let body = self.search(league, payload)?;
        if body.total < 3 || body.result.is_empty() {
            return Ok(SearchOutcome { total: body.total, listings: Vec::new() });
        }
        std::thread::sleep(Duration::from_secs(1));
        let fetched = self.fetch(&body.result, &body.id)?;
        Ok(SearchOutcome { total: body.total, listings: fetched.iter().filter_map(listing).collect() })
    }

    fn read<T: serde::de::DeserializeOwned>(&mut self, response: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<T, TradeError> {
        let mut response = response.map_err(|e| TradeError::Failed(format!("сайт торговли недоступен: {e}")))?;
        let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
        if let (Some(policy), Some(rules), Some(state)) = (header("x-rate-limit-policy"), header("x-rate-limit-ip"), header("x-rate-limit-ip-state")) {
            self.policies.insert(policy, PolicyState { rules: parse_rules(&rules, &state), observed: Instant::now() });
        }
        let status = response.status().as_u16();
        if status == 429 {
            let wait = header("retry-after").and_then(|v| v.trim().parse().ok()).unwrap_or(DEFAULT_RETRY_AFTER);
            return Err(TradeError::RateLimited(wait));
        }
        let text = response.body_mut().with_config().limit(4 * 1024 * 1024).read_to_string().map_err(|e| TradeError::Failed(format!("ответ сайта не прочитан: {e}")))?;
        if !(200..300).contains(&status) {
            return Err(TradeError::Failed(format!("сайт торговли ответил HTTP {status}: {}", text.chars().take(200).collect::<String>())));
        }
        serde_json::from_str(&text).map_err(|e| TradeError::Failed(format!("ответ сайта не разобран: {e}")))
    }
}

fn listing(entry: &Value) -> Option<Listing> {
    let listing = entry.get("listing")?;
    let price = listing.get("price")?;
    let amount = price.get("amount")?.as_f64()?;
    let currency = price.get("currency")?.as_str()?.to_string();
    let seller = listing.get("account").and_then(|a| a.get("name")).and_then(Value::as_str).map(|name| {
        let digest = Sha256::digest(name.as_bytes());
        digest.iter().take(8).map(|b| format!("{b:02x}")).collect::<String>()
    });
    let indexed_at = listing.get("indexed").and_then(Value::as_str).map(str::to_string);
    Some(Listing { amount, currency, seller, indexed_at })
}

/// `5:10:60,15:60:300` и `1:10:0,1:60:0` → правила с текущим счётом.
fn parse_rules(rules: &str, state: &str) -> Vec<Rule> {
    let triples = |text: &str| -> Vec<[u64; 3]> {
        text.split(',')
            .map(|rule| {
                let mut parts = rule.split(':').map(|v| v.trim().parse::<u64>().unwrap_or(0));
                [parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0)]
            })
            .collect()
    };
    let states = triples(state);
    triples(rules)
        .into_iter()
        .enumerate()
        .map(|(index, [max, period, _])| {
            let [hits, _, restricted] = states.get(index).copied().unwrap_or([0, period, 0]);
            Rule { max: max as u32, period, hits: hits as u32, restricted }
        })
        .collect()
}

pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Отчёт серверу по одному заданию.
pub fn report_json(lease_id: &str, searched_at: &str, outcome: Result<SearchOutcome, &TradeError>) -> Value {
    match outcome {
        Ok(found) => json!({
            "leaseId": lease_id,
            "searchedAt": searched_at,
            "total": found.total,
            "listings": found.listings.iter().map(|l| json!({
                "amount": l.amount,
                "currency": l.currency,
                "seller": l.seller,
                "indexedAt": l.indexed_at,
            })).collect::<Vec<_>>(),
        }),
        Err(TradeError::RateLimited(_)) => json!({ "leaseId": lease_id, "searchedAt": searched_at, "error": "RATE_LIMITED" }),
        Err(TradeError::Failed(_)) => json!({ "leaseId": lease_id, "searchedAt": searched_at, "error": "FAILED" }),
    }
}

