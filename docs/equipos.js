// Pestaña "Liga": resultados de todos los equipos de la liga (FINDE y LABORAL).
// Usa los helpers globales de index.html ($, el, title, titleTeam, US, cap, fmtTime...).
(() => {
  const LABELS = { FINDE: "Fútbol 7 Finde", LABORAL: "Fútbol 7 Laboral" };
  const fmtD = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });

  // ---- helpers locales (tabla no ordenable + pills) ----
  function mkTable(columns, rows) {
    const t = el("table", "tbl");
    const thead = el("thead"), hr = el("tr");
    columns.forEach(c => hr.appendChild(el("th", c.cls || "", c.label)));
    thead.appendChild(hr); t.appendChild(thead);
    const tb = el("tbody");
    rows.forEach(r => {
      const tr = el("tr");
      columns.forEach(c => {
        const v = c.get ? c.get(r) : r[c.key];
        const td = el("td", c.cls || null);
        if (v instanceof Node) td.appendChild(v); else td.textContent = v ?? "";
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function mkPills(box, items, current, onPick) {
    box.innerHTML = "";
    items.forEach(([value, label]) => {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(value === current));
      b.addEventListener("click", () => onPick(value));
      box.appendChild(b);
    });
  }

  function teamCard(t) {
    const wrap = el("details", "team-card" + (t.name === US ? " us" : ""));
    const sum = el("summary");
    const row = el("div", "team-row");

    const pos = el("div", "pos-num", t.pos != null ? t.pos : "·");
    const info = el("div", "team-info");
    info.append(el("div", "n", titleTeam(t.name)),
                el("div", "r", `PJ ${t.pj ?? 0} · ${t.g ?? 0}V ${t.e ?? 0}E ${t.p ?? 0}D`));
    const form = el("div", "team-form");
    (t.form || []).slice().reverse().forEach(r => form.appendChild(el("span", "badge " + r, r)));
    const pts = el("div", "team-pts");
    pts.append(el("b", "display", t.pts != null ? t.pts : 0), el("span", null, "pts"));
    const chev = el("span", "chev", "▾");

    row.append(pos, info, form, pts, chev);
    sum.appendChild(row);
    wrap.appendChild(sum);

    const det = el("div", "team-detail");
    const rec = el("div", "record-strip");
    [["G", t.g, "ganados"], ["E", t.e, "empates"], ["P", t.p, "perdidos"],
     ["GF", t.gf, "a favor"], ["GC", t.gc, "en contra"]].forEach(([l, v, lbl]) => {
      const d = el("div"); d.append(el("b", "display", v != null ? v : 0), el("span", null, l + " · " + lbl));
      rec.appendChild(d);
    });
    det.appendChild(rec);

    if (t.matches && t.matches.length) {
      det.appendChild(mkTable([
        { key: "date", label: "Fecha", get: m => fmtD.format(new Date(m.date)) },
        { key: "rival", label: "Rival", cls: "name", get: m => titleTeam(m.home === t.name ? m.away : m.home) },
        { key: "loc", label: "", get: m => el("span", "dim", m.home === t.name ? "Casa" : "Fuera") },
        { key: "score", label: "Marcador", get: m => m.score },
        { key: "result", label: "", get: m => el("span", "badge " + m.result, m.result) },
      ], t.matches));
    } else {
      det.appendChild(el("div", "empty", "Sin partidos jugados esta temporada."));
    }
    wrap.appendChild(det);
    return wrap;
  }

  function render(data) {
    const comps = data.competitions.filter(c => c.teams.length);
    const box = $("liga");
    if (!comps.length) { box.innerHTML = '<div class="empty">Sin datos de equipos todavía.</div>'; return; }

    let current = comps[0].id;
    let query = "";

    function draw() {
      const comp = comps.find(c => c.id === current) || comps[0];
      mkPills($("liga-pills"), comps.map(c => [c.id, LABELS[c.name] || c.name]), current, id => { current = id; draw(); });

      const q = query.trim().toLowerCase();
      const teams = comp.teams.filter(t => !q || t.name.toLowerCase().includes(q));

      const tb = $("liga-teams"); tb.innerHTML = "";
      if (!teams.length) { tb.appendChild(el("div", "empty", "Sin resultados con ese filtro.")); return; }
      teams.forEach(t => tb.appendChild(teamCard(t)));
    }

    draw();
    $("liga-search").addEventListener("input", e => { query = e.target.value; draw(); });
  }

  fetch("teams.json", { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject()).then(render).catch(() => {
    $("liga").innerHTML = '<div class="empty">No se pudieron cargar los equipos.</div>';
  });
})();
