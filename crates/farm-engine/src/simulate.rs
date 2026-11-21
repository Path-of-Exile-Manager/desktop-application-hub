//! Монте-Карло за час фарма. Одно убийство заранее сводится к дискретному распределению дохода
//! (свёртка пулов), дальше каждое убийство — один выбор по таблице псевдонимов (Vose).

/// Детерминированный генератор (SplitMix64): одинаковое зерно — одинаковый результат.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);

        let mut z = self.0;

        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Равномерно в [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Больше точек распределение одного убийства не держит: соседние по доходу сливаются
/// в одну с тем же средним (дисперсия чуть уменьшается, среднее точное).
const MAX_ATOMS: usize = 4096;

/// Распределение дохода одного убийства: (доход, вероятность).
#[derive(Debug, Clone)]
pub(crate) struct Distribution(Vec<(f64, f64)>);

impl Distribution {
    pub(crate) fn certain(value: f64) -> Self {
        Self(vec![(value, 1.0)])
    }

    /// Доход убийства = этот + независимый `other`.
    pub(crate) fn add(&mut self, other: &[(f64, f64)]) {
        if other.is_empty() {
            return;
        }

        let mut atoms = Vec::with_capacity(self.0.len() * other.len());

        // Сдвиги отсортированного `self` идут подряд: сортировка в `merge` лишь сливает серии.
        for &(right, right_chance) in other {
            for &(left, left_chance) in &self.0 {
                let chance = left_chance * right_chance;

                if chance > 0.0 {
                    atoms.push((left + right, chance));
                }
            }
        }

        self.0 = merge(atoms);
    }

    pub(crate) fn sampler(&self) -> Sampler {
        Sampler::new(&self.0)
    }
}

/// Сортирует, сливает равные значения и сжимает до `MAX_ATOMS`.
fn merge(mut atoms: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    atoms.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut merged: Vec<(f64, f64)> = Vec::with_capacity(atoms.len());

    for (value, chance) in atoms {
        match merged.last_mut() {
            Some(last) if (value - last.0).abs() <= 1e-9 * value.abs().max(1.0) => last.1 += chance,
            _ => merged.push((value, chance)),
        }
    }

    while merged.len() > MAX_ATOMS {
        merged = merged
            .chunks(2)
            .map(|pair| {
                let chance: f64 = pair.iter().map(|atom| atom.1).sum();
                let value = pair.iter().map(|atom| atom.0 * atom.1).sum::<f64>() / chance;

                (value, chance)
            })
            .collect();
    }

    merged
}

/// Таблица псевдонимов: выбор значения за одно случайное число. Ячейка — порог (доля 2⁶⁴),
/// своё значение и значение псевдонима.
pub(crate) struct Sampler {
    cells: Vec<(u64, f64, f64)>,
}

impl Sampler {
    fn new(atoms: &[(f64, f64)]) -> Self {
        let count = atoms.len().max(1);
        let total: f64 = atoms.iter().map(|atom| atom.1).sum();
        let mut values: Vec<f64> = atoms.iter().map(|atom| atom.0).collect();
        let mut scaled: Vec<f64> = atoms
            .iter()
            .map(|atom| atom.1 / total * count as f64)
            .collect();

        if values.is_empty() {
            values.push(0.0);
            scaled.push(1.0);
        }

        let mut aliases = vec![(1.0, 0u32); count];
        let (mut small, mut large): (Vec<usize>, Vec<usize>) =
            (0..count).partition(|&index| scaled[index] < 1.0);

        while let (Some(&less), Some(&more)) = (small.last(), large.last()) {
            small.pop();
            aliases[less] = (scaled[less], more as u32);
            scaled[more] -= 1.0 - scaled[less];

            if scaled[more] < 1.0 {
                large.pop();
                small.push(more);
            }
        }

        for index in small.into_iter().chain(large) {
            aliases[index] = (1.0, index as u32);
        }

        let cells = aliases
            .iter()
            .enumerate()
            .map(|(index, &(keep, alias))| {
                let threshold = if keep >= 1.0 {
                    u64::MAX
                } else {
                    (keep.max(0.0) * 18_446_744_073_709_551_616.0) as u64
                };

                (threshold, values[index], values[alias as usize])
            })
            .collect();

        Self { cells }
    }

    /// Старшая часть `r · n` — ячейка, младшая — равномерная доля внутри неё.
    pub(crate) fn sample(&self, rng: &mut Rng) -> f64 {
        let product = u128::from(rng.next_u64()) * self.cells.len() as u128;
        let (threshold, own, alias) = self.cells[(product >> 64) as usize];

        if (product as u64) < threshold {
            own
        } else {
            alias
        }
    }
}
