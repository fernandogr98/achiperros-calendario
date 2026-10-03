"""Sincroniza los partidos con un Google Calendar público propiedad de una cuenta de servicio.

Se activa solo si existe la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON (secreto de GitHub).
El ID del calendario se guarda en docs/google_calendar.json para que la web genere el enlace.
"""
import json
import os
from datetime import datetime
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

API = "https://www.googleapis.com/calendar/v3"
TZ = "Europe/Madrid"
ID_FILE = Path(__file__).parent / "docs" / "google_calendar.json"


def _session(creds_json: str) -> requests.Session:
    creds = service_account.Credentials.from_service_account_info(
        json.loads(creds_json), scopes=["https://www.googleapis.com/auth/calendar"])
    creds.refresh(Request())
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {creds.token}"
    return s


def _check(r: requests.Response) -> dict:
    if r.status_code >= 400:
        raise RuntimeError(f"Google Calendar API {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else {}


def _calendar_id(s: requests.Session) -> str:
    if ID_FILE.exists():
        return json.loads(ID_FILE.read_text(encoding="utf-8"))["id"]
    cal = _check(s.post(f"{API}/calendars", json={
        "summary": "Achiperros FC", "timeZone": TZ,
        "description": "Partidos de ACHIPERROS FC (Competize). Se actualiza automáticamente."}))
    # Lectura pública para que cualquiera pueda añadirlo
    _check(s.post(f"{API}/calendars/{cal['id']}/acl", json={"role": "reader", "scope": {"type": "default"}}))
    ID_FILE.write_text(json.dumps({"id": cal["id"]}), encoding="utf-8")
    print(f"Calendario de Google creado: {cal['id']}")
    return cal["id"]


def _body(ev: dict) -> dict:
    fmt = "%Y-%m-%dT%H:%M:%S"
    return {
        "summary": ev["summary"],
        "location": ev["location"],
        "description": ev["description"],
        "start": {"dateTime": ev["start"].strftime(fmt), "timeZone": TZ},
        "end": {"dateTime": ev["end"].strftime(fmt), "timeZone": TZ},
        "source": {"title": "Competize", "url": ev["url"]},
        "status": "confirmed",
    }


def _same(remote: dict, body: dict) -> bool:
    if remote.get("status") != "confirmed":
        return False
    for k in ("summary", "location", "description"):
        if (remote.get(k) or "") != (body[k] or ""):
            return False
    for k in ("start", "end"):
        # Google devuelve el dateTime con offset (+02:00); comparamos solo la hora local
        if remote.get(k, {}).get("dateTime", "")[:19] != body[k]["dateTime"]:
            return False
    return True


def sync(events: list[dict], since: datetime) -> None:
    """events: dicts con id, summary, location, description, url, start, end (datetime local Madrid)."""
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not creds_json:
        print("Google Calendar: sin credenciales, se omite")
        return
    s = _session(creds_json)
    cal = _calendar_id(s)
    base = f"{API}/calendars/{requests.utils.quote(cal)}/events"

    remote, page = {}, None
    while True:
        data = _check(s.get(base, params={"showDeleted": "true", "maxResults": 2500, "pageToken": page,
                                          "timeMin": since.strftime("%Y-%m-%dT00:00:00Z")}))
        remote.update({e["id"]: e for e in data.get("items", [])})
        page = data.get("nextPageToken")
        if not page:
            break

    created = updated = deleted = 0
    wanted = set()
    for ev in events:
        eid = f"ach{ev['id']}"  # IDs de Google: solo [a-v0-9]
        wanted.add(eid)
        body = _body(ev)
        if eid in remote:
            if not _same(remote[eid], body):
                _check(s.put(f"{base}/{eid}", json=body))
                updated += 1
        else:
            _check(s.post(base, json={**body, "id": eid}))
            created += 1
    for eid, e in remote.items():
        if eid not in wanted and e.get("status") != "cancelled":
            _check(s.delete(f"{base}/{eid}"))
            deleted += 1
    print(f"Google Calendar: {created} nuevos, {updated} actualizados, {deleted} borrados")
