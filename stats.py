"""Genera docs/stats.json: clasificaciones, rankings, sanciones, estadísticas del equipo y ficha del rival."""
import json
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE = "https://www.competize.com/es"
try:
    MADRID = ZoneInfo("Europe/Madrid")
except Exception:  # sin base de zonas horarias: aproximación con CEST
    from datetime import timezone, timedelta
    MADRID = timezone(timedelta(hours=2))

# Ranking de la competición que guardamos (clave de Competize -> nombre en stats.json)
RANKINGS = {"scorers": "goleadores", "keepers": "porteros", "mvps": "mvp", "fairplay": "fairplay"}


def _txt(node) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _int(s: str):
    try:
        return int(s)
    except (TypeError, ValueError):
        return s


def _token(session: requests.Session) -> str:
    return next((c.value for c in session.cookies if "csrf" in c.name), "")


def _ajax(session: requests.Session, url: str, referer: str, **data) -> requests.Response:
    r = session.post(url, data={"csrf_token_competize_production": _token(session), **data},
                     headers={"X-Requested-With": "XMLHttpRequest", "Referer": referer}, timeout=30)
    r.raise_for_status()
    return r


def competition_info(session: requests.Session, match_url: str) -> dict:
    """Nombre y URL de la competición a la que pertenece un partido."""
    html = session.get(match_url, timeout=30).text
    m = re.search(r"(https://www\.competize\.com/es/competition/view/(\d+)[^'\"/]*)/results'>([^<]+)</a>", html)
    if not m:
        return {"name": "", "url": "", "id": ""}
    return {"name": m.group(3).strip(), "url": m.group(1), "id": m.group(2)}


def _standings(soup: BeautifulSoup) -> list[dict]:
    sec = soup.select_one("#competition-section-standings")
    rows = []
    for tr in sec.select("table.standings-table tbody tr") if sec else []:
        cells = [_txt(td) for td in tr.find_all("td")]
        if len(cells) < 10:
            continue
        link = tr.find("a", href=re.compile(r"team/view/\d+"))
        rows.append({
            "pos": _int(cells[0]), "team": cells[1],
            "team_id": re.search(r"team/view/(\d+)", link["href"]).group(1) if link else "",
            "j": _int(cells[2]), "g": _int(cells[3]), "e": _int(cells[4]), "p": _int(cells[5]),
            "gf": _int(cells[6]), "gc": _int(cells[7]), "dg": _int(cells[8]), "pts": _int(cells[9]),
        })
    return rows


def _sanctions(soup: BeautifulSoup) -> list[dict]:
    out = []
    for rnd in soup.select("#competition-section-punishments .punishments-round"):
        round_name = _txt(rnd.select_one(".punishments-round-title"))
        for it in rnd.select(".punishments-round-content-item"):
            msg = it.select_one(".punishment-message")
            links = msg.find_all("a") if msg else []
            match_link = next((a for a in links if "matches/view" in a.get("href", "")), None)
            player_link = next((a for a in links if "profile/view" in a.get("href", "")), None)
            out.append({
                "round": round_name,
                "date": _txt(it.select_one(".punishment-date")),
                "type": _txt(it.select_one(".punishment-type")),
                "player": _txt(player_link),
                "match": _txt(match_link),
                "text": _txt(msg),
            })
    return out


def _rankings(session: requests.Session, comp: dict) -> dict:
    data = _ajax(session, f"{BASE}/competition/loadFullRankings/{comp['id']}", comp["url"]).json()
    raw = data.get("rankings", {})
    out = {}
    for key, name in RANKINGS.items():
        soup = BeautifulSoup(raw.get(key, "") or "", "html.parser")
        table = soup.select_one("table")
        if not table:
            continue
        head = [_txt(th) for th in table.select("th")]
        rows = []
        for tr in table.select("tr"):
            cells = [_txt(td) for td in tr.find_all("td")]
            if len(cells) == len(head) and cells[0].isdigit():
                rows.append({h: _int(c) for h, c in zip(head, cells)})
        out[name] = {"columns": head, "rows": rows}
    return out


def competition_data(session: requests.Session, comp: dict) -> dict:
    soup = BeautifulSoup(session.get(comp["url"], timeout=30).text, "html.parser")
    data = {**comp, "standings": _standings(soup), "sanctions": _sanctions(soup)}
    try:
        data["rankings"] = _rankings(session, comp)
    except Exception as exc:
        print(f"Aviso: sin rankings para {comp['name']}: {exc}")
        data["rankings"] = {}
    return data


def team_stats(team: str, matches: list[dict], details: dict) -> list[dict]:
    """Totales por jugador de la temporada, a partir de las actas de cada partido jugado."""
    players: dict[str, dict] = {}
    for m in matches:
        d = details.get(m["id"])
        if not d or not m["score"]:
            continue
        side = "home" if m["home"] == team else "away"
        for p in d[side]:
            st = p["stats"]
            row = players.setdefault(p["name"], {
                "name": p["name"], "num": p["num"], "pj": 0, "goles": 0, "mvp": 0, "asist": 0,
                "amarillas": 0, "rojas": 0, "azules": 0, "por_competicion": {}})
            row["num"] = p["num"] or row["num"]
            row["pj"] += 1
            row["goles"] += st.get("Gol", 0)
            row["mvp"] += st.get("MVP", 0)
            row["asist"] += st.get("Asistencia", 0)
            row["amarillas"] += st.get("Tarjeta Amarilla", 0)
            row["rojas"] += st.get("Tarjeta Roja", 0)
            row["azules"] += st.get("Tarjeta Azul", 0)
            pc = row["por_competicion"].setdefault(m["competition"], {"pj": 0, "goles": 0, "amarillas": 0, "rojas": 0})
            pc["pj"] += 1
            pc["goles"] += st.get("Gol", 0)
            pc["amarillas"] += st.get("Tarjeta Amarilla", 0)
            pc["rojas"] += st.get("Tarjeta Roja", 0)
    return sorted(players.values(), key=lambda r: (-r["goles"], -r["mvp"], -r["pj"], r["name"]))


def _brief(m: dict, team: str) -> dict:
    """Partido resumido desde el punto de vista de `team`."""
    home = m["home"] == team
    res = ""
    if m["score"]:
        a, b = (int(m["score"][0]), int(m["score"][1])) if home else (int(m["score"][1]), int(m["score"][0]))
        res = "V" if a > b else "D" if a < b else "E"
    return {"date": m["start"].isoformat(), "home": m["home"], "away": m["away"],
            "score": m["score"], "result": res, "url": m["url"]}


def rival_card(session, fetch_team_fixtures, parse_matches, team: str, next_match: dict,
               all_matches: list[dict], competitions: list[dict], since: date) -> dict:
    """Ficha del próximo rival: clasificación, últimos resultados, goleadores, sanciones y cara a cara."""
    rival = next_match["away"] if next_match["home"] == team else next_match["home"]
    comp = next((c for c in competitions if c["name"] == next_match["competition"]), None)
    card = {"name": rival, "match_id": next_match["id"], "competition": next_match["competition"],
            "date": next_match["start"].isoformat(), "venue": next_match["venue"],
            "home": next_match["home"] == team, "url": next_match["url"],
            "matchday": next_match["matchday"]}

    if comp:
        card["standing"] = next((r for r in comp["standings"] if r["team"] == rival), None)
        card["rival_id"] = (card["standing"] or {}).get("team_id", "")
        scorers = comp.get("rankings", {}).get("goleadores", {}).get("rows", [])
        card["top_scorers"] = [r for r in scorers if r.get("Equipo") == rival][:3]
        card["sanctions"] = [s for s in comp["sanctions"] if rival in s["match"]]

    if not card.get("rival_id"):
        view = session.get(next_match["url"], timeout=30).text
        ids = [i for i in re.findall(r"team/view/(\d+)", view) if i != str(next_match.get("team_id", ""))]
        card["rival_id"] = next((i for i in ids), "")

    if card.get("rival_id"):
        try:
            theirs = parse_matches(fetch_team_fixtures(session, card["rival_id"]))
            played = sorted((m for m in theirs if m["score"] and m["start"].date() >= since),
                            key=lambda m: m["start"], reverse=True)
            card["last_results"] = [_brief(m, rival) for m in played[:5]]
        except Exception as exc:
            print(f"Aviso: sin partidos del rival {rival}: {exc}")

    h2h = sorted((m for m in all_matches if rival in (m["home"], m["away"]) and m["score"]),
                 key=lambda m: m["start"], reverse=True)
    card["head_to_head"] = [_brief(m, team) for m in h2h]
    return card


def build(session, team: str, team_id: int, season_matches: list[dict], all_matches: list[dict],
          details: dict, fetch_team_fixtures, parse_matches, since: date) -> dict:
    comps = {}
    for m in season_matches:
        if m.get("competition_url"):
            comps[m["competition_url"]] = {"name": m["competition"], "url": m["competition_url"],
                                           "id": m["competition_id"]}
    competitions = []
    for c in comps.values():
        try:
            competitions.append(competition_data(session, c))
        except Exception as exc:
            print(f"Aviso: sin datos de {c['name']}: {exc}")

    upcoming = sorted((m for m in season_matches if not m["score"] and m["start"] >= datetime.now(MADRID).replace(tzinfo=None)),
                      key=lambda m: m["start"])
    rival = None
    if upcoming:
        try:
            nxt = {**upcoming[0], "team_id": team_id}
            rival = rival_card(session, fetch_team_fixtures, parse_matches, team, nxt,
                               all_matches, competitions, since)
        except Exception as exc:
            print(f"Aviso: sin ficha del rival: {exc}")

    return {
        "updated": datetime.now(MADRID).isoformat(timespec="minutes"),
        "competitions": competitions,
        "players": team_stats(team, season_matches, details),
        "next_rival": rival,
    }
