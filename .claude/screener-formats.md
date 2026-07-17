# Screener search formats (README material)

The search bar does three things, decided by two characters:

- input contains `;` → **multiple event URLs/IDs**, looked up together
- input contains `,` → **screener query**
- otherwise → single event URL / slug / ID lookup

## Multiple events at once

```
URL1;URL2;URL3
slug-one;slug-two
https://polymarket.com/event/foo;bar-slug;12345
```

Separate any mix of URLs, slugs and numeric IDs with `;`. All markets from
every found event are pooled into one panel ("Events found") — tick across
events freely, one Track click registers everything. URLs that match nothing
are reported in an error line while the rest still load.

## Query shape

```
sport, prop filter, price condition
```

Parts are comma-separated. Only the sport is required; the other two can be
omitted or given in any order.

## Part 1 — sport (required)

One of: `soccer` (alias `football`), `tennis`, `baseball`, `mlb`,
`basketball`, `nba`, `nfl`, `cricket`, `esports`.
Anything else returns an error listing the valid keywords.

## Part 2 — prop filter (optional)

A case-insensitive **contains-match on the market question as Polymarket
writes it** — it does NOT match outcome names or market types. Prop wording
differs per sport; these are the real patterns from live data (July 2026):

| Sport      | You type            | Matches questions like                         |
|------------|---------------------|------------------------------------------------|
| soccer     | `o/u 2.5`           | "Arsenal vs. Chelsea: O/U 2.5"                 |
| soccer     | `1st half o/u`      | "…: 1st Half O/U 1.5"                          |
| soccer     | `spread`            | "Spread: Arsenal (-1.5)"                        |
| soccer     | `both teams`        | "Both Teams to Score?"                          |
| soccer     | `exact score`       | correct-score props                             |
| tennis     | `match o/u`         | "…: Match O/U 21.5" (total games)              |
| tennis     | `set 1 games`       | "…: Set 1 Games O/U 8.5"                       |
| tennis     | `total sets`        | "…: Total Sets O/U 2.5"                        |
| baseball   | `home runs`         | "Home Runs O/U 2.5"                             |
| baseball   | `strikeouts`        | "Strikeouts O/U 8.5"                            |
| baseball   | `innings`           | "1st 5 Innings O/U 4.5"                         |
| baseball   | `o/u 8.5`           | full-game run totals                            |
| cricket    | `toss`              | "… - Who wins the toss?"                        |
| cricket    | `top batter`        | "… - Team Top Batter …"                         |
| cricket    | `completed match`   | "… - Completed match?"                          |
| esports    | `total kills`       | "Total Kills Over/Under 27.5 in Game 1?"        |
| esports    | `odd/even`          | "Odd/Even Total Kills / Rounds?"                |
| esports    | `roshan` / `baron`  | objective props (Dota / LoL)                    |
| nfl / nba  | `o/u` / `spread`    | game totals and handicaps (in season)           |
| any        | `arsenal`           | any question mentioning that team/player        |

Common mistake: `yes/no` matches nothing — no question contains that text.
Yes/No is the *outcome* shape, not the question. Search the prop wording
instead ("both teams", "toss", "total kills", …).

Note: NFL/NBA are largely off-season in July — mostly futures and specials;
game props (O/U, spreads) appear when the season runs.

## Part 3 — price condition (optional)

```
[side] < value     or     [side] > value
```

- `side` is a contains-match on an **outcome label**: `over`, `under`, `yes`,
  `no`, or a team/player name. Omit it to match if ANY outcome qualifies.
- `value` is a probability 0–1 (Polymarket prices ≈ implied probability).

## Working examples (all verified live)

```
soccer, o/u 3.5, over < 0.40     ← the client's original ask
soccer, o/u 2.5                  ← all 2.5-goal totals, any price
soccer, 1st half o/u             ← first-half totals
soccer, spread, > 0.90           ← heavy handicap favorites
soccer, both teams, yes < 0.50
tennis, o/u                      ← set/game totals
baseball, o/u 8.5, under < 0.45
cricket, o/u
soccer, exact score
soccer                           ← everything live in the sport (capped at 50)
```

## Limits to document

- Results cap at 50 markets; narrow the query if you hit it.
- Prices shown are Gamma's cached `outcomePrices` — screening-grade; the live
  midpoint takes over once you track the market.
- "Active" per Polymarket can include effectively-decided markets
  (prices at 1.000/0.000) — visible in the chips, skip by eye.
- Scans the first 300 events of the sport by volume.
