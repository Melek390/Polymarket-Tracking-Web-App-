"""The client's six-point team scorecard (his spec, Aug 27).

One point per metric, higher total is the pick:

  1 AGT   (average game time)  LOWEST wins the point -- but ONLY if that team
                               has a winning record. A fast team with more
                               losses than wins is losing fast, so the point
                               goes to the opponent instead.
  2 GD15  (gold diff at 15)    highest wins
  3 FT%   (first tower)        highest wins
  4 F3T%  (first three towers) highest wins
  5 FD%   (first dragon)       highest wins
  6 FBN%  (first baron)        highest wins

Every comparison is pure arithmetic over two stat rows, so the whole thing is
testable without a network call. A metric missing on either side scores for
nobody and is reported as such rather than guessed.
"""

# (key, label, higher_is_better)
METRICS = (
    ("GD15", "Gold diff @15", True),
    ("FT%", "First tower", True),
    ("F3T%", "First 3 towers", True),
    ("FD%", "First dragon", True),
    ("FBN%", "First baron", True),
)


def _num(value):
    """Oracle sends percentages as '67%' and numbers as numbers."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "").replace(",", "")
    if not text or text in ("-", "--"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _winning_record(row: dict) -> bool | None:
    w, losses = _num(row.get("W")), _num(row.get("L"))
    if w is None or losses is None:
        return None
    return w > losses


def scorecard(a: dict, b: dict) -> dict:
    """Score team A against team B. Returns the totals, the per-metric
    breakdown and which side each point went to."""
    lines, pts = [], {"a": 0, "b": 0}

    def award(side, key, label, av, bv, note=""):
        if side in pts:
            pts[side] += 1
        lines.append({"key": key, "label": label, "a": av, "b": bv,
                      "winner": side, "note": note})

    # 1. average game time, gated on the record
    a_agt, b_agt = _num(a.get("AGT")), _num(b.get("AGT"))
    a_win, b_win = _winning_record(a), _winning_record(b)
    if a_agt is None or b_agt is None or a_agt == b_agt:
        award(None, "AGT", "Avg game time", a.get("AGT"), b.get("AGT"),
              "no usable value")
    else:
        faster, slower = ("a", "b") if a_agt < b_agt else ("b", "a")
        faster_wins = a_win if faster == "a" else b_win
        if faster_wins is False:
            # losing fast is a negative, so the edge flips (the client's rule)
            award(slower, "AGT", "Avg game time", a.get("AGT"), b.get("AGT"),
                  "faster side has a losing record, so the edge flips")
        else:
            award(faster, "AGT", "Avg game time", a.get("AGT"), b.get("AGT"),
                  "lower is better")

    # 2-6. straight higher-is-better comparisons
    for key, label, _hi in METRICS:
        av, bv = _num(a.get(key)), _num(b.get(key))
        if av is None or bv is None or av == bv:
            award(None, key, label, a.get(key), b.get(key),
                  "tied" if av == bv and av is not None else "no usable value")
        else:
            award("a" if av > bv else "b", key, label, a.get(key), b.get(key))

    lead = "a" if pts["a"] > pts["b"] else "b" if pts["b"] > pts["a"] else None
    return {
        "aPoints": pts["a"], "bPoints": pts["b"], "pick": lead,
        "maxPoints": len(METRICS) + 1,
        "lines": lines,
        "aGames": _num(a.get("GP")), "bGames": _num(b.get("GP")),
        "aRecord": f"{a.get('W')}-{a.get('L')}",
        "bRecord": f"{b.get('W')}-{b.get('L')}",
    }
