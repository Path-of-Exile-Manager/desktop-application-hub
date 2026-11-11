//! Многошаговые методы на магическом предмете: перемены, усиление, царь, возвышение.
//!
//! Попытка — сфера перемен и всё, что за ней следует по правилам метода:
//! - **усиление**, если у предмета один мод и усиление может закончить цель (или, при крафте
//!   царём, дать notable цели, с которым царь уже может её закончить);
//! - **царь**, если на предмете есть notable цели, а добавленный мод может её закончить
//!   (сам или с возвышением после);
//! - **возвышение**, если после царя цель не закончена, а один мод ещё может её закончить;
//! - неудача после царя — сфера очищения и превращение, дальше снова перемены.
//!
//! Решения одни и те же для точного расчёта и для Монте-Карло ([`Decider`]), поэтому
//! Монте-Карло проверяет и вероятности, и расчёт по ним.

use crate::exact::{Rarity, Solver, State};
use crate::pool::Pool;

/// Какие сферы метод добавляет к сферам перемен.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AltPolicy {
    pub augment: bool,
    pub regal: bool,
    pub exalt: bool,
}

/// Цены шагов попытки, в хаосах.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AltCosts {
    pub alteration: f64,
    pub augmentation: f64,
    pub regal: f64,
    pub exalted: f64,
    /// После неудачного царя: очищение и превращение вместо следующей сферы перемен.
    pub reset: f64,
}

/// Попытка: вероятность закончить ею цель и её ожидаемая стоимость.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Attempt {
    pub success: f64,
    pub cost: f64,
}

pub(crate) struct Decider<'a> {
    pool: &'a Pool,
    pub magic: Solver<'a>,
    pub rare: Solver<'a>,
}

impl<'a> Decider<'a> {
    pub fn new(pool: &'a Pool) -> Self {
        Self {
            pool,
            magic: Solver::new(pool, Rarity::Magic.limits()),
            rare: Solver::new(pool, Rarity::RareJewel.limits()),
        }
    }

    pub fn hit(&self, state: State) -> bool {
        self.pool.hit(state.taken)
    }

    pub fn should_augment(&mut self, policy: AltPolicy, state: State) -> bool {
        if !policy.augment || state.mods() != 1 || self.hit(state) {
            return false;
        }

        let ready = self.pool.any_target(state.taken);

        for (next, _) in self.magic.add_one(state) {
            if self.hit(next) || (policy.regal && !ready && self.should_regal(policy, next)) {
                return true;
            }
        }

        false
    }

    pub fn should_regal(&mut self, policy: AltPolicy, state: State) -> bool {
        if !policy.regal || self.hit(state) || !self.pool.any_target(state.taken) {
            return false;
        }

        for (next, _) in self.rare.add_one(state) {
            if self.hit(next) || self.should_exalt(policy, next) {
                return true;
            }
        }

        false
    }

    pub fn should_exalt(&mut self, policy: AltPolicy, state: State) -> bool {
        policy.exalt
            && !self.hit(state)
            && self
                .rare
                .add_one(state)
                .iter()
                .any(|(next, _)| self.pool.hit(next.taken))
    }

    /// Точная вероятность и стоимость попытки.
    pub fn attempt(&mut self, policy: AltPolicy, costs: AltCosts) -> Attempt {
        let mut attempt = Attempt {
            success: 0.0,
            cost: costs.alteration,
        };

        for (state, chance) in self.magic.reroll_outcomes(Rarity::Magic.mod_counts()) {
            if self.should_augment(policy, state) {
                attempt.cost += chance * costs.augmentation;

                for (next, share) in self.magic.add_one(state) {
                    self.after_magic(policy, costs, next, chance * share, &mut attempt);
                }
            } else {
                self.after_magic(policy, costs, state, chance, &mut attempt);
            }
        }

        attempt
    }

    fn after_magic(
        &mut self,
        policy: AltPolicy,
        costs: AltCosts,
        state: State,
        chance: f64,
        attempt: &mut Attempt,
    ) {
        if self.hit(state) {
            attempt.success += chance;

            return;
        }

        if !self.should_regal(policy, state) {
            return;
        }

        attempt.cost += chance * costs.regal;

        for (next, share) in self.rare.add_one(state) {
            let reached = chance * share;

            if self.hit(next) {
                attempt.success += reached;
            } else if self.should_exalt(policy, next) {
                let finished: f64 = self
                    .rare
                    .add_one(next)
                    .iter()
                    .filter(|(last, _)| self.pool.hit(last.taken))
                    .map(|(_, share)| share)
                    .sum();

                attempt.cost += reached * (costs.exalted + (1.0 - finished) * costs.reset);
                attempt.success += reached * finished;
            } else {
                attempt.cost += reached * costs.reset;
            }
        }
    }
}
