"""The daily sweep: Oracle stats in, scorecards out.

Flow, once a day plus a catch-up on boot:
  1. every ACTIVE tournament across all leagues (one directory call)
  2. one team-stats call each -> lol_team_stats
  3. for every UPCOMING LoL row in the screener, match both team names to a
     tournament and store the scorecard

Freezing: a match that has started keeps the scorecard it had at kickoff. The
inputs are split-season aggregates, so nothing about a live game changes them
anyway — but the split itself moves as more games are played, and a number
that silently changes under the client is the exact thing he asked us to stop
doing on the baseball verdict.
"""
import logging
from datetime import datetime, timezone

from backend.database.db import get_db
from backend.lol import client, score as scoring, store

log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def upcoming_lol_matches() -> list[dict]:
    """LoL rows the screener holds: kickoff in the future, or within the last
    12h (a series still being played)."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT event_slug, home_team, away_team, kickoff
               FROM screener_cache
               WHERE sport = 'esports' AND league = 'LoL'
                 AND kickoff IS NOT NULL
                 AND kickoff >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-12 hours')
               ORDER BY kickoff""").fetchall()
    return [dict(r) for r in rows]


def _pick_pair(home: str, away: str):
    """Both teams' stats from the SAME tournament when possible.

    A team can appear in several active tournaments (a split and its
    playoffs); the pair that shares a tournament is the real matchup, so a
    shared one wins and freshness only breaks ties.
    """
    hs, aws = store.lookup_team(home), store.lookup_team(away)
    if not hs or not aws:
        return None
    by_tourn = {a["tournament_id"]: a for a in aws}
    for h in hs:                      # freshest home rows first
        a = by_tourn.get(h["tournament_id"])
        if a:
            return h, a
    return None


async def refresh_stats() -> dict:
    """Pull every active tournament's team table. ~18 requests."""
    tournaments = await client.active_tournaments()
    teams = 0
    for t in tournaments:
        tid = t.get("id")
        if not tid:
            continue
        try:
            rows = await client.team_stats(tid)
        except Exception as e:                      # noqa: BLE001
            log.warning("lol stats: %s failed: %s", tid, e)
            continue
        teams += store.save_team_stats(tid, t.get("mostRecentGame"), rows)
    log.info("lol stats: %d tournaments, %d team rows", len(tournaments), teams)
    return {"tournaments": len(tournaments), "teams": teams}


def rebuild_scores() -> dict:
    """Score every upcoming/live LoL match from the stored stats."""
    frozen = store.frozen_slugs()
    now = _now()
    scored = skipped = froze = 0
    for m in upcoming_lol_matches():
        slug = m["event_slug"]
        started = bool(m["kickoff"]) and m["kickoff"] <= now
        if slug in frozen:
            continue                                # already final
        pair = _pick_pair(m["home_team"], m["away_team"])
        if not pair:
            skipped += 1
            continue
        h, a = pair
        card = scoring.scorecard(h["stats"], a["stats"])
        card.update({
            "homeTeam": m["home_team"], "awayTeam": m["away_team"],
            "homeOracle": h["team"], "awayOracle": a["team"],
            "homePoints": card.pop("aPoints"), "awayPoints": card.pop("bPoints"),
            "homeRecord": card.pop("aRecord"), "awayRecord": card.pop("bRecord"),
            "homeGames": card.pop("aGames"), "awayGames": card.pop("bGames"),
            "pickSide": {"a": "home", "b": "away"}.get(card.pop("pick")),
            "tournament": h["tournament_id"],
            "kickoff": m["kickoff"],
        })
        store.save_score(slug, m["kickoff"], started, card)
        scored += 1
        froze += 1 if started else 0
    log.info("lol scores: %d scored (%d frozen at kickoff), %d unmatched",
             scored, froze, skipped)
    return {"scored": scored, "frozen": froze, "unmatched": skipped}


async def run() -> dict:
    """One full pass — the scheduled job."""
    stats = await refresh_stats()
    return {**stats, **rebuild_scores()}
