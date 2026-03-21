# CFR Bucketing Audit

## Summary
Audited `shared/src/cfr/infoSet.ts`, `shared/src/cfr/cfrEval.ts`, `shared/src/cfr/actionMapper.ts`, and their training counterparts. Found 6 issues, 2 critical.

## Issue #1 (CRITICAL): Three-way plausibility threshold mismatch

Three files define "minimum cards for hand type" with different values:

| Hand Type | Training infoSet | Training actionMapper | Eval cfrEval |
|---|---|---|---|
| PAIR | 4 | 3 | 5 |
| TWO_PAIR | 7 | 8 | 9 |
| FLUSH | 8 | 10 | 12 |
| THREE_OF_A_KIND | 8 | 8 | 12 |
| STRAIGHT | 10 | 12 | 14 |
| FULL_HOUSE | 12 | 14 | 18 |
| FOUR_OF_A_KIND | 16 | 18 | 22 |
| STRAIGHT_FLUSH | 20 | 22 | 28 |
| ROYAL_FLUSH | 25 | 26 | 34 |

**Impact**: Bot trains under looser thresholds, eval overrides with stricter ones. Trained strategy says "raise" but eval converts to "bull". Behavioral mismatch.

**Fix**: Align all three to a single canonical set in `shared/`. Training and eval must use identical thresholds.

## Issue #2 (HIGH): `myHandStrengthBucket` too coarse (3 buckets)

Currently: `strong` (pair+), `draw` (2+ suited), `weak`.

Three-of-a-kind = same bucket as pair. 4 suited cards = same as 2 suited. When deciding bull/true, the exact strength of your hand matters enormously.

**Fix**: Expand to 5 buckets: `trips+` (3oak+), `pair`, `draw` (2+ suited or connected), `highcard` (A/K/Q), `weak`.

## Issue #3 (HIGH): `handVsClaimBucket` doesn't distinguish partial support levels

For PAIR: having 1 of the exact called rank vs having a different pair both return `close`. But 1 of the exact rank means only 1 more needed (strong), while a different pair means 2 more needed (weak).

**Fix**: Split `close` into `close1` (have 1+ of exact needed cards) and `close0` (have related cards but not the exact ones). ~4 buckets: `has`, `close1`, `close0`, `below`.

## Issue #4 (MEDIUM): `turnDepthBucket` is binary

≤2 actions vs >2 actions. Late game (3 actions) = same as very late (8 actions). More actions = more info about opponent behavior.

**Fix**: 3 buckets: `early` (≤2), `mid` (3-5), `late` (6+).

## Issue #5 (MEDIUM): `claimPlausibilityBucket` only 3 buckets

`pl`/`mb`/`im` with ratio thresholds at 2.0 and 1.0. The `mb` bucket spans ratio 1.0 to 2.0 — enormous strategic range.

**Fix**: 4 buckets: `pl` (≥2.0), `lk` (≥1.5), `mb` (≥1.0), `im` (<1.0).

## Issue #6 (LOW): Training/eval `handVsClaimBucket` code divergence for THREE_OF_A_KIND

Training has redundant `count >= 2` before `count >= 1` (both → `close`). Eval has only `count >= 1 → close`. Net behavior is identical but should be cleaned up for consistency.

## Estimated info set count after fixes
- Current: ~72K
- After fixes: ~200-300K (mainly from hand strength 3→5 buckets, handVsClaim 3→4 buckets, plausibility 3→4 buckets, turnDepth 2→3 buckets)
- This justifies 5-10M training iterations
