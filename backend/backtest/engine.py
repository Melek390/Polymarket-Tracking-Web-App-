"""The run engine: pure arithmetic over backtest_spots. No MLB calls, no tick
queries — a parameter tweak re-scores all of history in milliseconds.

Scoring: raw factors -> the client's bands -> weighted points. A factor whose
raw input is missing contributes ZERO and is counted as unknown — the run
reports factor coverage rather than inventing neutral credit (the "unknown,
not zero" rule from the spec).

Win test: the stored path is the mid-price maximum between entry and each of
the next six half-inning boundaries, so "did it touch entry+target within N
halves" is a lookup, and BOTH give-up rules (exit at horizon price vs full
loss) read from the same row. Execution realism per the Aug 5 decisions:
delay picks the stored +0/15/30/60s entry, slippage is charged per side on
top of the mid, and fees follow Polymarket's taker formula per leg
(0.05 x p x (1-p) x shares; makers pay zero).
"""

from backend.backtest import store

# An entry whose first available tick lagged the half end this far means the
# market had stopped quoting — no real fill existed at the signal. The Aug 14
# timestamp audit found 83 such spots (2.4%); they are excluded everywhere
# and counted in the response as staleEntries.
MAX_ENTRY_LAG_S = 120.0


def _stale(spot: dict) -> bool:
    return (spot.get("entry_lag_s") or 0.0) > MAX_ENTRY_LAG_S


# ---- factor banding (client's bands; weights scale them) ------------------

def _band_points(spot: dict, w: dict) -> tuple[float, list[str]]:
    f = spot["factors"]
    pts, unknown = 0.0, []

    # 1 remaining innings
    if spot["innings_left"] >= 6:
        pts += w["remainingInnings"]
    elif spot["innings_left"] >= 4:
        pts += w["remainingInnings"] * 0.5

    # 2 deficit
    if spot["deficit"] == 1:
        pts += w["scoreDeficit"]
    elif spot["deficit"] == 2:
        pts += w["scoreDeficit"] * 0.5

    # 3 home last-at-bat
    pts += w["trailingTeamHome"] * (1.0 if spot["trailing_is_home"] else 0.33)

    # 4 team quality/form — v1 unknown
    unknown.append("teamQualityForm")

    # 5 leading pitcher tired/wild
    lp = f.get("lead_pitcher") or {}
    if lp.get("pitches") is None and lp.get("walks_game") is None:
        unknown.append("leadingPitcher")
    else:
        p, bb = lp.get("pitches") or 0, lp.get("walks_game") or 0
        if p >= 85 or bb >= 3:
            pts += w["leadingPitcher"]
        elif p >= 60 or bb >= 2:
            pts += w["leadingPitcher"] * 0.5

    # 6 trailing pitcher effective
    tp = f.get("trail_pitcher") or {}
    if tp.get("era") is None and tp.get("walks_game") is None:
        unknown.append("trailingPitcher")
    else:
        era, bb = tp.get("era"), tp.get("walks_game") or 0
        if era is not None and era < 4.0 and bb <= 1:
            pts += w["trailingPitcher"]
        elif era is not None and era < 5.0:
            pts += w["trailingPitcher"] * 0.5

    # 7 due-up
    due = f.get("due_up_index")
    if due is None:
        unknown.append("dueUpOrder")
    elif due <= 3:
        pts += w["dueUpOrder"]
    elif due <= 6:
        pts += w["dueUpOrder"] * 0.5

    # 8 park (+weather when replayed)
    pf = f.get("park_factor")
    if pf is None:
        unknown.append("parkWeather")
    elif pf >= 102:
        pts += w["parkWeather"]
    elif pf >= 99:
        pts += w["parkWeather"] * 0.5

    # 9 price vs history — v1 unknown (needs the WE table)
    unknown.append("priceVsHistory")

    # 10 contact
    hits = f.get("trail_hits")
    if hits is None:
        unknown.append("contactBonus")
    elif hits >= 4:
        pts += w["contactBonus"]
    elif hits >= 2:
        pts += w["contactBonus"] * 0.5

    return pts, unknown


def _taker_fee(price_cents: float, shares: float) -> float:
    p = price_cents / 100.0
    return shares * 0.05 * p * (1 - p)


def _trade(spot: dict, bounce: dict, ex: dict, stake: dict) -> dict | None:
    """The trade itself — shared by every strategy kind. Delay picks the
    stored fill; win test, both give-up rules, slippage and fees as settled
    Aug 5. None only when no entry price exists."""
    e0 = spot["entry0"]
    if e0 is None:
        return None
    delay = int(ex.get("delaySeconds") or 0)
    fill_mid = spot.get(f"entry{delay}") if delay in (0, 15, 30, 60) else e0
    if fill_mid is None:
        fill_mid = e0

    horizon = max(1, min(6, int(bounce["horizonHalfInnings"])))
    target_mid = fill_mid + bounce["targetCents"]
    path = spot["path"]

    win_k = None
    for k in range(1, horizon + 1):
        step = path.get(str(k))
        if step and step.get("max") is not None and step["max"] >= target_mid:
            win_k = k
            break

    slip = ex["slippageCentsPerSide"]
    entry_exec = fill_mid + slip
    shares = (stake["usd"] / (entry_exec / 100.0)) if stake["mode"] == "flat_usd" else 100.0

    if win_k is not None:
        exit_mid = target_mid
        hold = win_k
    else:
        hold = horizon
        last = None
        for k in range(horizon, 0, -1):
            step = path.get(str(k))
            if step and step.get("at") is not None:
                last = step["at"]
                break
        if bounce["giveUp"] == "stake" or last is None:
            exit_mid = 0.0          # full loss of the stake
        else:
            exit_mid = last
    exit_exec = max(0.0, exit_mid - slip)

    mode = ex["feeMode"]
    fee = 0.0
    if mode in ("taker_both", "maker_exit"):
        fee += _taker_fee(entry_exec, shares)
    if mode == "taker_both":
        fee += _taker_fee(exit_exec, shares) if exit_mid > 0 else 0.0
    pnl = shares * (exit_exec - entry_exec) / 100.0 - fee

    return {"win": win_k is not None, "pnl": round(pnl, 2), "hold": hold,
            "bounce": round((path.get(str(win_k), {}).get("max") or fill_mid) - fill_mid, 2)
                      if win_k else 0.0,
            "fee": round(fee, 2), "ts": spot["ts"], "gold": spot["gold"],
            "entry": fill_mid}


def _simulate(spot: dict, prm: dict) -> dict | None:
    """Checklist kind: hard gates first, then the trade."""
    hf = prm["hardFilters"]
    e0 = spot["entry0"]
    if e0 is None or _stale(spot):
        return None
    if not (hf["minPriceCents"] <= e0 <= hf["maxPriceCents"]):
        return None
    if spot["innings_left"] < hf["minInningsLeft"]:
        return None
    # tied moments (deficit 0) exist for the comeback replay; the checklist
    # strategy is about TRAILING teams and never trades them
    if spot["deficit"] < 1 or spot["deficit"] > hf["maxDeficit"]:
        return None
    if hf["side"] == "home" and not spot["trailing_is_home"]:
        return None
    if hf["side"] == "away" and spot["trailing_is_home"]:
        return None
    return _trade(spot, prm["bounce"], prm["exec"], prm["stake"])


def _aggregate(results: list[dict]) -> dict:
    n = len(results)
    wins = sum(1 for r in results if r["win"])
    pnl = round(sum(r["pnl"] for r in results), 2)
    equity, peak, mdd, run = [0.0], 0.0, 0.0, 0.0
    for r in results:
        run = round(run + r["pnl"], 2)
        equity.append(run)
        peak = max(peak, run)
        mdd = min(mdd, run - peak)
    bounces = [r["bounce"] for r in results if r["win"]]
    holds = [r["hold"] for r in results]
    return {
        "spots": n, "wins": wins,
        "winRate": round(wins / n, 4) if n else 0.0,
        "pnl": pnl,
        "avgBounceCents": round(sum(bounces) / len(bounces), 1) if bounces else 0.0,
        "avgHoldHalfInnings": round(sum(holds) / len(holds), 1) if holds else 0.0,
        "maxDrawdown": round(mdd, 2),
        "feesPaid": round(sum(r["fee"] for r in results), 2),
        "equity": equity,
    }


# ---- the Comeback Setup replay -------------------------------------------

def _situation_ok(s: dict, sit: dict) -> bool:
    if not s["trailing_is_home"]:
        return False
    states = sit.get("scoreStates") or []
    if s["deficit"] == 1 and "down1" not in states:
        return False
    if s["deficit"] == 0 and "tied" not in states:
        return False
    if s["deficit"] > 1:
        return False
    if s["inning"] < int(sit["minInning"]):
        return False
    if sit.get("requireHomeNext", True) and s["next_half"] != "bottom":
        return False
    return True


def _fatigue_matches(s: dict, fg: dict) -> int:
    lp = s["factors"].get("lead_pitcher") or {}
    m = 0
    if (lp.get("whip") or 0) > float(fg["whipAbove"]):
        m += 1
    if (lp.get("walks_game") or 0) >= int(fg["minWalksGame"]):
        m += 1
    if (lp.get("pitches") or 0) >= int(fg["minPitches"]):
        m += 1
    return m


def run_comeback(params: dict) -> dict:
    """Every time the Comeback Setup tag would have fired historically — and
    what taking it did. Situation + fatigue gates from the tag's own spec;
    the trade model is shared with everything else."""
    spots = store.all_spots(params.get("corpus", {}).get("segment", "both"))
    sit, fg = params["situation"], params["fatigue"]
    settlements = store.home_settlements()

    def select(min_inning=None, min_matches=None):
        chosen = []
        for s in spots:
            override_sit = dict(sit, minInning=min_inning if min_inning is not None
                                else sit["minInning"])
            if _stale(s) or not _situation_ok(s, override_sit):
                continue
            need = int(fg["minMatches"] if min_matches is None else min_matches)
            if _fatigue_matches(s, fg) < need:
                continue
            r = _trade(s, params["bounce"], params["exec"], params["stake"])
            if r:
                chosen.append((s, r))
        return chosen

    chosen = select()
    results = [r for (_, r) in chosen]
    overall = _aggregate(results)

    def comeback_rate(pairs):
        won = lost = 0
        for (s, _) in pairs:
            v = settlements.get(s["market_id"])
            if v is True:
                won += 1
            elif v is False:
                lost += 1
        return {"won": won, "decided": won + lost,
                "rate": round(won / (won + lost), 4) if won + lost else None}

    cb = comeback_rate(chosen)

    # the sweeps his "preferably" language asks for: fatigue on/off/stricter,
    # and inning 7/8/9 — each a full re-run of the saved params with one knob
    # turned, in the same table shape the checklist comparison used
    comparison = []
    for label, kwargs in (
        ("No fatigue filter", {"min_matches": 0}),
        (f"Tired: ≥{fg['minMatches']} check(s) (saved)", {}),
        ("Tired: ≥2 checks", {"min_matches": 2}),
        ("Min inning 7", {"min_inning": 7}),
        ("Min inning 8", {"min_inning": 8}),
        ("Min inning 9", {"min_inning": 9}),
    ):
        sub = select(**kwargs)
        agg = _aggregate([r for (_, r) in sub])
        row = {"label": label,
               **{k: v for k, v in agg.items() if k != "equity"}}
        row["comebackRate"] = comeback_rate(sub)["rate"]
        comparison.append(row)

    # situation table = the client's own value bands, verified against history
    def bucket(label, pred):
        sub = [(s, r) for (s, r) in chosen if pred(s, r)]
        agg = _aggregate([r for (_, r) in sub])
        return {"label": label, "spots": agg["spots"],
                "winRate": agg["winRate"], "pnl": agg["pnl"],
                "comebackRate": comeback_rate(sub)["rate"]}

    by_situation = [
        bucket("Down 1 · entry ≤20¢ (Strong value)",
               lambda s, r: s["deficit"] == 1 and r["entry"] <= 20),
        bucket("Down 1 · 21–25¢ (Decent)",
               lambda s, r: s["deficit"] == 1 and 20 < r["entry"] <= 25),
        bucket("Down 1 · 26–30¢ (Marginal)",
               lambda s, r: s["deficit"] == 1 and 25 < r["entry"] <= 30),
        bucket("Down 1 · ≥31¢ (No edge)",
               lambda s, r: s["deficit"] == 1 and r["entry"] > 30),
        bucket("Tied · entry ≤50¢ (Strong value)",
               lambda s, r: s["deficit"] == 0 and r["entry"] <= 50),
        bucket("Tied · 51–55¢ (Decent)",
               lambda s, r: s["deficit"] == 0 and 50 < r["entry"] <= 55),
        bucket("Tied · 56–60¢ (Marginal)",
               lambda s, r: s["deficit"] == 0 and 55 < r["entry"] <= 60),
        bucket("Tied · ≥61¢ (No edge)",
               lambda s, r: s["deficit"] == 0 and r["entry"] > 60),
        bucket("Inning 8 exactly", lambda s, r: s["inning"] == 8),
        bucket("Inning 9+", lambda s, r: s["inning"] >= 9),
    ]
    by_situation = [b for b in by_situation if b["spots"] > 0]

    seg = {
        "gold": {k: v for k, v in _aggregate([r for r in results if r["gold"]]).items()
                 if k != "equity"},
        "silver": {k: v for k, v in _aggregate([r for r in results if not r["gold"]]).items()
                   if k != "equity"},
    }
    return {
        **overall,
        "comebackRate": cb["rate"], "comebackWon": cb["won"],
        "comebackDecided": cb["decided"],
        "bySituation": by_situation,
        "comparison": comparison,
        "segments": seg,
        "gatedSpots": len(chosen),
        "staleEntries": sum(1 for s in spots if _stale(s)),
    }


def run(params: dict) -> dict:
    if params.get("kind") == "comeback_replay":
        return run_comeback(params)
    return run_checklist(params)


def run_checklist(params: dict) -> dict:
    spots = store.all_spots(params.get("corpus", {}).get("segment", "both"))
    w = params["weights"]
    cap = round(sum(w.values()), 1)

    gated, results_by_score = [], []
    for s in spots:
        base = _simulate(s, params)
        if base is None:
            continue
        score, unknown = _band_points(s, w)
        gated.append((s, base, round(score, 2), unknown))

    use_score = params.get("useScore", True)
    min_score = params.get("minScore", 0)
    chosen = [(s, r, sc, u) for (s, r, sc, u) in gated
              if not use_score or sc >= min_score]
    results = [r for (_, r, _, _) in chosen]

    # rules-only vs score-threshold sweep — the spec's first deliverable
    comparison = [{"label": "Hard rules only (no score)",
                   **{k: v for k, v in _aggregate([r for (_, r, _, _) in gated]).items()
                      if k != "equity"}}]
    for cut in (5, 6, 7, 8):
        subset = [r for (_, r, sc, _) in gated if sc >= cut]
        comparison.append({"label": f"Score ≥ {cut} / {cap}",
                           **{k: v for k, v in _aggregate(subset).items() if k != "equity"}})

    # situation table over the CHOSEN variant
    def bucket(label, pred):
        subset = [r for (s, r, sc, _) in chosen if pred(s, sc)]
        agg = _aggregate(subset)
        return {"label": label, "spots": agg["spots"],
                "winRate": agg["winRate"], "pnl": agg["pnl"]}

    by_situation = [
        bucket("Trailing team at HOME", lambda s, sc: s["trailing_is_home"]),
        bucket("Trailing team AWAY", lambda s, sc: not s["trailing_is_home"]),
        bucket("Trailing by 1 run", lambda s, sc: s["deficit"] == 1),
        bucket("Trailing by 2 runs", lambda s, sc: s["deficit"] == 2),
        bucket("Trailing by 3 runs", lambda s, sc: s["deficit"] == 3),
        bucket("6+ innings left", lambda s, sc: s["innings_left"] >= 6),
        bucket(f"Score ≥ 8 / {cap}", lambda s, sc: sc >= 8),
        bucket("Top of the order due up",
               lambda s, sc: (s["factors"].get("due_up_index") or 9) <= 3),
    ]
    by_situation = [b for b in by_situation if b["spots"] > 0]

    overall = _aggregate(results)
    seg = {
        "gold": {k: v for k, v in _aggregate([r for r in results if r["gold"]]).items()
                 if k != "equity"},
        "silver": {k: v for k, v in _aggregate([r for r in results if not r["gold"]]).items()
                   if k != "equity"},
    }
    unknown_counts: dict[str, int] = {}
    for (_, _, _, u) in chosen:
        for k in u:
            unknown_counts[k] = unknown_counts.get(k, 0) + 1

    return {
        **overall,
        "scoreCap": cap,
        "bySituation": by_situation,
        "comparison": comparison,
        "segments": seg,
        "factorUnknowns": unknown_counts,
        "gatedSpots": len(gated),
        "staleEntries": sum(1 for s in spots if _stale(s)),
    }
