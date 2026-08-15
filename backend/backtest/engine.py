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
            "entry": fill_mid, "exit": round(exit_exec, 2)}


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


def run_comeback(params: dict, include_trades: bool = False) -> dict:
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
    out = {
        **overall,
        "comebackRate": cb["rate"], "comebackWon": cb["won"],
        "comebackDecided": cb["decided"],
        "bySituation": by_situation,
        "comparison": comparison,
        "segments": seg,
        "gatedSpots": len(chosen),
        "staleEntries": sum(1 for s in spots if _stale(s)),
        "comparisonTitle": "One knob at a time — fatigue filter and minimum inning",
    }
    if include_trades:
        matchups = store.market_matchups()
        out["trades"] = [{
            "time_utc": s["ts"], "game": matchups.get(s["market_id"], ""),
            "inning": s["inning"], "next_half": s["next_half"],
            "trailing_side": s["trailing_side"], "deficit": s["deficit"],
            "entry_cents": r["entry"], "exit_cents": r["exit"],
            "won": r["win"], "bounce_cents": r["bounce"],
            "hold_half_innings": r["hold"], "fee_usd": r["fee"],
            "pnl_usd": r["pnl"], "data": "gold" if r["gold"] else "silver",
            "comeback_completed": settlements.get(s["market_id"]),
        } for (s, r) in chosen]
    return out


# ---- the Clear Favorite replay (locked T-5 verdicts, held to settlement) --

def run_favorite(params: dict, include_trades: bool = False) -> dict:
    """Replay the verdicts exactly as locked before first pitch. Thresholds
    are re-applied over the stored payloads — both sides' full breakdowns are
    in every lock, so lowering the bar to 65 re-scores the same history. A
    winner exits by redemption, which is fee-free (V3 rule); fees and
    slippage therefore hit the entry leg only."""
    f, ex, stake = params["filter"], params["exec"], params["stake"]
    segment = params.get("corpus", {}).get("segment", "both")
    source = f.get("source", "both")
    locks = store.favorite_locks() + store.fav_history_rows()
    if source != "both":
        locks = [L for L in locks if L["source"] == source]
    settlements = store.home_settlements()

    def evaluate(min_total=None, min_price=None, require_disq=None):
        mt = f["minTotal"] if min_total is None else min_total
        mp = f["minPriceCents"] if min_price is None else min_price
        rd = f["requireNoDisqualifiers"] if require_disq is None else require_disq
        results, untracked, unsettled = [], 0, 0
        for L in locks:
            if L["market_id"] is None:
                untracked += 1
                continue
            v = L["verdict"]
            # market_id 0 = a game outside the tick corpus: prices came from
            # CLOB's settled 10-min bars, the outcome from MLB's final — the
            # score itself never needed ticks. Gold/silver describes tick
            # density, so these only ride under segment "both".
            outside = not L["market_id"]
            if outside and segment != "both":
                continue
            if not outside:
                if segment == "gold" and not L["gold"]:
                    continue
                if segment == "silver" and L["gold"]:
                    continue
            best = None
            for side in ("away", "home"):
                s = v.get(side) or {}
                total = s.get("total") or 0
                if total < mt:
                    continue
                # the stored "price below 59c" disqualifier encodes the OLD
                # bar; price is re-checked against the params below, so only
                # the non-price disqualifiers can still kill a side
                disq = [d for d in (s.get("disqualifiers") or [])
                        if "price below" not in d]
                if rd and disq:
                    continue
                if len(s.get("flags") or []) > int(f["maxFlags"]):
                    continue
                oid = (L["home_outcome_id"] if side == "home"
                       else L["away_outcome_id"])
                if oid:
                    price = store.tick_price_at(oid, L["locked_at"])
                else:   # outside the tick corpus: the stored T-5 bar price
                    price = (v.get("t5_prices") or {}).get(side)
                if price is None or not (mp <= price <= f["maxPriceCents"]):
                    continue
                if best is None or total > best["total"]:
                    best = {"side": side, "total": total, "price": price}
            if not best:
                continue
            # settlement: last pinned tick for tracked markets, MLB's own
            # final score for games outside the tick corpus
            hw = (settlements.get(L["market_id"]) if L["market_id"]
                  else v.get("home_won"))
            if hw is None:
                unsettled += 1
                continue
            won = hw if best["side"] == "home" else (not hw)
            slip = ex["slippageCentsPerSide"]
            entry_exec = best["price"] + slip
            shares = (stake["usd"] / (entry_exec / 100.0)
                      if stake["mode"] == "flat_usd" else 100.0)
            fee = (_taker_fee(entry_exec, shares)
                   if ex.get("entryFee", "taker") == "taker" else 0.0)
            pnl = shares * ((100.0 if won else 0.0) - entry_exec) / 100.0 - fee
            results.append({"win": won, "pnl": round(pnl, 2), "hold": 0,
                            "bounce": 0.0, "fee": round(fee, 2),
                            "ts": L["locked_at"], "gold": L["gold"] or 0,
                            "entry": best["price"], "side": best["side"],
                            "total": best["total"], "source": L["source"],
                            "outside": outside,
                            "game": f"{v.get('away_name')} @ {v.get('home_name')}",
                            "team": v.get(f"{best['side']}_name"),
                            "price_source": ("own_ticks" if not outside
                                             else v.get("price_source", "none"))})
        return results, untracked, unsettled

    results, untracked, unsettled = evaluate()
    overall = _aggregate(results)

    comparison = []
    for label, kwargs in (
        ("Saved thresholds", {}),
        ("Score bar 65", {"min_total": 65}),
        ("Score bar 70", {"min_total": 70}),
        ("Score bar 75", {"min_total": 75}),
        ("Score bar 80", {"min_total": 80}),
        ("Price floor 55¢", {"min_price": 55}),
        ("Price floor 65¢", {"min_price": 65}),
        ("Disqualifiers ignored", {"require_disq": False}),
    ):
        sub, _, _ = evaluate(**kwargs)
        agg = _aggregate(sub)
        comparison.append({"label": label,
                           **{k: v for k, v in agg.items() if k != "equity"}})

    def bucket(label, pred):
        sub = [r for r in results if pred(r)]
        agg = _aggregate(sub)
        return {"label": label, "spots": agg["spots"],
                "winRate": agg["winRate"], "pnl": agg["pnl"]}

    by_situation = [b for b in (
        bucket("Entry 59–65¢", lambda r: 59 <= r["entry"] <= 65),
        bucket("Entry 65–72¢", lambda r: 65 < r["entry"] <= 72),
        bucket("Entry 72¢+", lambda r: r["entry"] > 72),
        bucket("Favorite is the HOME side", lambda r: r["side"] == "home"),
        bucket("Favorite is the AWAY side", lambda r: r["side"] == "away"),
        bucket("Score 75–80", lambda r: 75 <= r["total"] < 80),
        bucket("Score 80+", lambda r: r["total"] >= 80),
        bucket("Locked (real T-5 snapshots)", lambda r: r["source"] == "locked"),
        bucket("Reconstructed (historical, approximations flagged)",
               lambda r: r["source"] == "reconstructed"),
        bucket("Tick-tracked games (exact T-5 prices)", lambda r: not r["outside"]),
        bucket("Untracked games (settled market history)",
               lambda r: r["outside"]),
    ) if b["spots"] > 0]

    seg = {   # tick-density labels — only meaningful for tick-corpus games
        "gold": {k: v for k, v in _aggregate(
            [r for r in results if not r["outside"] and r["gold"]]).items()
            if k != "equity"},
        "silver": {k: v for k, v in _aggregate(
            [r for r in results if not r["outside"] and not r["gold"]]).items()
            if k != "equity"},
    }
    avg_entry = (sum(r["entry"] for r in results) / len(results)) if results else None
    trades = [{
        "locked_at_utc": r["ts"], "game": r["game"], "bet_on": r["team"],
        "side": r["side"], "score_total": r["total"],
        "entry_cents": r["entry"], "won": r["win"], "fee_usd": r["fee"],
        "pnl_usd": r["pnl"], "verdict_source": r["source"],
        "price_source": r["price_source"],
    } for r in results] if include_trades else None
    return {
        **({"trades": trades} if trades is not None else {}),
        **overall,
        "comparisonTitle": "Thresholds one at a time — score bar, price floor, disqualifiers",
        "bySituation": by_situation,
        "comparison": comparison,
        "segments": seg,
        "lockedGames": sum(1 for L in locks if L["source"] == "locked"),
        "reconstructedGames": sum(1 for L in locks if L["source"] == "reconstructed"),
        # games covered WITHOUT tick data — the whole point of this strategy
        "outsideTickCorpus": sum(1 for L in locks if L["market_id"] == 0),
        "untrackedLocks": untracked,
        "unsettled": unsettled,
        "avgEntryCents": round(avg_entry, 1) if avg_entry is not None else None,
        # the number a hold-to-win bet must beat: its own price
        "impliedWinRate": round(avg_entry / 100.0, 4) if avg_entry is not None else None,
    }


def run(params: dict, include_trades: bool = False) -> dict:
    if params.get("kind") == "comeback_replay":
        return run_comeback(params, include_trades)
    if params.get("kind") == "favorite_replay":
        return run_favorite(params, include_trades)
    return run_checklist(params, include_trades)


def run_checklist(params: dict, include_trades: bool = False) -> dict:
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

    out = {
        **overall,
        "scoreCap": cap,
        "bySituation": by_situation,
        "comparison": comparison,
        "segments": seg,
        "factorUnknowns": unknown_counts,
        "gatedSpots": len(gated),
        "staleEntries": sum(1 for s in spots if _stale(s)),
    }
    if include_trades:
        matchups = store.market_matchups()
        out["trades"] = [{
            "time_utc": s["ts"], "game": matchups.get(s["market_id"], ""),
            "inning": s["inning"], "next_half": s["next_half"],
            "trailing_side": s["trailing_side"], "deficit": s["deficit"],
            "score": sc, "entry_cents": r["entry"], "exit_cents": r["exit"],
            "won": r["win"], "bounce_cents": r["bounce"],
            "hold_half_innings": r["hold"], "fee_usd": r["fee"],
            "pnl_usd": r["pnl"], "data": "gold" if r["gold"] else "silver",
        } for (s, r, sc, _) in chosen]
    return out
