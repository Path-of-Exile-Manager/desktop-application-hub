//! Старый интерфейс сайта `www.pathofexile.com/character-window/*` с кукой `POESESSID` пользователя
//! (решение пользователя 21.11.2026: OAuth GGG закрыт для новых приложений). Адреса не входят в
//! документацию GGG — запросов делаем как можно меньше и строго по заголовкам лимитов; 401/403 не
//! повторяем (у GGG есть порог неверных запросов).
//!
//! Лимиты на 21.11.2026 (по заголовкам, на IP): тайник `backend-item-request-limit`
//! 30 за 60 с, 90 за 30 мин, 180 за 2 ч; персонажи — 15 за 60 с.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

const SITE: &str = "https://www.pathofexile.com";
const TIMEOUT: Duration = Duration::from_secs(40);
/// Пауза после 429 без `Retry-After`.
const DEFAULT_RETRY_AFTER: u64 = 60;
/// Ответ вкладки (квадратная — до 576 предметов) — несколько МБ.
const MAX_BODY: u64 = 32 * 1024 * 1024;

/// Одно правило лимита: не больше `max` запросов за `period` секунд.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "StashLimitRule")]
pub struct Rule {
    /// `Ip`, `Account`.
    pub scope: String,
    pub max: u32,
    pub period: u64,
    /// Сколько уже сделано в окне (по последнему ответу).
    pub hits: u32,
    /// Сайт ограничил запросы ещё на столько секунд.
    pub restricted: u64,
}

#[derive(Debug, Clone)]
struct PolicyState {
    rules: Vec<Rule>,
    observed: Instant,
}

#[derive(Debug)]
pub enum PoeError {
    /// 401/403: кука не подходит, истекла или имя аккаунта не то.
    Unauthorized,
    /// 404: нет такой лиги у аккаунта или такого персонажа.
    NotFound(String),
    /// 429 или правило исчерпано: ждать столько секунд.
    RateLimited(u64),
    Failed(String),
}

impl std::fmt::Display for PoeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unauthorized => f.write_str("сайт PoE не принял сессию: POESESSID устарел (выход на сайте, смена пароля) или имя аккаунта указано неверно"),
            Self::NotFound(m) => write!(f, "сайт PoE: {m}"),
            Self::RateLimited(s) => write!(f, "лимит запросов сайта PoE: следующий запрос можно сделать через {}", wait_text(*s)),
            Self::Failed(m) => f.write_str(m),
        }
    }
}

pub fn wait_text(seconds: u64) -> String {
    if seconds < 90 { format!("{seconds} с") } else { format!("{} мин", seconds.div_ceil(60)) }
}

/// Вкладка тайника, как её описывает сайт.
#[derive(Debug, Clone, Deserialize)]
pub struct RawTab {
    /// `n` — название.
    #[serde(default)]
    pub n: String,
    /// `i` — номер вкладки (меняется при перестановке).
    #[serde(default)]
    pub i: Option<u32>,
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub colour: Option<RawColour>,
    /// Вкладки внутри папки.
    #[serde(default)]
    pub children: Vec<RawTab>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawColour {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Ответ `get-stash-items`: предметы вкладки и (с `tabs=1`) список вкладок.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashResponse {
    #[serde(default)]
    pub tabs: Vec<RawTab>,
    #[serde(default)]
    pub items: Vec<Value>,
}

pub struct PoeClient {
    agent: ureq::Agent,
    session: String,
    policies: HashMap<String, PolicyState>,
    last_request: HashMap<String, Instant>,
}

impl PoeClient {
    pub fn new(session: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .user_agent(format!("poe-manager-desktop/{} (stash value)", env!("CARGO_PKG_VERSION")))
            .timeout_global(Some(TIMEOUT))
            .build()
            .into();
        Self { agent, session: session.to_string(), policies: HashMap::new(), last_request: HashMap::new() }
    }

    /// Правила лимита тайника по последнему ответу (для интерфейса).
    pub fn stash_rules(&self) -> Vec<Rule> {
        self.policies.get(STASH_POLICY).map(|p| p.rules.clone()).unwrap_or_default()
    }

    /// Сколько ждать перед следующим запросом политики: правило ограничено или в окне остался
    /// один запрос — до конца окна; иначе — ровный шаг самого частого правила (30 за 60 с → 2 с).
    pub fn wait_before(&self, policy: &str) -> Duration {
        let Some(state) = self.policies.get(policy) else { return Duration::ZERO };
        let elapsed = state.observed.elapsed().as_secs_f64();
        let mut wait: f64 = 0.0;
        for rule in &state.rules {
            if rule.restricted > 0 {
                wait = wait.max(rule.restricted as f64 - elapsed);
            } else if rule.hits + 1 >= rule.max {
                wait = wait.max(rule.period as f64 - elapsed);
            }
        }
        let pace = state.rules.iter().filter(|r| r.period <= 120 && r.max > 0).map(|r| r.period as f64 / r.max as f64 * 1.1).fold(0.0, f64::max);
        if let Some(last) = self.last_request.get(policy) {
            wait = wait.max(pace - last.elapsed().as_secs_f64());
        }
        Duration::from_secs_f64(wait.max(0.0))
    }

    /// Предметы вкладки `index` лиги; `with_tabs` — заодно список вкладок.
    pub fn stash(&mut self, account: &str, league: &str, index: u32, with_tabs: bool) -> Result<StashResponse, PoeError> {
        let url = format!(
            "{SITE}/character-window/get-stash-items?accountName={}&realm=pc&league={}&tabs={}&tabIndex={index}",
            encode(account),
            encode(league),
            if with_tabs { 1 } else { 0 }
        );
        let text = self.get(&url, Some(STASH_POLICY))?;
        let value: Value = serde_json::from_str(&text).map_err(|e| PoeError::Failed(format!("ответ сайта PoE не разобран: {e}")))?;
        if let Some(error) = value.get("error") {
            return Err(PoeError::NotFound(error.get("message").and_then(Value::as_str).unwrap_or("неизвестная ошибка").to_string()));
        }
        serde_json::from_value(value).map_err(|e| PoeError::Failed(format!("ответ сайта PoE не разобран: {e}")))
    }

    /// Имя аккаунта (`Name#1234`) со страницы профиля: ссылка `/account/view-profile/Name-1234`.
    /// `None` — не нашли (сайт поменял вёрстку или сессия не та).
    pub fn detect_account(&mut self) -> Result<Option<String>, PoeError> {
        let html = self.get(&format!("{SITE}/my-account"), None)?;
        Ok(account_from_html(&html))
    }

    fn get(&mut self, url: &str, policy: Option<&str>) -> Result<String, PoeError> {
        if let Some(policy) = policy {
            self.last_request.insert(policy.to_string(), Instant::now());
        }
        let response = self
            .agent
            .get(url)
            .header("Accept", "application/json, text/html")
            .header("Cookie", format!("POESESSID={}", self.session))
            .call();
        let mut response = response.map_err(|e| PoeError::Failed(format!("сайт PoE недоступен: {e}")))?;
        let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
        if let (Some(name), Some(rules)) = (header("x-rate-limit-policy"), header("x-rate-limit-rules")) {
            let mut parsed = Vec::new();
            for scope in rules.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let key = scope.to_ascii_lowercase();
                if let (Some(r), Some(s)) = (header(&format!("x-rate-limit-{key}")), header(&format!("x-rate-limit-{key}-state"))) {
                    parsed.extend(parse_rules(scope, &r, &s));
                }
            }
            self.policies.insert(name, PolicyState { rules: parsed, observed: Instant::now() });
        }
        let status = response.status().as_u16();
        if status == 429 {
            return Err(PoeError::RateLimited(header("retry-after").and_then(|v| v.trim().parse().ok()).unwrap_or(DEFAULT_RETRY_AFTER)));
        }
        if status == 401 || status == 403 {
            return Err(PoeError::Unauthorized);
        }
        let text = response.body_mut().with_config().limit(MAX_BODY).read_to_string().map_err(|e| PoeError::Failed(format!("ответ сайта PoE не прочитан: {e}")))?;
        if status == 404 {
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| "не найдено (нет лиги у аккаунта?)".into());
            return Err(PoeError::NotFound(message));
        }
        if !(200..300).contains(&status) {
            return Err(PoeError::Failed(format!("сайт PoE ответил HTTP {status}")));
        }
        Ok(text)
    }
}

pub const STASH_POLICY: &str = "backend-item-request-limit";

/// `30:60:120,90:1800:600` и `1:60:0,1:1800:0` → правила с текущим счётом.
fn parse_rules(scope: &str, rules: &str, state: &str) -> Vec<Rule> {
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
        .map(|(i, [max, period, _])| {
            let [hits, _, restricted] = states.get(i).copied().unwrap_or([0, period, 0]);
            Rule { scope: scope.to_string(), max: max as u32, period, hits: hits as u32, restricted }
        })
        .collect()
}

/// `href="/account/view-profile/Name-1234"` → `Name#1234` (новые имена с номером), без номера — как есть.
pub fn account_from_html(html: &str) -> Option<String> {
    const MARK: &str = "/account/view-profile/";
    let start = html.find(MARK)? + MARK.len();
    let raw: String = html[start..].chars().take_while(|c| !matches!(c, '"' | '\'' | '/' | '?' | '#' | '<' | '>' | ' ')).collect();
    let raw = percent_decode(&raw);
    if raw.is_empty() {
        return None;
    }
    Some(match raw.rsplit_once('-') {
        Some((name, number)) if !name.is_empty() && number.len() == 4 && number.bytes().all(|b| b.is_ascii_digit()) => format!("{name}#{number}"),
        _ => raw,
    })
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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

/// Кука как её копируют: `POESESSID=abc…`, с пробелами, кавычками — оставляем 32 шестнадцатеричных знака.
pub fn normalize_session(input: &str) -> Option<String> {
    let text = input.trim().trim_matches(|c| c == '"' || c == '\'');
    let text = text.strip_prefix("POESESSID=").unwrap_or(text).trim().trim_end_matches(';');
    (text.len() == 32 && text.bytes().all(|b| b.is_ascii_hexdigit())).then(|| text.to_ascii_lowercase())
}
