"""Genera el calendario (docs/achiperros.ics), el detalle de partidos y las estadísticas de ACHIPERROS FC."""
import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

import google_sync
import stats

TEAM_ID = 2538202
TEAM_NAME = "ACHIPERROS FC"
BASE = "https://www.competize.com/es"
TEAM_URL = f"{BASE}/team/view/{TEAM_ID}-achiperros-fc"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
DURATION = timedelta(hours=1)
ALARM_BEFORE = "-PT1H"

ROOT = Path(__file__).parent
CACHE_FILE = ROOT / "competitions_cache.json"
DETAILS_FILE = ROOT / "docs" / "matches.json"
OUT_FILE = ROOT / "docs" / "achiperros.ics"
STATS_FILE = ROOT / "docs" / "stats.json"

MONTHS = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
          "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}


def season_start(today: date) -> date:
    """La temporada arranca en agosto: 26/27 = desde 1-ago-2026."""
    year = today.year if today.month >= 8 else today.year - 1
    return date(year, 8, 1)


def parse_date(text: str):
    """'30 Sep 26,  22:15' -> datetime (hora local de Madrid)."""
    m = re.match(r"(\d{1,2})\s+(\w{3})\w*\s+(\d{2,4}),?\s+(\d{1,2}):(\d{2})", text.strip())
    if not m:
        return None
    d, mon, y, hh, mm = m.groups()
    y = int(y) + (2000 if len(y) == 2 else 0)
    return datetime(y, MONTHS[mon.lower()], int(d), int(hh), int(mm))


class BlockedByCompetize(RuntimeError):
    """Competize ha respondido con su desafío anti-bots (AWS WAF)."""


def _check_blocked(r: requests.Response) -> None:
    if r.headers.get("x-amzn-waf-action") or (r.status_code == 202 and not r.content):
        raise BlockedByCompetize(f"Competize bloquea el acceso automático (HTTP {r.status_code}, "
                                 f"waf={r.headers.get('x-amzn-waf-action', '-')})")


def fetch_fixtures(session: requests.Session, team_id: int | str = TEAM_ID) -> str:
    """Historial completo de partidos de un equipo (pestaña «Partidos» de Competize)."""
    team_url = f"{BASE}/team/view/{team_id}"
    if not any("csrf" in c.name for c in session.cookies):
        first = session.get(TEAM_URL, timeout=30)
        _check_blocked(first)
        first.raise_for_status()
    token = next((c.value for c in session.cookies if "csrf" in c.name), None)
    if not token:
        raise RuntimeError("No se encontró la cookie CSRF de Competize")
    r = session.post(
        f"{BASE}/team/loadFixturesTab",
        data={"csrf_token_competize_production": token, "team": team_id,
              "idEvent": 0, "idOrganiser": 0, "idSeason": 0},
        headers={"X-Requested-With": "XMLHttpRequest", "Referer": team_url},
        timeout=30,
    )
    r.raise_for_status()
    return r.text


def parse_matches(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    matches = []
    for rnd in soup.select(".matches-round"):
        title = rnd.select_one(".matches-round-title")
        matchday = title.get_text(strip=True) if title else ""
        for card in rnd.select(".match-round"):
            link = card.select_one("a.link-encapsulated")
            date_el = card.select_one(".info-date")
            if not link or not date_el:
                continue
            start = parse_date(date_el.get_text())
            if not start:
                continue
            names = [n.get_text(strip=True) for n in card.select(".match-round-team-name span")]
            if len(names) < 2:
                continue
            score = [s.get_text(strip=True) for s in card.select(".match-round-scoreboard span")]
            score = [s for s in score if s]
            group = card.select_one(".info-group")
            venue = card.select_one(".match-round-venue")
            matches.append({
                "id": re.search(r"/(\d+)$", link["href"]).group(1),
                "url": link["href"],
                "start": start,
                "matchday": matchday,
                "group": group.get_text(strip=True) if group else "",
                "home": names[0],
                "away": names[1],
                "score": score if len(score) == 2 else None,
                "venue": venue.get_text(strip=True) if venue else "",
            })
    return matches


def _players(side) -> list[dict]:
    """Jugadores de un equipo con sus estadísticas ({'Gol': 2, 'Tarjeta Amarilla': 1, ...})."""
    players = []
    for td in side.select("td.match-player-name, td.match-player-name-right") if side else []:
        label = td.a.get_text(" ", strip=True).replace("\xa0", " ").strip()
        num, _, name = label.partition(". ")
        stats, count = {}, 1
        div = td.find("div")
        for node in div.children if div else []:
            if getattr(node, "name", None) == "img" and node.get("alt"):
                stats[node["alt"]] = stats.get(node["alt"], 0) + count
                count = 1
            elif isinstance(node, str) and (c := re.search(r"(\d+)\s*x", node)):
                count = int(c.group(1))
        players.append({"num": num if name else "", "name": name or label, "stats": stats})
    return players


def match_details(session: requests.Session, match: dict) -> dict:
    """Árbitro, alineaciones con goles/tarjetas/MVP y crónica de un partido jugado."""
    view = session.get(match["url"], timeout=30).text
    ref = re.search(r"rbitro Principal</div>([^<]*)<", view)
    token = next((c.value for c in session.cookies if "csrf" in c.name), "")
    r = session.post(f"{BASE}/matches/loadMatchFacts/{match['id']}",
                     data={"csrf_token_competize_production": token},
                     headers={"X-Requested-With": "XMLHttpRequest", "Referer": match["url"]}, timeout=30)
    r.raise_for_status()
    facts = r.json()
    lineup = BeautifulSoup(facts.get("lineupPage", ""), "html.parser")
    report = BeautifulSoup(facts.get("reportPage", ""), "html.parser").get_text("\n", strip=True)
    return {
        "referee": " ".join(ref.group(1).split()) if ref else "",
        "home": _players(lineup.select_one(".table-stats-players-home")),
        "away": _players(lineup.select_one(".table-stats-players-away")),
        "report": report,
        "fetched": date.today().isoformat(),
    }


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,").replace("\n", r"\n")


def fold(line: str) -> str:
    """Pliega líneas a 75 octetos (RFC 5545)."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode()) > 74:
            out.append(cur)
            cur = " " + ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n".join(out)


VTIMEZONE = """BEGIN:VTIMEZONE
TZID:Europe/Madrid
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE""".splitlines()


def to_event(m: dict) -> dict:
    """Datos comunes del evento para el .ics y para Google Calendar."""
    if m["score"]:
        summary = f"⚽ {m['home']} {m['score'][0]}-{m['score'][1]} {m['away']}"
    else:
        summary = f"⚽ {m['home']} vs {m['away']}"
    desc = "\n".join(filter(None, [
        m["competition"], " - ".join(filter(None, [m["matchday"], m["group"]])), m["url"]]))
    return {"id": m["id"], "summary": summary, "description": desc, "location": m["venue"],
            "url": m["url"], "start": m["start"], "end": m["start"] + DURATION}


def build_ics(events: list[dict]) -> str:
    fmt = "%Y%m%dT%H%M%S"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//achiperros-calendario//ES",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Achiperros FC",
             "X-WR-TIMEZONE:Europe/Madrid", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
             "X-PUBLISHED-TTL:PT1H", *VTIMEZONE]
    for e in sorted(events, key=lambda x: x["start"]):
        summary, desc = e["summary"], e["description"]
        # DTSTAMP estable (hash del contenido) para que el fichero solo cambie si cambia algo real
        stamp = datetime(2026, 1, 1) + timedelta(
            seconds=int(hashlib.sha1((summary + desc + e["start"].isoformat()).encode()).hexdigest()[:6], 16))
        lines += [
            "BEGIN:VEVENT",
            f"UID:competize-match-{e['id']}@achiperros",
            f"DTSTAMP:{stamp.strftime(fmt)}Z",
            f"DTSTART;TZID=Europe/Madrid:{e['start'].strftime(fmt)}",
            f"DTEND;TZID=Europe/Madrid:{e['end'].strftime(fmt)}",
            f"SUMMARY:{esc(summary)}",
            f"LOCATION:{esc(e['location'])}",
            f"DESCRIPTION:{esc(desc)}",
            f"URL:{e['url']}",
            "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc(summary)}",
            f"TRIGGER:{ALARM_BEFORE}", "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"


def main():
    session = requests.Session()
    session.headers["User-Agent"] = UA
    since = season_start(date.today())

    all_matches = [m for m in parse_matches(fetch_fixtures(session)) if TEAM_NAME in (m["home"], m["away"])]
    matches = [m for m in all_matches if m["start"].date() >= since]

    cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}
    for m in matches:
        if not isinstance(cache.get(m["id"]), dict) or not cache[m["id"]].get("url"):
            cache[m["id"]] = stats.competition_info(session, m["url"])
        info = cache[m["id"]]
        m["competition"], m["competition_url"], m["competition_id"] = info["name"], info["url"], info["id"]
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")

    # Detalle de partidos jugados (goles, tarjetas...). Se refresca durante 14 días tras el partido,
    # porque el organizador a veces mete las estadísticas con retraso.
    details = json.loads(DETAILS_FILE.read_text(encoding="utf-8")) if DETAILS_FILE.exists() else {}
    recent = date.today() - timedelta(days=14)
    for m in matches:
        if m["score"] and (m["id"] not in details or m["start"].date() >= recent):
            try:
                details[m["id"]] = match_details(session, m)
            except Exception as exc:  # un fallo aquí no debe tumbar el calendario
                print(f"Aviso: sin detalle para {m['id']}: {exc}")
    details = {k: v for k, v in details.items() if k in {m["id"] for m in matches}}
    DETAILS_FILE.write_text(json.dumps(details, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")

    OUT_FILE.parent.mkdir(exist_ok=True)
    events = [to_event(m) for m in matches]
    OUT_FILE.write_bytes(build_ics(events).encode("utf-8"))
    for m in sorted(matches, key=lambda x: x["start"]):
        print(m["start"].strftime("%a %d/%m %H:%M"), "|", m["competition"], "|", m["matchday"],
              "|", m["home"], "vs", m["away"], "|", m["score"] or "")
    print(f"{len(matches)} partidos desde {since} -> {OUT_FILE}")

    # Clasificaciones, rankings, sanciones, estadísticas y ficha del rival (no debe tumbar el calendario)
    try:
        data = stats.build(session, TEAM_NAME, TEAM_ID, matches, all_matches, details,
                           fetch_fixtures, parse_matches, since)
        STATS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Estadísticas: {len(data['competitions'])} competiciones, {len(data['players'])} jugadores, "
              f"rival: {(data['next_rival'] or {}).get('name', '-')}")
    except Exception as exc:
        print(f"Aviso: sin estadísticas: {exc}")

    google_sync.sync(events, datetime.combine(since, datetime.min.time()))


if __name__ == "__main__":
    try:
        main()
    except BlockedByCompetize as exc:
        # No es un fallo nuestro: se conserva la última versión publicada y el job no sale en rojo.
        print(f"AVISO: {exc}. Se mantiene la última versión del calendario y de la web.")
