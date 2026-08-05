# V2 BACKTESTING MODE — client spec (Aug 5, 2026). NO CODE YET, NO DECISIONS.

Captured verbatim-in-substance from the client. Awaiting direction on scope
and priorities before anything is built. Read V1.md + V2.md first.

## WHAT IT IS

A live MLB comeback-scoring system: when the trailing team's price is cheap
after a half-inning ends, score the situation on a weighted checklist and
surface it. Then a backtesting/meta layer that logs every qualifying spot and
its outcome so the weights can be tuned from evidence ("we're 79% when we bet
the home team at score X").

His strategy context (matters for design): he BUYS THE TRAILING TEAM when they
are about to bat, and EXITS ON A BOUNCE — he does not hold to resolution. So
"win" for backtesting is probably a PRICE MOVE, not the team winning (open
question below). Because entries only happen at the end of a half-inning,
bases are ALWAYS EMPTY at evaluation time — this simplifies every historical
lookup.

## LAYER 0 — HARD FILTERS (gate; run FIRST; if any fails, DO NOT score)

- Trailing team price <= 25c
- Timing: a half-inning has just COMPLETED (never mid-inning)
- Minimum innings left (threshold number NOT yet specified — ask)
Client explicitly wants these separate from scoring, applied first. Agreed.

## LAYER 1 — SCORING CHECKLIST (client's default weights)

1. Remaining innings (0-2): 6+ left = 2; 4-5 = 1; fewer = 0/skip
2. Score differential (0-2): trail by 1 = 2; by 2 = 1; by 3 = 0
   (or 1 only if other factors very strong AND early)
3. Trailing team is HOME (0-1.5): home = 1.5 (last at-bat); away = 0.5 or 0
4. Team quality + recent form (0-2): strong record + good recent offense = 2;
   average = 1; poor = 0. RECENT = LAST 6 GAMES ONLY (2 series).
   PLUS: head-to-head series context — if this is game 3 of a series, show an
   asterisk with the previous games' scores and each team's total run diff
   across the series.
5. LEADING team's pitching situation (0-1.5): tired starter / high pitch
   count / about to exit / weak middle reliever entering = 1.5; fresh
   effective arm = 0. After the 6th-7th check bullpen usage. Client accepts
   "who is warming" is unreliable in the API — plan for partial data.
6. TRAILING team's pitcher (0-1.5, parallel): strong/effective = add;
   weak/tired = 0 or subtract. Less critical to him (he buys when they BAT and
   can exit on the bounce) but wildness matters both ways.
7. Trailing team's due-up spot (0-1): top/middle of the order = 1; bottom = 0
8. Ballpark + weather (0-1): hitter-friendly park + warm/wind-out = 1;
   pitcher-friendly / cold / wind-in = 0
9. Market price vs rough historical win expectancy (0-1): price 15-20c but
   history says the spot wins noticeably more often = 1. He suspects this is
   UNDER-weighted and asked for an opinion. Sources he gave:
   - https://gregstoll.com/~gregstoll/baseball/runsperinning.html
   - https://gregstoll.com/~gregstoll/baseball/stats.html#V.0.1.0.1.0.0
   - https://www.retrosheet.org/game.htm (full database)
   - https://baseballsavant.mlb.com/game-strategy-explorer
10. Contact bonus (0-0.5, max 1): trailing team already has a few hits =
    small bonus; hitless/near-hitless = slight penalty. Confirmation only,
    deliberately low weight.

NOTE: his bands actually sum to ~14, not 10 ("max roughly 10" is off). He
asked whether hitting exactly 10 matters — it doesn't; what matters is a fixed
max so scores are comparable. Normalize (show X/max or a percentage).

## PITCHER DETAIL (his longest ask)

Wants, for BOTH pitchers: walks allowed THIS GAME, hits+walks this game,
season walk rate (BB/9 or BB%), and "wildness" (missing the zone, behind in
counts 2-0/3-1, walks/HBP). Full leading-pitcher points if tired OR multiple
walks this game OR high walk rate + mediocre ERA; partial credit for high-ERA
with okay control. Wild leading pitcher = free baserunners = comeback fuel.

FEASIBILITY (from what this codebase already does — see analyze.py/matchup.py):
- This-game IP/H/R/ER/BB/K + pitch count: HAVE (boxscore stats.pitching)
- Season ERA/WHIP: HAVE. BB/9 / BB%: derivable from seasonStats
  (baseOnBalls, inningsPitched, battersFaced)
- Behind-in-count / balls-out-of-zone rates: in feed playEvents per pitch —
  heavier, but the ?fields= trick applies (see V2.md fields table)
- Bullpen "who is warming": NOT in the API reliably. Infer "about to exit"
  from pitch count + times through the order; treat as partial data.
- Batting-order due-up: HAVE (battingOrder logic in analyze.py)
- Last-6-games form + series H2H: derivable from schedule + linescores;
  season series already computed in analyze.py
- Weather: in gameData.weather (HAVE). Park factors: needs a static 30-park
  table (small, one-time).

## LAYER 2 — RE-SCORING + CONFIG

- Re-score after EVERY completed half-inning; a score can decay (his example:
  8 after the 3rd -> 3 after the 6th).
- Weights must be EDITABLE with a DEFAULT preset to revert to.

## LAYER 3 — TRACKING / BACKTESTING (the actual point)

Log every qualifying spot (score + all factor values + price) and what
happened next, so he can see per-team / per-situation hit rates and tune:
"65% win rate on Red Sox when our score shows X", "79% on home teams at score
X". Surface which situations most often precede a price bounce.

OUR UNIQUE ASSET: we already store 1s ticks for tracked live MLB markets plus
full play-by-play, and statsapi supports timecode replay (V2.md). So the
checklist can be backtested against ALREADY-COLLECTED games without a single
real bet. This is the strongest part of the whole idea and mostly uses data
we have.

## HIS OPEN QUESTIONS + MY RECOMMENDATIONS (not yet agreed)

1. "Is price-vs-history under-weighted?" — YES, and the cleaner fix is
   structural: make historical win expectancy vs market price the BASE signal
   (the edge), and the checklist factors ADJUSTMENTS on top. With bases always
   empty the lookup table is small: (inning, half, deficit, home/away).
2. "Team quality double-counts with the historical lookup?" — same answer:
   history = base probability, team quality = small modifier. He proposed
   exactly this; endorse it.
3. "Must it total 10?" — No. Fixed max + normalization; raw bands can stay.
4. Hard-filters-first — agree unconditionally; cheap and matches how the
   collector already gates work.
5. "Warming" data — agree it's unreliable; design for partial data with an
   explicit "unknown" state rather than a fake 0.
6. Per-team hit-rate tracking — feasible and the most valuable piece; needs a
   stored log of spots + outcomes (server-side table, not localStorage).

## DECISIONS NEEDED BEFORE BUILDING (ask the client / user)

- BOUNCE DEFINITION: what counts as a success for backtesting? Price +N cents
  within M innings? Reaching a target price? Team actually winning? (He exits
  early, so pure win% is the wrong target.) Also an exit rule for the log.
- Hard-gate minimum innings left: exact number.
- Where scores surface: row badge? expand panel? separate page? Alert hook
  ("score >= 7 -> alert") would reuse the existing alert stack.
- Weight editing: UI dialog vs config file; where presets live (server-side —
  multi-window localStorage lessons apply, see V2.md Aug 5).
- Historical WE source: derive our own table from Retrosheet once, or embed a
  compact static table. Baseball Savant / Stoll pages are references, not
  APIs — check licensing before shipping their numbers.
- Scope split: live scorer first vs backtest-on-stored-games first. (The
  backtest can validate the checklist BEFORE the live scorer exists.)
