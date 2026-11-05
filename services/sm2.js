/**
 * sm2.js — SuperMemo SM-2 spaced-repetition scheduler.
 *
 * Pure function: (card state, grade 0-5, now) → new state. `now` is always
 * passed in — never a hidden Date.now() — so unit tests are deterministic
 * and the caller controls the clock.
 *
 * Algorithm (standard SM-2):
 * - grade < 3 (failure): reps reset to 0, lapses++, interval resets to a
 *   short re-learning step (1 day). Ease still decays via the formula.
 * - grade >= 3 (pass): reps++, interval = 1 day (rep 1) → 6 days (rep 2) →
 *   interval * ease (rep 3+).
 * - Ease update: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)),
 *   floored at 1.3. Grades 0-2 drag ease down, 4-5 nudge it up.
 */

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ease?: number, intervalDays?: number, reps?: number, lapses?: number}} card
 * @param {number} grade — 0 (blackout) … 5 (perfect)
 * @param {Date|number} now — review timestamp (explicit, injected)
 * @returns {{ease: number, intervalDays: number, reps: number, lapses: number, due: Date}}
 */
function schedule(card, grade, now) {
    if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
        throw new Error(`SM-2 grade must be an integer 0-5, got ${grade}`);
    }
    const prev = {
        ease: card.ease ?? 2.5,
        intervalDays: card.intervalDays ?? 0,
        reps: card.reps ?? 0,
        lapses: card.lapses ?? 0,
    };

    // Standard SM-2 ease factor update
    const ease = Math.max(
        MIN_EASE,
        prev.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    );

    let reps, lapses, intervalDays;
    if (grade < 3) {
        // Failed recall: re-learn tomorrow, reset repetition count, count a lapse
        reps = 0;
        lapses = prev.lapses + 1;
        intervalDays = 1;
    } else {
        reps = prev.reps + 1;
        lapses = prev.lapses;
        intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(prev.intervalDays * ease);
    }

    const due = new Date(new Date(now).getTime() + intervalDays * DAY_MS);
    return { ease, intervalDays, reps, lapses, due };
}

module.exports = { schedule, MIN_EASE };
