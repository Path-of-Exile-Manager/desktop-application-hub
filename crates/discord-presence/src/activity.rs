//! Активность (статус) для `SET_ACTIVITY`.
//! Поля: https://discord.com/developers/docs/events/gateway-events#activity-object

use serde_json::{Value, json};

/// Тип активности — первая строка карточки: «Играет в …», «Смотрит …» и т. д.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityType {
    Playing,
    Listening,
    Watching,
    Competing,
}

impl ActivityType {
    pub fn code(self) -> u8 {
        match self {
            ActivityType::Playing => 0,
            ActivityType::Listening => 2,
            ActivityType::Watching => 3,
            ActivityType::Competing => 5,
        }
    }

    /// Из строки интерфейса: `playing`, `listening`, `watching`, `competing`.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "playing" => ActivityType::Playing,
            "listening" => ActivityType::Listening,
            "watching" => ActivityType::Watching,
            "competing" => ActivityType::Competing,
            _ => return None,
        })
    }
}

/// Группа: без неё нет пункта «Пригласить». Размер Discord дописывает ко второй строке: «(1 из 4)».
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Party {
    pub id: String,
    pub size: Option<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activity {
    pub kind: ActivityType,
    /// Первая строка под названием приложения.
    pub details: Option<String>,
    /// Вторая строка.
    pub state: Option<String>,
    /// Начало таймера «прошло», секунды с 1970-01-01.
    pub start: Option<u64>,
    /// Ключ картинки из Developer Portal → Rich Presence → Art Assets.
    pub large_image: Option<String>,
    /// Подсказка при наведении на картинку.
    pub large_text: Option<String>,
    pub party: Option<Party>,
    /// Строка до 128 символов, которую получит приложение получателя в `ACTIVITY_JOIN`.
    pub join_secret: Option<String>,
}

impl Activity {
    pub fn to_json(&self) -> Value {
        let mut activity = json!({ "type": self.kind.code(), "instance": false });
        if let Some(details) = &self.details {
            activity["details"] = json!(details);
        }
        if let Some(state) = &self.state {
            activity["state"] = json!(state);
        }
        if let Some(start) = self.start {
            activity["timestamps"] = json!({ "start": start });
        }
        let mut assets = json!({});
        if let Some(image) = &self.large_image {
            assets["large_image"] = json!(image);
        }
        if let Some(text) = &self.large_text {
            assets["large_text"] = json!(text);
        }
        if assets.as_object().is_some_and(|a| !a.is_empty()) {
            activity["assets"] = assets;
        }
        if let Some(party) = &self.party {
            let mut value = json!({ "id": party.id });
            if let Some((current, max)) = party.size {
                value["size"] = json!([current, max]);
            }
            activity["party"] = value;
        }
        if let Some(secret) = &self.join_secret {
            activity["secrets"] = json!({ "join": secret });
        }
        activity
    }
}
