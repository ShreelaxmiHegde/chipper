
/* ---------- helpers ---------- */
const $ = (s, e = document) => e.querySelector(s), pad = n => String(n).padStart(2, "0");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chip = c => `<svg class="stk ${c || ""}" viewBox="0 0 100 100"><use href="#chip"/></svg>`;

const COL = ["#ff4fa3", "#b6ff3b", "#25e8ff", "#ffa63d", "#a77bff", "#ffe14d"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODES = {
  check: "Completion",
  duration: "Duration",
  adherence: "Schedule"
};

let tt;
const toast = m => {
  const t = $("#toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove("show"), 2600)
};

const D = {
  fmt: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  parse: s => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d)
  },
  add: (s, n) => {
    const d = D.parse(s);
    d.setDate(d.getDate() + n);
    return D.fmt(d)
  },
  addM: (s, n) => {
    const d = D.parse(s),
      k = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(k, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return D.fmt(d)
  },
  diff: (a, b) => Math.round((D.parse(a) - D.parse(b)) / 864e5),
  today: () => D.fmt(new Date()),
  dow: s => D.parse(s).getDay(),
  wStart: s => D.add(s, -((D.dow(s) + 6) % 7)),
  mStart: s => s.slice(0, 8) + "01",
  mEnd: s => {
    const d = D.parse(s);
    return D.fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  },
  range: (a, b) => {
    const r = [];
    for (let x = a; x <= b; x = D.add(x, 1))r.push(x);
    return r
  }
};

const shortD = s => D.parse(s).toLocaleDateString("en", { day: "numeric", month: "short" });
const lbl = s => D.parse(s).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "short" });

/* ---------- storage: one JSON file per task (+ index.json), in browser storage and optionally a linked folder ---------- */
const idb = (mode, fn) => new Promise((res, rej) => {
  const o = indexedDB.open("chipper", 1);
  o.onupgradeneeded = () => o.result.createObjectStore("h");
  o.onerror = () => rej(o.error);
  o.onsuccess = () => {
    const t = o.result.transaction("h", mode),
      r = fn(t.objectStore("h"));
    t.oncomplete = () => res(r.result);
    t.onerror = () => rej(t.error)
  }
});

const FS = {
  dir: null,
  async write(p, obj) {
    const txt = JSON.stringify(obj, null, 2);
    try { localStorage.setItem("chipper:" + p, txt) } catch (e) { }

    if (FS.dir) try {
      const a = p.split("/");
      let d = FS.dir;
      for (const n of a.slice(0, -1)) d = await d.getDirectoryHandle(n, { create: true });
      const w = await (await d.getFileHandle(a.at(-1), { create: true })).createWritable();
      await w.write(txt);
      await w.close()
    } catch (e) {
      toast("Couldn’t write to the linked folder")
    }
  },

  read(p) {
    try {
      return JSON.parse(localStorage.getItem("chipper:" + p))
    } catch (e) { return null }
  },

  async remove(p) {
    localStorage.removeItem("chipper:" + p);
    if (FS.dir) try {
      const [a, b] = p.split("/");
      await (await FS.dir.getDirectoryHandle(a)).removeEntry(b)
    } catch (e) { }
  },

  async readDir(p) {
    try {
      const a = p.split("/");
      let d = FS.dir;
      for (const n of a.slice(0, -1)) d = await d.getDirectoryHandle(n);
      return JSON.parse(await (await (await d.getFileHandle(a.at(-1))).getFile()).text())
    } catch (e) {
      return null
    }
  }
};

const toFile = t => {
  const { records, meta, ...config } = t;
  return { config, records, meta }
}

fromFile = f => ({ ...f.config, records: f.records || {}, meta: f.meta || {} });

const Store = {
  tasks: [],
  load() { this.tasks = (FS.read("index.json")?.order || []).map(id => FS.read(`tasks/${id}.json`)).filter(Boolean).map(fromFile) },
  saveIndex: () => FS.write("index.json", {
    version: 1,
    order: Store.tasks.map(t => t.id),
    updated: new Date().toISOString()
  }),

  save(t) {
    const k = Object.keys(t.records).sort();
    t.meta = {
      updated: new Date().toISOString(),
      completions: k.length,
      lastDone: k.at(-1) || null
    };
    return FS.write(`tasks/${t.id}.json`, toFile(t))
  },

  async del(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    await FS.remove(`tasks/${id}.json`);
    await this.saveIndex()
  }
};

async function pull(h) {
  FS.dir = h;
  const idx = await FS.readDir("index.json");
  for (const id of idx?.order || []) {
    const f = await FS.readDir(`tasks/${id}.json`);
    if (!f) continue;
    const t = fromFile(f), i = Store.tasks.findIndex(x => x.id === id);
    i < 0 ? Store.tasks.push(t) : Store.tasks[i] = t
  }

  for (const t of Store.tasks) {
    await Store.save(t);
    await Store.saveIndex();
    render()
  }
}

async function linkFolder() {
  try {
    let h = S.pend;
    if (!(h && await h.requestPermission({ mode: "readwrite" }) === "granted")) {
      h = await showDirectoryPicker({ mode: "readwrite" });
    }
    await idb("readwrite", s => s.put(h, "dir"));
    await pull(h);
    toast("Folder linked 📁")
  } catch (e) {
    toast("Folder access isn’t available here — records are kept in browser storage")
  }
}

/* ---------- tracking logic ---------- */
const Logic = {
  sched(t, d) {
    if (d < t.start) return false;
    const r = t.recur;
    if (r.type === "daily") return true;
    if (r.type === "weekly") return r.days.includes(D.dow(d));
    if (r.type === "monthly") {
      const last = +D.mEnd(d).slice(8);
      return r.mdays.some(m => Math.min(m, last) === +d.slice(8))
    }

    return D.diff(d, t.start) % r.every === 0
  },

  period: t => t.adh.every * ({ days: 1, weeks: 7, months: 30 }[t.adh.unit]),
  next: (t, f) => t.adh.unit === "months" ? D.addM(f, t.adh.every) : D.add(f, t.adh.every * (t.adh.unit === "weeks" ? 7 : 1)),
  /* schedule adherence: each completion closes a cycle; the next due date = completion date + interval */
  cycles(t) {
    const out = [], P = Logic.period(t);
    let due = t.start;

    for (const c of Object.keys(t.records).sort()) {
      const late = D.diff(c, due);
      out.push({
        due, done: c,
        late,
        status: late <= 0 ? "ontime" : late > P ? "missed" : "late"
      });
      due = Logic.next(t, c)
    }

    const o = D.diff(D.today(), due);

    out.push({
      due,
      done: null,
      late: o,
      status: o < 0 ? "upcoming" : o === 0 ? "due" : o > P ? "missed" : "overdue"
    });

    return out
  },

  entry(t, d) {
    const rec = t.records[d];
    if (t.mode === "adherence") {
      const cs = Logic.cycles(t), c = cs.find(c => c.done === d);
      if (c) return { done: true, rec, status: c.status, due: c.due, late: c.late };
      const o = cs.at(-1);

      return o.due === d || (d === D.today() && o.late > 0) ? { done: false, status: o.status, due: o.due, late: o.late } : null
    }
    return Logic.sched(t, d) || rec ? { done: !!rec, rec, missed: !rec && d < D.today() } : null
  }
};

const dayStats = d => {
  let s = 0, n = 0;
  for (const t of Store.tasks) {
    const e = Logic.entry(t, d);
    if (e) {
      s++;
      if (e.done) n++
    }
  }

  return { s, n, r: s ? n / s : null }
};

const desc = t => {
  if (t.mode === "adherence") return `Every ${t.adh.every} ${t.adh.unit}`;
  const r = t.recur;
  return r.type === "daily" ? "Daily" : r.type === "weekly" ? r.days.map(i => WD[i]).join(" ") : r.type === "monthly" ? "Monthly, day " + r.mdays.join(", ") : `Every ${r.every} days`
};

/* ---------- charts: thin lines ---------- */
function chart(pts, o = {}) {
  const w = 340, h = o.h || 120, L = 30, R = 10, T = 10, B = 20, ys = pts.map(p => p.y).filter(v => v != null);
  const m = Math.max(1, ...ys), p = 10 ** Math.floor(Math.log10(m)), n = m / p, mx = o.max || (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  const X = i => L + (pts.length < 2 ? (w - L - R) / 2 : i * (w - L - R) / (pts.length - 1)), Y = v => T + (h - T - B) * (1 - v / mx);
  let path = "", pen = false, dots = "";

  pts.forEach((q, i) => {
    if (q.y == null) { pen = false; return }
    path += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(q.y).toFixed(1)}`;
    pen = true;
    dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="2.2" fill="${o.color}"/>`
  });

  const grid = [0, .5, 1].map(f => `<line x1="${L}" x2="${w - R}" y1="${Y(mx * f)}" y2="${Y(mx * f)}" stroke="#222" stroke-width=".7"/><text x="${L - 5}" y="${Y(mx * f) + 3}" text-anchor="end">${+(mx * f).toFixed(1)}${o.suf || ""}</text>`).join("");

  const idx = pts.length <= 8 ? pts.map((_, i) => i) : [0, pts.length >> 1, pts.length - 1];

  const xl = idx.map(i => `<text x="${X(i)}" y="${h - 5}" text-anchor="middle">${pts.length <= 8 && o.wd ? WD[D.dow(pts[i].x)] : shortD(pts[i].x)}</text>`).join("");

  return `<svg class="ch" viewBox="0 0 ${w} ${h}">${grid}<path d="${path}" fill="none" stroke="${o.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xl}</svg>`
}

/* ---------- views ---------- */
const S = { tab: "cal", view: "month", cur: D.today(), sel: D.today(), pm: "week", pc: D.today(), pend: null };
const tg = (t, d, on, dis) => `<button class="chk ${on ? "on" : ""}" data-act="toggle" data-id="${t.id}" data-d="${d}" ${dis}>✓</button>`;

function row(t, e, d, fut) {
  const dis = fut ? "disabled" : "", c = t.color; let sub = desc(t), ctl = "";
  if (t.mode === "adherence") {
    const p = {
      ontime: ["On time", "ok"],
      late: [`Late ${e.late}d`, "warn"],
      missed: [`Missed, ${e.late}d late`, "bad"],
      overdue: [`Overdue ${e.late}d`, "bad"],
      due: ["Due today", "hot"],
      upcoming: ["Upcoming", "mut"]
    }[e.status];
    sub += ` · due ${shortD(e.due)}`; ctl = `<span class="pill ${p[1]}">${p[0]}</span>` + tg(t, d, e.done, dis)
  } else if (t.mode === "duration") {
    if (t.goal) sub += ` · goal ${t.goal} ${esc(t.unit)}`;
    ctl = `<input type="number" min="0" step="any" id="v-${t.id}" data-id="${t.id}" value="${e.rec?.v ?? ""}" placeholder="${esc(t.unit || "value")}" ${dis}><button class="chk ${e.done ? "on" : ""}" data-act="logv" data-id="${t.id}" data-d="${d}" ${dis}>✓</button>` + (e.done ? `<button class="x" title="Clear" data-act="toggle" data-id="${t.id}" data-d="${d}">↺</button>` : "")
  } else {
    ctl = (e.missed ? `<span class="pill bad">Missed</span>` : "") + tg(t, d, e.done, dis);
  }

  return `
  <div class="row ${e.done ? "done" : ""}" style="--c:${c}">
    <span class="em">${esc(t.emoji)}</span>
    <div class="inf"><b>${esc(t.name)}</b><small>${sub}</small></div>
    <div class="ctl">${ctl}</div>
  </div>
  `;
}

function dayPanel() {
  const d = S.sel, fut = d > D.today(), rows = Store.tasks.map(t => ({ t, e: Logic.entry(t, d) })).filter(x => x.e), st = dayStats(d);

  return `
  <section class="card">
    <div class="ph">
      <div>
        <h2>${lbl(d)}</h2>
        <small>${d === D.today() ? "Today" : fut ? "Upcoming" : "Past"} · ${st.n}/${st.s} done</small>
      </div>
      <i class="ring" style="--p:${Math.round((st.r || 0) * 100)};display:block"></i>
    </div>
  ` +
    (rows.length ? rows.map(x => row(x.t, x.e, d, fut)).join("") : `
    <div class="empty">${chip()}
      <p>${Store.tasks.length ? "Nothing scheduled. Enjoy the day!" : "No tasks yet. Add your first one!"}</p>
      ${Store.tasks.length ? "" : `
      <button class="btn" data-act="new">＋ New task</button> 
      <button class="btn ghost" data-act="seed">Try sample tasks</button>
      `}
    </div>
    `) +
    (rows.length && st.s === st.n && !fut ? `
    <div class="empty small">${chip()}
      <p>All acorns gathered! 🌰</p>
    </div>
    ` : "") +
    `</section>`
}

function calView() {
  const v = S.view, c = S.cur; let title, body = "";
  if (v === "month") {
    title = D.parse(c).toLocaleDateString("en", { month: "long", year: "numeric" });
    const s = D.wStart(D.mStart(c));
    body = `<div class="mg">${[...WD.slice(1), "Sun"].map(w => `<div class="wh">${w}</div>`).join("")}${D.range(s, D.add(s, 41)).map(d => `<button class="cell ${d.slice(0, 7) !== c.slice(0, 7) ? "dim" : ""} ${d === D.today() ? "today" : ""} ${d === S.sel ? "sel" : ""}" data-act="sel" data-d="${d}"><span>${+d.slice(8)}</span><i class="dots">${Store.tasks.map(t => ({ t, e: Logic.entry(t, d) })).filter(x => x.e).slice(0, 6).map(x => `<b style="--c:${x.t.color}" class="${x.e.done ? "on" : ""}"></b>`).join("")}</i></button>`).join("")}</div>`
  }
  else if (v === "week") {
    const s = D.wStart(c); title = `${shortD(s)} – ${shortD(D.add(s, 6))}`;
    body = `<div class="wg">${D.range(s, D.add(s, 6)).map(d => `<button class="wc ${d === D.today() ? "today" : ""} ${d === S.sel ? "sel" : ""}" data-act="sel" data-d="${d}"><b>${WD[D.dow(d)]} ${+d.slice(8)}</b>${Store.tasks.map(t => ({ t, e: Logic.entry(t, d) })).filter(x => x.e).map(x => `<span class="chipx ${x.e.done ? "on" : ""}" style="--c:${x.t.color}">${esc(x.t.emoji)} ${esc(x.t.name)}</span>`).join("") || "<small>—</small>"}</button>`).join("")}</div>`
  }
  else title = lbl(c);
  return `<div class="bar"><div class="seg">${["day", "week", "month"].map(x => `<button data-act="view" data-d="${x}" class="${v === x ? "on" : ""}">${x}</button>`).join("")}</div><div class="nav"><button data-act="nav" data-d="-1" aria-label="Previous">‹</button><h1>${title}</h1><button data-act="nav" data-d="1" aria-label="Next">›</button><button class="btn sm" data-act="today">Today</button></div></div><div class="lay ${v}">${v === "day" ? "" : `<div class="card">${body}</div>`}${dayPanel()}</div>`
}

function tprog(t, days) {
  const td = D.today();
  let h = `
    <div class="card" style="--c:${t.color}">
      <div class="th">
      <span class="em">${esc(t.emoji)}</span>
      <b>${esc(t.name)}</b>
      <small>${MODES[t.mode]}</small>
    </div>
  `;

  if (t.mode === "adherence") {
    const cs = Logic.cycles(t), inR = cs.filter(c => c.done && c.done >= days[0] && c.done <= days.at(-1)), k = s => inR.filter(c => c.status === s).length, o = cs.at(-1);

    h += `
      <div class="pills">
        <span class="pill ok">${k("ontime")} on time</span>
        <span class="pill warn">${k("late")} late</span>
        <span class="pill bad">${k("missed")} missed</span>
      </div>
      <small>Next due ${shortD(o.due)} · ${o.late < 0 ? `in ${-o.late} days` : o.late === 0 ? "today" : `overdue by ${o.late} days`}</small>
    `;

    const pts = cs.filter(c => c.done).slice(-12).map(c => ({ x: c.done, y: Math.max(0, c.late) }));
    if (pts.length) h += chart(pts, { color: t.color, h: 90 }) + `<small class="cap">Days late per cycle (0 = on time)</small>`
  } else {
    const sc = days.filter(d => d <= td && Logic.entry(t, d)), dn = sc.filter(d => Logic.entry(t, d).done), r = sc.length ? Math.round(dn.length / sc.length * 100) : 0;

    h += `
      <div class="bar2">
        <i style="width:${r}%"></i>
      </div>
      <small>${dn.length}/${sc.length} done · ${r}%</small>
      <div class="strip">
        ${days.map(d => {
      const e = Logic.entry(t, d); return `
        <i class="${!e ? "" : e.done ? "d" : d <= td ? "m" : "f"}" title="${d}"></i>
        ` }).join("")}
      </div>
    `;

    if (t.mode === "duration") {
      const v = days.map(d => ({ x: d, y: t.records[d]?.v ?? null })), ys = v.filter(p => p.y != null).map(p => p.y), sum = ys.reduce((a, b) => a + b, 0);
      h += `<small>Total ${+sum.toFixed(1)} ${esc(t.unit)} · avg ${ys.length ? +(sum / ys.length).toFixed(1) : 0} per entry</small>` + chart(v, { color: t.color, h: 90, wd: 1 })
    }
  }
  return h + "</div>"
}

function progView() {
  const m = S.pm, c = S.pc, a = m === "week" ? D.wStart(c) : D.mStart(c), b = m === "week" ? D.add(a, 6) : D.mEnd(c), td = D.today(), days = D.range(a, b);
  const pts = days.map(d => {
    if (d > td) return { x: d, y: null };
    const s = dayStats(d); return { x: d, y: s.r == null ? null : Math.round(s.r * 100) }
  });

  const tot = days.filter(d => d <= td).reduce((p, d) => {
    const s = dayStats(d);
    return { s: p.s + s.s, n: p.n + s.n }
  }, { s: 0, n: 0 }), rate = tot.s ? Math.round(tot.n / tot.s * 100) : 0;

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = D.add(td, -i),
      s = dayStats(d); if (!s.s) continue;
    if (s.r === 1) streak++; else if (i) break
  }

  const say = !tot.s ? "Add some tasks and I’ll cheer you on!" : rate >= 80 ? "Nut-tastic work!" : rate >= 50 ? "Solid stash, keep going!" : "Every acorn counts. Let’s go!";

  return `
  <div class="bar">
    <div class="seg">${["week", "month"].map(x =>
    `<button data-act="pm" data-d="${x}" class="${m === x ? "on" : ""}">${x}</button>`).join("")}
    </div>
    <div class="nav">
      <button data-act="pnav" data-d="-1" aria-label="Previous">‹</button>
      <h1>${m === "week" ? `${shortD(a)} – ${shortD(b)}` : D.parse(c).toLocaleDateString("en", { month: "long", year: "numeric" })}</h1>
      <button data-act="pnav" data-d="1" aria-label="Next">›</button>
    </div>
  </div>
  <div class="hero">${chip()}<div class="bub">${say}</div></div>
    <div class="sum"><div style="--c:var(--lime)">
      <b>${rate}%</b>
      <small>completion rate</small>
    </div>
    <div style="--c:var(--pink)">
      <b>${tot.n}/${tot.s}</b>
      <small>tasks done</small>
    </div>
    <div style="--c:var(--cyan)">
      <b>${streak}</b>
      <small>day streak 🔥</small>
    </div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <b>Daily completion</b>${chart(pts, { color: "#ff4fa3", max: 100, suf: "%", wd: 1 })}
  </div>
  <div class="pg">${Store.tasks.map(t => tprog(t, days)).join("") || `<div class="empty">No tasks to chart yet.</div>`}</div>`
}

function tasksView() {
  return `
  <div class="bar">
    <h1>My tasks</h1>
    <button class="btn" data-act="new">＋ New task</button>
  </div>
  ` + (Store.tasks.length ? `
  <div class="tl">${Store.tasks.map(t => `
    <div class="card tcard" style="--c:${t.color}">
      <span class="em">${esc(t.emoji)}</span>
      <div class="inf"><b>${esc(t.name)}</b>
        <small>${MODES[t.mode]} · ${desc(t)}${t.mode === "duration" && t.unit ? ` · ${esc(t.unit)}` : ""}</small>
      </div>
      <div class="ctl">
        <button class="btn sm ghost" data-act="hist" data-id="${t.id}">History</button>
        <button class="btn sm ghost" data-act="edit" data-id="${t.id}">Edit</button>
        <button class="btn sm danger" data-act="del" data-id="${t.id}">Delete</button>
      </div>
    </div>`).join("")}
  </div>` : `
  <div class="empty">${chip()}
    <p>Nothing here yet.</p>
    <button class="btn" data-act="seed">Try sample tasks</button>
  </div>`)
}

function render() {
  $("#app").innerHTML = S.tab === "cal" ? calView() : S.tab === "prog" ? progView() : tasksView();
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.d === S.tab));
  $("#fbtn").textContent = FS.dir ? "📁 Linked ✓" : "📁 Link folder"
}

/* ---------- task form & history ---------- */
const opts = (a, v) => a.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("");
function form(t) {
  const n = !t;
  t = t || { name: "", emoji: "🌰", color: COL[0], mode: "check", unit: "", goal: "", recur: { type: "daily", days: [1, 2, 3, 4, 5], mdays: [1], every: 2 }, adh: { every: 2, unit: "weeks" }, start: D.today() };

  return `
  <div id="f" data-mode="${t.mode}" data-rt="${t.recur.type}" data-id="${n ? "" : t.id}" data-col="${t.color}">
    <h2>${n ? "New task" : "Edit task"}</h2>
    <label>Name<input id="f-name" value="${esc(t.name)}" maxlength="40" placeholder="Drink water"></label>
    <div class="fl">
      <label>Emoji<input id="f-em" value="${esc(t.emoji)}" maxlength="4"></label>
      <div class="lb">Color<div class="sw">${COL.map(c => `
        <button type="button" aria-label="${c}" data-act="pickcol" data-d="${c}" style="--c:${c}" class="${c === t.color ? "on" : ""}"></button>
        `).join("")}
      </div>
    </div>
  </div>

  <div class="lb">Tracking mode
    <div class="seg wide">${Object.entries(MODES).map(([k, v]) => `
      <button type="button" data-act="mode" data-d="${k}" class="${k === t.mode ? "on" : ""}">${v}</button>`).join("")}
    </div>
  </div>

  <div class="s-dur fl">
    <label>Unit<input id="f-unit" value="${esc(t.unit)}" placeholder="hours, min, kcal"></label>
    <label>Daily goal (optional)<input id="f-goal" type="number" step="any" value="${t.goal}"></label>
  </div>

  <div class="s-rec">
    <label>Repeats<select id="f-rt">${opts([["daily", "Every day"], ["weekly", "Certain weekdays"], ["monthly", "Days of the month"], ["interval", "Every N days"]], t.recur.type)}</select></label>
    <div class="rt-w wd" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 0].map(i => `
      <label class="dchip"><input type="checkbox" value="${i}" ${t.recur.days.includes(i) ? "checked" : ""}>
        <span>${WD[i]}</span>
      </label>`).join("")}
    </div>
    <label class="rt-m">Days of month (comma separated)<input id="f-md" value="${t.recur.mdays.join(", ")}"></label>
    <label class="rt-i">Every N days<input id="f-ev" type="number" min="1" value="${t.recur.every}"></label>
  </div>

  <div class="s-adh fl">
    <label>Repeat every<input id="f-ae" type="number" min="1" value="${t.adh.every}"></label>
    <label>Unit<select id="f-au">${opts([["days", "days"], ["weeks", "weeks"], ["months", "months"]], t.adh.unit)}</select></label>
  </div>

  <label>${t.mode === "adherence" ? "First due date" : "Start date"}<input id="f-st" type="date" value="${t.start}"></label>
  <div class="acts">
    <button class="btn ghost" data-act="close">Cancel</button>
    <button class="btn" data-act="save">Save task</button>
  </div>
</div>`
}

function saveForm() {
  const f = $("#f"), name = $("#f-name").value.trim(); if (!name) return toast("Give your task a name");
  const rt = $("#f-rt").value, days = [...f.querySelectorAll(".wd input:checked")].map(x => +x.value), md = $("#f-md").value.split(/[ ,]+/).map(Number).filter(n => n >= 1 && n <= 31);

  if (f.dataset.mode !== "adherence") {
    if (rt === "weekly" && !days.length) return toast("Pick at least one weekday");
    if (rt === "monthly" && !md.length) return toast("Add a day of the month")
  }

  const old = Store.tasks.find(x => x.id === f.dataset.id), t = {
    ...(old || { records: {}, meta: {} }), id: old ? old.id : "t" + Date.now().toString(36), name, emoji: $("#f-em").value || "🌰", color: f.dataset.col, mode: f.dataset.mode, unit: $("#f-unit").value.trim(), goal: $("#f-goal").value,
    recur: { type: rt, days, mdays: md, every: Math.max(1, +$("#f-ev").value || 1) }, adh: { every: Math.max(1, +$("#f-ae").value || 1), unit: $("#f-au").value }, start: $("#f-st").value || D.today()
  };
  old ? Store.tasks[Store.tasks.indexOf(old)] = t : Store.tasks.push(t); Store.save(t); Store.saveIndex(); $("#dlg").close(); render()
}

function hist(t) {
  const ks = Object.keys(t.records).sort(), td = D.today(), u = esc(t.unit);
  let ch, cap, st;

  if (t.mode === "adherence") {
    const cs = Logic.cycles(t).filter(c => c.done), ot = cs.filter(c => c.status === "ontime").length;
    st = `${cs.length} completions · ${cs.length ? Math.round(ot / cs.length * 100) : 0}% on time`;
    ch = chart(cs.slice(-12).map(c => ({ x: c.done, y: Math.max(0, c.late) })), { color: t.color });
    cap = "Days late per cycle (0 = on time)"
  } else {
    const sc = D.range(t.start, td).filter(d => Logic.entry(t, d)), dn = sc.filter(d => t.records[d]); st = `${ks.length} done · ${sc.length ? Math.round(dn.length / sc.length * 100) : 0}% of scheduled days`;

    if (t.mode === "duration") {
      const vs = ks.filter(d => t.records[d].v != null), sum = vs.reduce((s, d) => s + t.records[d].v, 0);
      st += ` · total ${+sum.toFixed(1)} ${t.unit} · avg ${vs.length ? +(sum / vs.length).toFixed(1) : 0}`;
      ch = chart(vs.slice(-30).map(d => ({ x: d, y: t.records[d].v })), { color: t.color });
      cap = `Logged ${t.unit || "values"} (last 30 entries)`
    } else {
      const w = D.wStart(td), pts = [...Array(12).keys()].reverse().map(i => {
        const s = D.add(w, -7 * i);
        return { x: s, y: D.range(s, D.add(s, 6)).filter(d => t.records[d]).length }
      });
      ch = chart(pts, { color: t.color }); cap = "Completions per week (last 12 weeks)"
    }
  }

  const cyc = t.mode === "adherence" ? Object.fromEntries(Logic.cycles(t).filter(c => c.done).map(c => [c.done, c])) : {};
  return `
  <div style="--c:${t.color}">
    <div class="th">
      <span class="em">${esc(t.emoji)}</span>
      <h2>${esc(t.name)}</h2>
      <button class="x" data-act="close" style="margin-left:auto">✕</button>
    </div>
    <small>${st}</small>${ch}
    <small class="cap">${cap}</small>
    <ul>
    ${ks.slice().reverse().slice(0, 60).map(d => `
      <li>
        <span>${lbl(d)}${t.records[d].v != null ? ` · <b>${t.records[d].v} ${u}</b>` : ""}${cyc[d] ? ` · ${{ ontime: "on time", late: "late " + cyc[d].late + "d", missed: "missed" }[cyc[d].status]}` : ""}</span>
        <button class="x" title="Remove record" data-act="delrec" data-id="${t.id}" data-d="${d}">✕</button>
      </li>`).join("") ||
    "<li><small>No records yet</small></li>"}</ul>
  </div>`
}

/* ---------- sample data ---------- */
// function seed() {
//   const td = D.today(), st = D.add(td, -40);
//   let k = 0;
//   const r = () => Math.abs(Math.sin(++k * 12.9898) * 43758.5453) % 1;

//   const mk = (name, emoji, color, mode, x) => ({
//     id: "s" + (++k) + Date.now().toString(36),
//     name,
//     emoji,
//     color,
//     mode,
//     unit: "",
//     goal: "",
//     recur: {
//       type: "daily",
//       days: [],
//       mdays: [],
//       every: 1
//     },
//     adh: { every: 1, unit: "weeks" },
//     start: st,
//     records: {},
//     meta: {},
//     ...x
//   });

//   const days = D.range(st, D.add(td, -1)), w = mk("Drink water", "💧", "#25e8ff", "check"), s = mk("Study", "📚", "#a77bff", "duration", { unit: "hours", goal: "2" }), x = mk("Workout", "🏃", "#b6ff3b", "duration", { unit: "min", goal: "30", recur: { type: "weekly", days: [1, 3, 5], mdays: [], every: 1 } });

//   days.forEach(d => {
//     if (r() < .75) w.records[d] = {};
//     if (r() < .8) s.records[d] = { v: +(1 + r() * 2.5).toFixed(1) };
//     if (Logic.sched(x, d) && r() < .85) x.records[d] = { v: 20 + Math.floor(r() * 40) }
//   });

//   const b = mk("Wash bedsheets", "🛏️", "#ff4fa3", "adherence", { adh: { every: 2, unit: "weeks" }, start: D.add(st, 10) }), n = mk("Trim nails", "💅", "#ffa63d", "adherence", { adh: { every: 10, unit: "days" }, start: D.add(st, 5) });
//   [10, 26].forEach(i => b.records[D.add(st, i)] = {});[5, 14, 27].forEach(i => n.records[D.add(st, i)] = {});
//   // Store.tasks.push(w, s, x, b, n); Store.tasks.forEach(t => Store.save(t)); Store.saveIndex(); render()
// }

/* ---------- events ---------- */
let armed;
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;

  const { act, id, d } = b.dataset, t = id && Store.tasks.find(x => x.id === id), dlg = $("#dlg"), f = $("#f");
  const step = n => {
    const v = S.view;
    return v === "month" ? D.addM(S.cur, n) : D.add(S.cur, n * (v === "week" ? 7 : 1))
  };

  const A = {
    tab: () => { S.tab = d },
    view: () => { S.view = d },
    nav: () => { S.cur = S.sel = step(+d) },
    today: () => { S.cur = S.sel = D.today() },
    sel: () => { S.sel = S.cur = d },
    pm: () => { S.pm = d },
    pnav: () => { S.pc = S.pm === "week" ? D.add(S.pc, 7 * d) : D.addM(S.pc, +d) },
    toggle: () => {
      if (d > D.today()) return;
      t.records[d] ? delete t.records[d] : t.records[d] = {};
      Store.save(t)
    },
    logv: () => {
      const v = parseFloat($("#v-" + id).value);
      if (!(v >= 0)) return toast("Enter a number first");
      t.records[d] = { v };
      Store.save(t)
    },
    new: () => {
      dlg.innerHTML = form();
      dlg.showModal(); return 1
    },
    edit: () => {
      dlg.innerHTML = form(t);
      dlg.showModal();
      return 1
    },
    hist: () => {
      dlg.innerHTML = hist(t);
      dlg.showModal();
      return 1
    },
    close: () => {
      dlg.close();
      return 1
    },
    save: () => { saveForm(); return 1 },
    // seed: () => { seed(); return 1 },
    folder: () => { linkFolder(); return 1 },
    pickcol: () => { f.dataset.col = d; f.querySelectorAll(".sw button").forEach(x => x.classList.toggle("on", x.dataset.d === d)); return 1 },
    mode: () => { f.dataset.mode = d; f.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x.dataset.d === d)); return 1 },
    delrec: () => { delete t.records[d]; Store.save(t); dlg.innerHTML = hist(t) },
    del: () => {
      if (b.dataset.arm) {
        Store.del(id);
        return
      }
      b.dataset.arm = 1;
      b.textContent = "Sure?";

      clearTimeout(armed);

      armed = setTimeout(() => {
        b.removeAttribute("data-arm");
        b.textContent = "Delete"
      }, 3000);

      return 1
    }
  };

  if (A[act]() !== 1 || act === "delrec") render()
});

document.addEventListener("change", e => { if (e.target.id === "f-rt") $("#f").dataset.rt = e.target.value });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".ctl input")) e.target.nextElementSibling.click() });

(async () => {
  Store.load();
  render();
  try {
    const h = await idb("readonly", s => s.get("dir"));
    if (h) {
      S.pend = h;
      if (await h.queryPermission({ mode: "readwrite" }) === "granted") await pull(h)
    }
    render()
  } catch (e) { }
}
)();
