"""Comeback Setup: tag + alert when a tired reliever protects a 1-run (or
tied) lead late, per the client's Aug 13 spec.

  store.py     triggers (logged forever, ack-able) + editable config
  pitchers.py  gameLog cache + the three fatigue checks
  detector.py  pitching-change tracking over the existing 3s live cache
  api.py       /api/comeback (active, ack, config, log)

Wired in scheduler.py (a 10s job — reads the in-process cache, costs no
upstream request) and main.py (router + store.init()). Deliberately does NOT
use GUMBO /feed/live: the 3KB linescore names the incoming reliever during
the inning break, minutes before the boxscore counter, and the heavy feed is
the one endpoint this app never calls (V2 house rule).
"""
