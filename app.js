// Minimal, known-working loader + scorer + renderer.
// Exposes window.recompute() and window.debugDump() for console tests.

(function () {
  const $ = (s) => document.querySelector(s);

  // ==== DOM LOOKUPS (must match your HTML IDs) ====
  const els = {
    file: $("#csvFile") || document.querySelector('input[type="file"]'),
    board: $("#board"),
    preview: $("#preview"),
    avail: $("#avail"),
    drafted: $("#drafted"),
    btn: $("#recompute") || document.getElementById("recompute"),
    weights: {
      pts: document.getElementById("wPTS"),
      reb: document.getElementById("wREB"),
      ast: document.getElementById("wAST"),
      stl: document.getElementById("wSTL"),
      blk: document.getElementById("wBLK"),
      tpm: document.getElementById("w3PM"),
      tov: document.getElementById("wTOV"),
    },
  };

  // Fallback weights if the inputs aren’t in the DOM
  function getWeights() {
    const get = (el, def) => (el ? parseFloat(el.value) : def);
    return {
      pts: get(els.weights.pts, 0.75),
      reb: get(els.weights.reb, 1.0),
      ast: get(els.weights.ast, 1.2),
      stl: get(els.weights.stl, 2.0),
      blk: get(els.weights.blk, 2.0),
      tpm: get(els.weights.tpm, 0.5),
      tov: get(els.weights.tov, 1.0),
    };
  }

  // Very simple CSV parser (our file format is clean)
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(",").map(h => h.trim().toLowerCase());
    const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
    const num = (v) => (v===""||v==null?0: (Number(v)||0));
    const rows = lines.map(line => {
      const cells = line.split(",").map(c => c.trim());
      return {
        player: cells[idx.player] || "",
        team:   cells[idx.team] || "",
        pos:    cells[idx.pos] || "",
        gp:  num(cells[idx.gp]),
        min: num(cells[idx.min]),
        pts: num(cells[idx.pts]),
        reb: num(cells[idx.reb]),
        ast: num(cells[idx.ast]),
        stl: num(cells[idx.stl]),
        blk: num(cells[idx.blk]),
        tpm: num(cells[idx.tpm]),
        tov: num(cells[idx.tov]),
        fga: idx.fga!=null?num(cells[idx.fga]):0,
        fta: idx.fta!=null?num(cells[idx.fta]):0,
        fg:  idx.fg !=null?num(cells[idx.fg]):0,
        ft:  idx.ft !=null?num(cells[idx.ft]):0,
        adp: idx.adp!=null?num(cells[idx.adp]):999
      };
    }).filter(r => r.player);
    return rows;
  }

  async function fetchDefaultCSV() {
    // Try repo path
    try {
      const res = await fetch("data/projections.csv", { cache: "no-store" });
      if (!res.ok) throw new Error("local fetch failed");
      return parseCSV(await res.text());
    } catch {
      // Fallback raw GitHub URL (adjust if you rename)
      const url = "https://raw.githubusercontent.com/TheEarleBird/fantasy-basketball-draft/main/data/projections.csv";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("raw fetch failed");
      return parseCSV(await res.text());
    }
  }

  async function loadCSVFromPicker() {
    try {
      const f = els.file && els.file.files && els.file.files[0];
      if (!f) return null;
      return parseCSV(await f.text());
    } catch (e) {
      console.error("picker load error", e);
      return null;
    }
  }

 function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")                 // split accents
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\s+/g, " ")            // collapse spaces
    .trim();
}

function applyDrafted(rows) {
  if (!els.drafted) return rows;

  // support commas OR newlines
  const raw = (els.drafted.value || "")
    .split(/,|\n/).map(s => s.trim()).filter(Boolean);

  // normalize all drafted names once
  const draftedSet = new Set(raw.map(normalizeName));

  if (!draftedSet.size) return rows;

  return rows.filter(r => !draftedSet.has(normalizeName(r.player)));
}


  function computeTotals(rows) {
    const w = getWeights();
    rows.forEach(r => {
      r.total = (r.pts*w.pts) + (r.reb*w.reb) + (r.ast*w.ast)
              + (r.stl*w.stl) + (r.blk*w.blk) + (r.tpm*w.tpm)
              - (r.tov*w.tov);
    });
    const scores = rows.map(r=>r.total);
    const mean = scores.reduce((a,b)=>a+b,0)/(scores.length||1);
    const std  = Math.sqrt(scores.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(scores.length||1)) || 1;
    rows.forEach(r => {
      const z = (r.total - mean)/std;
      r.tier = z>=1.2?1: z>=0.5?2: z>=0?3: z>=-0.5?4: z>=-1?5:6;
    });
    rows.sort((a,b)=>b.total - a.total);
    return rows;
  }

  function renderTable(target, rows) {
    if (!target) return;
    if (!rows || !rows.length) {
      target.innerHTML = `<div class="small">No rows to display.</div>`;
      return;
    }
    const head = `
      <thead><tr>
        <th>Player</th><th>Team</th><th>Pos</th>
        <th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TOV</th>
        <th>Total</th><th>Tier</th>
      </tr></thead>`;
    const body = rows.slice(0,50).map(r=>`
      <tr>
        <td>${r.player}</td><td>${r.team}</td><td>${r.pos}</td>
        <td>${r.pts.toFixed(1)}</td><td>${r.reb.toFixed(1)}</td><td>${r.ast.toFixed(1)}</td>
        <td>${r.stl.toFixed(1)}</td><td>${r.blk.toFixed(1)}</td><td>${r.tpm.toFixed(1)}</td><td>${r.tov.toFixed(1)}</td>
        <td><b>${r.total.toFixed(2)}</b></td><td><span class="badge tier-${r.tier}">T${r.tier}</span></td>
      </tr>`).join("");
    target.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
  }

  async function recompute() {
    // 1) Load
    let rows = await loadCSVFromPicker();
    if (!rows) rows = await fetchDefaultCSV();

    // expose for console debug
    window.data = rows;

    // 2) Preview
    if (els.preview) els.preview.innerHTML = `<div class="small">${rows.length} players loaded.</div>`;

    // 3) Apply drafted filter
    rows = applyDrafted(rows);

    // 4) Score + render
    const scored = computeTotals(rows);
    renderTable(els.board, scored);

    // availability placeholder
    if (els.avail) els.avail.innerHTML = `<div class="small">Sorted by your Sleeper weights.</div>`;
  }

  // Wire button
  if (els.btn) els.btn.addEventListener("click", recompute);

  // Expose for console
  window.recompute = recompute;
  window.debugDump = () => console.log(window.data ? window.data.slice(0,5) : "No data");

  // Auto-run once on load (so repo CSV shows without clicking)
  recompute().catch(console.error);

  console.log("Draft tool JS loaded (v6)");
})();
