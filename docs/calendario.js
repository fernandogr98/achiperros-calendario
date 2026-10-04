// Pestaña Calendario: vista mensual con los días de partido. Usa helpers globales de index.html
// ($, el, title, titleTeam, US, cap, fmtTime, parseIcs).
(() => {
  const PALETTE = ["#efbe24", "#4fb3ff", "#b48cff", "#3ccf7a", "#ff8a4c"];
  const DOW = ["L", "M", "X", "J", "V", "S", "D"];
  const fmtMonth = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const short = n => n.replace(/^F[ÚU]TBOL 7\s*/i, "").replace(/\s*\d{2}\/\d{2}\s*/, " ").replace(/\s+/g, " ").trim();
  const key = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const sameDay = (a, b) => key(a) === key(b);

  let events = [], details = {}, colors = {}, view, selected;

  function result(e) {
    if (!e.score) return "";
    const [h, a] = e.score, ours = e.home === US ? h : a, theirs = e.home === US ? a : h;
    return ours > theirs ? "V" : ours < theirs ? "D" : "E";
  }

  function scorersLine(e) {
    const id = (e.url.match(/(\d+)$/) || [])[1];
    const d = details[id];
    if (!d) return "";
    const ours = e.home === US ? d.home : d.away;
    return ours.filter(p => p.stats["Gol"]).sort((a, b) => b.stats["Gol"] - a.stats["Gol"])
      .map(p => title(p.name).split(" ").slice(0, 2).join(" ") + (p.stats["Gol"] > 1 ? ` ×${p.stats["Gol"]}` : "")).join(", ");
  }

  function renderLegend() {
    const lg = $("cal-legend"); lg.innerHTML = "";
    Object.entries(colors).forEach(([comp, c]) => {
      const it = el("span", "cal-leg");
      const dot = el("i"); dot.style.background = c;
      it.append(dot, document.createTextNode(short(comp)));
      lg.appendChild(it);
    });
  }

  function renderMonth() {
    $("cal-title").textContent = cap(fmtMonth.format(view));
    const grid = $("cal-grid"); grid.innerHTML = "";
    DOW.forEach(d => grid.appendChild(el("div", "cal-dow", d)));

    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;            // lunes = 0
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const today = new Date();
    const byDay = {};
    events.forEach(e => (byDay[key(e.date)] ||= []).push(e));

    for (let i = 0; i < offset; i++) grid.appendChild(el("div", "cal-cell empty"));
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const date = new Date(view.getFullYear(), view.getMonth(), d);
      const evs = byDay[key(date)] || [];
      count += evs.length;
      const cell = el("button", "cal-cell");
      cell.type = "button";
      cell.appendChild(el("span", "cal-num", d));
      if (sameDay(date, today)) cell.classList.add("today");
      if (selected && sameDay(date, selected)) cell.classList.add("sel");
      if (evs.length) {
        cell.classList.add("has");
        const c = colors[evs[0].comp] || PALETTE[0];
        cell.style.setProperty("--c", c);
        const r = result(evs[0]);
        cell.appendChild(el("span", "cal-sub " + (r ? "res " + r : ""), r || fmtTime.format(evs[0].date)));
        cell.setAttribute("aria-label", `${d}: ${evs.map(e => `${e.home} contra ${e.away}`).join(", ")}`);
      }
      cell.addEventListener("click", () => { selected = date; renderMonth(); renderDay(); });
      grid.appendChild(cell);
    }
    $("cal-count").textContent = count ? `${count} partido${count > 1 ? "s" : ""} este mes` : "Sin partidos este mes";
  }

  function renderDay() {
    const box = $("cal-day"); box.innerHTML = "";
    if (!selected) return;
    const evs = events.filter(e => sameDay(e.date, selected));
    box.appendChild(el("h2", "label", cap(fmtDay.format(selected))));
    if (!evs.length) { box.appendChild(el("div", "card empty", "No hay partido este día.")); return; }
    evs.forEach(e => {
      const c = el("div", "next cal-card");
      c.style.borderTopColor = colors[e.comp] || PALETTE[0];
      c.appendChild(el("div", "comp", [short(e.comp), e.round].filter(Boolean).join(" · ")));
      const vs = el("div", "vs");
      const t = n => el("div", "team" + (n === US ? " us" : ""), titleTeam(n));
      const mid = e.score ? el("div", "sep display", `${e.score[0]}-${e.score[1]}`) : el("div", "sep display", "VS");
      if (e.score) mid.style.color = "var(--text)";
      vs.append(t(e.home), mid, t(e.away));
      c.appendChild(vs);
      c.appendChild(el("div", "where", `🕒 ${fmtTime.format(e.date)}` + (e.venue ? ` · 📍 ${e.venue}` : "")));
      const sc = scorersLine(e);
      if (sc) c.appendChild(el("div", "where", `⚽ ${sc}`));
      const r = result(e);
      if (r) c.appendChild(el("div", "countdown cal-res " + r, r === "V" ? "Victoria" : r === "D" ? "Derrota" : "Empate"));
      const links = el("div", "cal-links");
      const acta = el("a", "acta", e.score ? "Ver acta ↗" : "Ficha del partido ↗");
      acta.href = e.url; acta.target = "_blank"; acta.rel = "noopener";
      links.appendChild(acta);
      if (e === nextEvent()) {
        const riv = el("a", "acta", "Ficha del rival →"); riv.href = "#rival"; links.appendChild(riv);
      }
      c.appendChild(links);
      box.appendChild(c);
    });
  }

  const nextEvent = () => events.find(e => !e.score && e.date >= new Date(Date.now() - 2 * 36e5));

  function go(delta) { view = new Date(view.getFullYear(), view.getMonth() + delta, 1); renderMonth(); }

  $("cal-prev").addEventListener("click", () => go(-1));
  $("cal-next").addEventListener("click", () => go(1));
  $("cal-today").addEventListener("click", () => {
    const now = new Date(); view = new Date(now.getFullYear(), now.getMonth(), 1); selected = now;
    renderMonth(); renderDay();
  });
  // Deslizar para cambiar de mes
  let x0 = null;
  const grid = $("cal-grid");
  grid.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  grid.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });

  Promise.all([
    fetch("achiperros.ics", { cache: "no-store" }).then(r => r.text()),
    fetch("matches.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]).then(([txt, det]) => {
    events = parseIcs(txt); details = det;
    [...new Set(events.map(e => e.comp))].sort().forEach((c, i) => { colors[c] = PALETTE[i % PALETTE.length]; });
    const now = new Date();
    const next = events.find(e => e.date >= new Date(now - 2 * 36e5));
    const focus = next ? next.date : (events.length ? events[events.length - 1].date : now);
    view = new Date(focus.getFullYear(), focus.getMonth(), 1);
    selected = next ? next.date : null;
    renderLegend(); renderMonth(); renderDay();
  }).catch(() => { $("cal-grid").innerHTML = '<div class="empty">No se pudo cargar el calendario.</div>'; });
})();
