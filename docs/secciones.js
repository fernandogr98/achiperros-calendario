// Pestañas Clasificación, Equipo y Rival. Usa los helpers globales de index.html ($, el, title, US, cap...).
(() => {
  // Norma de sanción por acumulación de amarillas (null = desconocida, solo se muestran los recuentos).
  const YELLOW_LIMIT = null;

  const TABS = ["partidos", "calendario", "clasificacion", "equipo", "rival", "liga"];
  const short = n => n.replace(/^F[ÚU]TBOL 7\s*/i, "").replace(/\s*\d{2}\/\d{2}\s*/, " ").replace(/\s+/g, " ").trim();
  const fmtDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const fmtShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "2-digit" });

  // ---------- Pestañas ----------
  function showTab() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "partidos";
    TABS.forEach(t => { $("tab-" + t).hidden = t !== tab; });
    document.querySelectorAll("nav.tabs a").forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("hashchange", () => {
    showTab();
    const nav = document.querySelector("nav.tabs");
    if (nav.getBoundingClientRect().top < 0 || window.scrollY > nav.offsetTop) window.scrollTo({ top: nav.offsetTop });
  });
  showTab();

  // ---------- Utilidades de tabla ----------
  function table(columns, rows, opts = {}) {
    const t = el("table", "tbl");
    const thead = el("thead"), hr = el("tr");
    columns.forEach((c, i) => {
      const th = el("th", (c.cls || "") + (opts.onSort && c.key ? " sort" : ""), c.label);
      if (c.title) th.title = c.title;
      if (opts.sortKey === c.key) th.setAttribute("aria-sort", "descending");
      if (opts.onSort && c.key) th.addEventListener("click", () => opts.onSort(c.key));
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);
    const tb = el("tbody");
    rows.forEach(r => {
      const tr = el("tr", opts.rowClass ? opts.rowClass(r) : null);
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

  function pills(box, items, current, onPick) {
    box.innerHTML = "";
    items.forEach(([value, label]) => {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(value === current));
      b.addEventListener("click", () => onPick(value));
      box.appendChild(b);
    });
  }

  const dash = v => (v === 0 ? el("span", "dim", "0") : v);

  // ---------- Clasificación ----------
  function renderStandings(data, compId) {
    const comps = data.competitions.filter(c => c.standings.length);
    if (!comps.length) { $("standings").innerHTML = '<div class="empty">Sin clasificación todavía.</div>'; return; }
    const comp = comps.find(c => c.id === compId) || comps[0];
    pills($("comp-pills"), comps.map(c => [c.id, short(c.name)]), comp.id, id => renderStandings(data, id));
    const rival = data.next_rival && data.next_rival.competition === comp.name ? data.next_rival.name : null;

    const me = comp.standings.find(r => r.team === US);
    const sum = $("comp-summary"); sum.innerHTML = "";
    if (me) {
      [[`${me.pos}º`, `de ${comp.standings.length}`], [me.pts, "puntos"], [`${me.g}-${me.e}-${me.p}`, "V-E-D"]].forEach(([b, s]) => {
        const d = el("div"); d.append(el("b", "display", b), el("span", null, s)); sum.appendChild(d);
      });
    }

    const st = $("standings"); st.innerHTML = "";
    st.appendChild(table([
      { key: "pos", label: "#" },
      { key: "team", label: "Equipo", cls: "name", get: r => titleTeam(r.team) },
      { key: "j", label: "PJ" }, { key: "g", label: "G" }, { key: "e", label: "E" }, { key: "p", label: "P" },
      { key: "dg", label: "DG", get: r => (r.dg > 0 ? "+" : "") + r.dg },
      { key: "pts", label: "Pts", cls: "pts" },
    ], comp.standings, { rowClass: r => r.team === US ? "us" : r.team === rival ? "rival" : null }));
    if (rival) st.appendChild(el("p", "note pad", `En rojo, el próximo rival (${titleTeam(rival)}).`));

    const sc = (comp.rankings.goleadores || {}).rows || [];
    const top = sc.slice(0, 10);
    sc.filter(r => r.Equipo === US && !top.includes(r)).forEach(r => top.push(r));
    const ls = $("league-scorers"); ls.innerHTML = "";
    if (top.length) {
      ls.appendChild(table([
        { key: "Posición", label: "#" },
        { key: "Nombre", label: "Jugador", cls: "name", get: r => title(r.Nombre) },
        { key: "Equipo", label: "Equipo", cls: "name", get: r => el("span", "dim", titleTeam(r.Equipo)) },
        { key: "Part.", label: "PJ" },
        { key: "Goles", label: "⚽", cls: "pts" },
      ], top, { rowClass: r => r.Equipo === US ? "us" : null }));
    } else ls.appendChild(el("div", "empty", "Sin goleadores todavía."));

    const fp = (comp.rankings.fairplay || {}).rows || [];
    const fb = $("fairplay"); fb.innerHTML = "";
    if (fp.length) {
      fb.appendChild(table([
        { key: "Posición", label: "#" },
        { key: "Equipo", label: "Equipo", cls: "name", get: r => titleTeam(r.Equipo) },
        { key: "Ama.", label: "🟨", get: r => dash(r["Ama."]) },
        { key: "Roja", label: "🟥", get: r => dash(r.Roja) },
        { key: "Azul", label: "🟦", get: r => dash(r.Azul) },
        { key: "Pts", label: "Pts", cls: "pts" },
      ], fp, { rowClass: r => r.Equipo === US ? "us" : null }));
      fb.appendChild(el("p", "note pad", "Menos puntos = más deportivo."));
    } else fb.appendChild(el("div", "empty", "Sin datos de fair play."));
  }

  // ---------- Equipo ----------
  function renderPlayers(data, scope, sortKey) {
    const comps = [...new Set(data.players.flatMap(p => Object.keys(p.por_competicion)))];
    pills($("team-pills"), [["", "Toda la temporada"], ...comps.map(c => [c, short(c)])], scope,
          s => renderPlayers(data, s, sortKey));
    const rows = data.players.map(p => {
      const c = scope ? p.por_competicion[scope] : null;
      return scope
        ? (c ? { ...p, pj: c.pj, goles: c.goles, amarillas: c.amarillas, rojas: c.rojas, mvp: null } : null)
        : p;
    }).filter(Boolean);
    const key = sortKey || "goles";
    rows.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1) || b.goles - a.goles || a.name.localeCompare(b.name));
    const box = $("players"); box.innerHTML = "";
    if (!rows.length) { box.appendChild(el("div", "empty", "Sin partidos jugados todavía.")); return; }
    const cols = [
      { key: "num", label: "#", get: r => el("span", "dim", r.num) },
      { key: "name", label: "Jugador", cls: "name", get: r => title(r.name) },
      { key: "pj", label: "PJ", title: "Partidos jugados" },
      { key: "goles", label: "⚽", title: "Goles", get: r => dash(r.goles) },
    ];
    if (!scope) cols.push({ key: "mvp", label: "⭐", title: "MVP", get: r => dash(r.mvp) });
    cols.push({ key: "amarillas", label: "🟨", title: "Amarillas", get: r => dash(r.amarillas) },
              { key: "rojas", label: "🟥", title: "Rojas", get: r => dash(r.rojas) });
    box.appendChild(table(cols, rows, { sortKey: key, onSort: k => renderPlayers(data, scope, k) }));
  }

  function renderDiscipline(data) {
    const box = $("discipline"); box.innerHTML = "";
    const roster = new Set(data.players.map(p => p.name));
    const official = data.competitions.flatMap(c => c.sanctions.map(s => ({ ...s, comp: c.name })))
      .filter(s => s.match.includes(US) && roster.has(s.player));
    official.forEach(s => {
      const a = el("div", "alert");
      const body = el("div");
      body.append(el("b", null, `🚫 ${title(s.player)} · ${s.type}`), el("small", null, `${short(s.comp)} · ${s.round} · ${s.date}`),
                  el("small", null, s.text));
      a.append(body); box.appendChild(a);
    });

    const carded = [];
    data.players.forEach(p => Object.entries(p.por_competicion).forEach(([comp, c]) => {
      if (c.amarillas || c.rojas) carded.push({ name: p.name, comp, ...c });
    }));
    carded.sort((a, b) => b.amarillas - a.amarillas || b.rojas - a.rojas);
    carded.forEach(c => {
      const near = YELLOW_LIMIT && c.amarillas % YELLOW_LIMIT === YELLOW_LIMIT - 1;
      const a = el("div", "alert " + (c.rojas ? "" : "warn"));
      const parts = [];
      if (c.amarillas) parts.push(`${c.amarillas} amarilla${c.amarillas > 1 ? "s" : ""}`);
      if (c.rojas) parts.push(`${c.rojas} roja${c.rojas > 1 ? "s" : ""}`);
      const body = el("div");
      body.append(el("b", null, `${c.rojas ? "🟥" : "🟨"} ${title(c.name)} · ${parts.join(" y ")}`),
                  el("small", null, short(c.comp) + (near ? " · ⚠️ a 1 amarilla de sanción" : "")));
      a.append(body); box.appendChild(a);
    });

    if (!official.length && !carded.length) {
      const a = el("div", "alert ok"); a.append(el("b", null, "✅ Sin tarjetas ni sanciones esta temporada")); box.appendChild(a);
    }
    if (!YELLOW_LIMIT && carded.length) box.appendChild(el("p", "note", "Las sanciones oficiales salen arriba en rojo cuando el comité las publica."));
  }

  // ---------- Rival ----------
  function renderRival(data) {
    const box = $("rival"); box.innerHTML = "";
    const r = data.next_rival;
    if (!r) { box.appendChild(el("div", "empty", "No hay próximo partido publicado.")); return; }
    $("rival-link").hidden = false;

    const head = el("section");
    head.appendChild(el("h2", "label", "Próximo rival"));
    const card = el("div", "next");
    card.style.textAlign = "left";
    const rh = el("div", "rival-head");
    rh.append(el("h3", "display", titleTeam(r.name)));
    if (r.rival_id) {
      const a = el("a", "link-gold", "Competize ↗");
      a.href = `https://www.competize.com/es/team/view/${r.rival_id}`; a.target = "_blank"; a.rel = "noopener";
      rh.appendChild(a);
    }
    card.appendChild(rh);
    card.appendChild(el("div", "comp", `${short(r.competition)} · ${r.matchday} · ${r.home ? "en casa" : "fuera"}`));
    card.appendChild(el("div", "comp", cap(fmtDate.format(new Date(r.date))) + (r.venue ? ` · ${r.venue}` : "")));
    if (r.standing) {
      const kv = el("div", "kv"); const s = r.standing;
      [[`${s.pos}º`, "Puesto"], [s.pts, "Puntos"], [`${s.g}-${s.e}-${s.p}`, "V-E-D"], [`${s.gf}:${s.gc}`, "Goles"]].forEach(([b, l]) => {
        const d = el("div"); d.append(el("b", "display", b), el("span", null, l)); kv.appendChild(d);
      });
      card.appendChild(kv);
    }
    head.appendChild(card); box.appendChild(head);

    if (r.sanctions && r.sanctions.length) {
      const sec = el("section"); sec.appendChild(el("h2", "label", "Sancionados del rival"));
      r.sanctions.forEach(s => {
        const a = el("div", "alert ok"); const b = el("div");
        b.append(el("b", null, `🚫 ${title(s.player)}`), el("small", null, s.text)); a.appendChild(b); sec.appendChild(a);
      });
      box.appendChild(sec);
    }

    const sec2 = el("section"); sec2.appendChild(el("h2", "label", "Últimos resultados del rival"));
    const lr = el("div", "card");
    if (r.last_results && r.last_results.length) {
      const form = el("div", "form pad");
      r.last_results.slice().reverse().forEach(m => form.appendChild(el("div", "badge " + m.result, m.result)));
      lr.appendChild(form);
      r.last_results.forEach(m => lr.appendChild(miniRow(m, r.name)));
    } else lr.appendChild(el("div", "empty", "Todavía no ha jugado esta temporada."));
    sec2.appendChild(lr); box.appendChild(sec2);

    const sec3 = el("section"); sec3.appendChild(el("h2", "label", "Sus goleadores"));
    const ts = el("div", "card");
    if (r.top_scorers && r.top_scorers.length) {
      ts.appendChild(table([
        { key: "Nombre", label: "Jugador", cls: "name", get: x => title(x.Nombre) },
        { key: "Part.", label: "PJ" }, { key: "Goles", label: "⚽", cls: "pts" },
        { key: "Posición", label: "Liga", get: x => el("span", "dim", `${x["Posición"]}º`) },
      ], r.top_scorers));
    } else ts.appendChild(el("div", "empty", "Sin goles registrados todavía."));
    sec3.appendChild(ts); box.appendChild(sec3);

    const sec4 = el("section"); sec4.appendChild(el("h2", "label", "Cara a cara"));
    const h2 = el("div", "card");
    if (r.head_to_head && r.head_to_head.length) {
      const t = { V: 0, E: 0, D: 0 }; r.head_to_head.forEach(m => t[m.result]++);
      h2.appendChild(el("div", "pad comp", `Achiperros: ${t.V} victorias, ${t.E} empates, ${t.D} derrotas`));
      r.head_to_head.forEach(m => h2.appendChild(miniRow(m, US)));
    } else h2.appendChild(el("div", "empty", "Primer enfrentamiento entre ambos equipos."));
    sec4.appendChild(h2); box.appendChild(sec4);
  }

  function miniRow(m, team) {
    const d = new Date(m.date);
    const r = el("a", "row");
    r.href = m.url; r.target = "_blank"; r.rel = "noopener"; r.style.color = "inherit"; r.style.textDecoration = "none";
    const db = el("div", "date-box");
    db.append(el("div", "d display", d.getDate()), el("div", "m", fmtShort.format(d).replace(/^\d+\s*/, "").replace(".", "")));
    const info = el("div", "info"); const t = el("div", "t");
    const name = n => el("span", n === US ? "us" : null, titleTeam(n));
    t.append(name(m.home), document.createTextNode(` ${m.score[0]}-${m.score[1]} `), name(m.away));
    info.appendChild(t);
    r.append(db, info);
    if (m.result) r.appendChild(el("div", "badge " + m.result, m.result));
    return r;
  }

  // ---------- Carga ----------
  fetch("stats.json", { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
    if (data.updated) {
      const u = new Date(data.updated);
      $("updated").textContent = `Actualizado ${u.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} ${fmtTime.format(u)} · `;
    }
    const safe = (fn, ...a) => { try { fn(...a); } catch (e) { console.error(e); } };
    safe(renderStandings, data);
    safe(renderPlayers, data, "", "goles");
    safe(renderDiscipline, data);
    safe(renderRival, data);
  }).catch(() => {
    ["standings", "players", "rival"].forEach(id => { $(id).innerHTML = '<div class="empty">No se pudieron cargar las estadísticas.</div>'; });
  });
})();
