# V2 BACKTESTING MODE — client spec (Aug 5, 2026). NO CODE YET, NO DECISIONS.

## STATUS: LAYOUT SHIPPED (Aug 5), STRATEGY NOT WIRED

/backtesting is live behind a "Backtesting" nav button — design preview only,
mock numbers, "Run backtest" disabled. Modular per the house rule:
  views/Backtesting.jsx                      thin page
  components/backtesting/StrategyCard.jsx    header row + expand
  components/backtesting/StrategyStats.jsx   KPIs, equity, situation table
  components/backtesting/ParamsDialog.jsx    hard filters / bounce / weights,
                                             Restore defaults
  api/backtestPreview.js                     mock data + DEFAULT_PARAMS
Param edits are component-state only. When they become real they go SERVER-SIDE
(presets shared, multi-window — see the Aug 5 localStorage lessons in V2.md).

## THE STRATEGY IN PLAIN TERMS (for the client to confirm)

You watch live MLB games. When a team falls behind, the market often panics
and their price gets very cheap — sometimes cheaper than the real chance of a
comeback. The idea:

1. ONLY look at a game right after a half-inning ends, when the trailing
   team's price is 25c or less and there are still enough innings left.
   Everything else is ignored — no exceptions, no scoring.
2. For the games that qualify, ask ten quick questions: how many innings
   remain? how big is the deficit? does the trailing team bat last (home)?
   are they in form? is the leading team's pitcher tired or wild? who is due
   up? is the park hitter-friendly? is the market cheaper than history says
   this spot deserves? have they shown any contact today? Each answer adds
   points; the weights are adjustable and there is always a default to revert
   to.
3. A high total = the market is probably overreacting. You buy the trailing
   team, and you sell as soon as the price bounces a few cents — you are NOT
   betting they win the game, only that hope returns for a moment.
4. The backtesting page replays this recipe over games the tracker has ALREADY
   recorded (it stores second-by-second prices), so you can see the win rate
   and P&L a set of parameters WOULD have produced — and which situations
   (home teams, 1-run deficits, certain clubs) it actually wins in — before
   risking anything.

## USER DIRECTION (Aug 5) — parked, NOT started

DECISIONS SETTLED (Aug 5, via the user):
- SCORE CAP FIXED AT 14 (weights sum to 14, not "roughly 10"). Thresholds are
  expressed against /14 so they stay comparable. If weights are ever edited,
  the cap changes with them — flag that in the UI when it happens.
- Hard filters first: reconfirmed. One miss = no score, no bet.
- Wild pitcher via API: reconfirmed feasible; bullpen warming stays "unknown".
- Price-vs-history weighting: DO NOT re-weight on opinion — the backtest
  itself is the investigation (do cheap-vs-history spots win more?).
- Team/situation learning: from our own collected corpus.
- VM disk upgrade approved in principle by the user (long-open item).


- Corpus = TRACKED games only (where tick data exists). For those, pull the
  matching MLB game data and STORE IT IN OUR DB (backend). Untracked games
  stay out; the Track click becomes the gateway that collects BOTH ticks and
  MLB data. NO blanket auto-tracking (supersedes that part of the
  architecture note below).

## THE TWO CLARIFICATIONS THAT SETTLED THE DESIGN (user asked, Aug 5)

1. WHAT STRATEGY does the backtest bet? HIS OWN, made mechanical: at each
   half-inning end passing the hard rules, pretend-buy the trailing team at
   the tick price of that moment; win if the recorded prices touch the bounce
   target within the horizon, else loss per the exit rule. Sum across games.
2. WHY SCORES if entry is 3 hard rules? The rules alone fire on almost every
   losing team; he currently filters by eye (tired pitcher? good team? who's
   up?). The checklist IS that eyeballing written down — his own 10 factors.
   The backtest runs BOTH variants side by side: rules-only vs rules+score at
   each cutoff. If high scores don't win more than low scores, the score gets
   dropped — it has to EARN its place. This comparison is the first deliverable.

## CORPUS AUDIT (Aug 6) — 116 games, BUT split by cadence (user caught this)

Tick SPACING audit (counts alone lie):
- 42 GOLD games: live-collected, median gap <=10s (5s pre-Aug-1, 1s after),
  dense span median 7.5h. Full-fidelity backtest incl. delay modelling.
- 74 SILVER games: median gap ~59s = 1-MINUTE BARS. These were tracked AFTER
  the game ended; the Aug 1 settled-market backfill pulls CLOB history, which
  arrives as 1-min bars. Usable for minute-scale win-rate stats; blurs fills,
  misses short spikes, sub-minute delay modelling meaningless.
RULES THAT FOLLOW:
- The backtest must TAG every result gold/silver, never silently mix.
- UPGRADE PATH for silver: data-api /trades?market= (executed trade tape,
  trade-level timestamps) — if it reaches back to those dates, silver gets
  promoted. Still untested.
- TELL THE CLIENT: track BEFORE first pitch -> gold; post-hoc -> silver.

## CORPUS AUDIT DETAIL — day-one backtest has 116 games

Read-only audit of the production DB + MLB replay:
- 116 distinct tracked MLB games (May 9 -> Aug 2), 116/116 with tick data,
  none under 5,000 ticks, 4.2M MLB price points total.
- Resolution: 5s before Aug 1 (1s-while-live change), 1s after. Both fine for
  bounce detection.
- MLB replay VERIFIED on the OLDEST corpus game (gamePk 824766): every play
  carries about.endTime; mid-game ?timecode= linescore AND boxscore both
  serve. Replay reach is no longer a risk.
- GOTCHA FOUND: mlb-tb-bos-2026-05-09 was postponed and PLAYED JULY 17 (654k
  ticks from weeks of pre-game tracking). The backfill must key on PLAY
  TIMESTAMPS, never slug dates — postponements then handle themselves.
- Still untested: data-api /trades?market= historical depth for the trade-tape
  fill model — check during the build.

## EXECUTION REALISM (user raised Aug 5 — must be in the simulator)

A naive backtest fills at the mid-price tick at the signal instant = algo
fiction. Three corrections:
1. REACTION DELAY param (executionDelaySeconds, default ~15-30s): fill at the
   tick at signal+delay. Cheap — we have 1s ticks. Show 0s/15s/60s side by
   side so the client sees what his speed costs.
2. SPREAD: our ticks are MIDPOINTS (what Polymarket displays), but buys pay
   the ASK and exits hit the BID. We did NOT store historical bid/ask, so add
   slippageCentsPerSide (default 0.5-1c) charged on entry AND exit.
3. TRUE FILLS where possible: data-api /trades?market= is the EXECUTED trade
   tape (price+timestamp, verified working during V3 research). Best fill
   model for backfill = first real trade at/after signal+delay. Mid-price
   run = optimistic ceiling; trade-tape run = truth.
GOING FORWARD: store bid+ask alongside mid for tracked games so future
backtests record spreads instead of modelling them.
(CLOB reminder from V2.md: /price?side=buy is the BEST BID; the ask is the
sell-side quote. Do not confuse them again.)

## PROPOSED ARCHITECTURE (Aug 5, discussed with the user — not yet approved)

NO new live MLB storage needed: statsapi replays any past game on demand via
?timecode= (proven all week). The scarce asset is OUR OWN 1s ticks — they only
exist for TRACKED markets (~100+ MLB games so far) and fine history that was
never recorded is unrecoverable (CLOB history is 1-10min bars, too coarse for
bounce detection).

TWO-PHASE DESIGN:
1. BACKFILL (slow, once + nightly append): per tracked MLB game — resolve
   gamePk -> playByPlay (fields) -> half-inning ends -> hard gate -> RAW
   checklist factors at that moment (timecode boxscore etc) -> entry price
   from ticks -> PRICE PATH afterwards (max price within next 1..6
   half-innings). All into a new server-side `backtest_spots` table.
2. RUN (instant): every "Run backtest" is arithmetic over backtest_spots.
   Weights applied to stored RAW FACTORS at query time (weight tweaks rescore
   history free); bounce definition applied to the stored PRICE PATH at query
   time — so the client can COMPARE win definitions instead of picking one
   blind. This partially dissolves confirm-item #1.

STATIC ONE-TIMERS: win-expectancy table derived from Retrosheet (bases always
empty -> tiny: inning x half x deficit x home/away), 30-row park-factor table.

STORAGE DECISION FOR THE USER/CLIENT: auto-track all MLB moneylines so the
corpus compounds daily without manual Track clicks (~tens of MB/day, 1s only
while live). This forces the long-open DISK RESIZE TO 20G — package them.

BUILD ORDER: resize+auto-track -> spots schema+backfill -> WE/park tables ->
/api/backtest/run -> swap the UI mock -> only then the live scorer/alerts
reusing the same scoring function.
RISK TO CHECK before relying: how far back ?timecode= serves feed/live
(verified days-old only; test a months-old gamePk).

## TO CONFIRM WITH THE CLIENT BEFORE WIRING

1. WIN DEFINITION (blocks everything): the bounce target and the give-up
   horizon. Draft default in the UI: +5c within 4 half-innings. Also: does a
   spot that never bounces count as a full loss at the entry price, or exit at
   the horizon price?
2. Hard gate: exact minimum innings left (UI draft: 4).
3. Score threshold — CLARIFIED Aug 5: the client NEVER gave one. His spec has
   hard rules + a scoring system but no "enter at score >= X"; he appears to
   enter on judgment once the hard rules pass. The UI's "score >= 7" is OUR
   placeholder. The sharper question for him: is the score a TRIGGER
   (auto-flag above a line -> alerts) or a DECISION AID (ranked list, he
   decides)? Either way the right cutoff is something the backtest should
   DISCOVER (win rate at 5+/6+/7+/8+), not something he must guess up front.
4. Confirm the restructure he half-proposed: historical win expectancy vs
   price becomes the BASE signal, checklist factors become adjustments.
5. Stake model for P&L: flat $ per spot, or per-price sizing?
6. Where live scores surface once wired (screener rows? alerts at score >= X?)
   — the backtest page itself is only the lab.
7. Data honesty: bullpen "warming" is not reliably in the API; scores will
   treat it as unknown, not zero. He already accepted this — reconfirm.


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
