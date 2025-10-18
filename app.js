// --- Fantasy Basketball Draft Tool - Minimal Working JS ---
// Loads CSV, applies points weights, removes drafted players, renders a BPA table.

(async function () {
  const $ = (sel) => document.querySelector(sel);
  const valNum = (id, fallback = 0) => {
    const el = $(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  };

  const els = {
    file:    $("#csvFile") || document.querySelector('input[type="file"]'),
    board:   $("#board")   || document.getElementById("board"),
    preview: $("#preview") || document.getElementById("preview"),
    avail:   $("#avail")   || document.getElementById("avail"),
    drafted: $("#drafted") || document.getElementById("drafted"),
    recompute: $("#recompute") || document.getElementById("recompute"),
    weights: {
      pts: $("#wPTS") || document.getElementById("wPTS"),
      reb: $("#wREB") || document.getElementById("wREB"),
      ast: $("#wAST") || document.getElementById("wAST"),
      stl: $("#wSTL") || document.getElementById("wSTL"),
      blk: $("#wBLK") || document.getElementById("wBLK"),
      tpm: $("#w3PM") || document.getElementById("w3PM"),
      tov: $("#wTOV") || document.getElementById("wTOV"),
    },
  };

  // Provide defaults if inputs don’t exist in your HTML
  function getWeights() {
    return {
      pts: els.weights.pts ? parseFloat(els.weights.pts.value) : 0.75,
      reb: els.weights.reb ? parseFloat(els.weights.reb.value) : 1.0,
      ast: els.weights.ast ? parseFloat(els.weights.ast.value) : 1.2,
      stl: els.weights.stl ? parseFloat(els.weights.stl.value) : 2.0,
      blk: els.weights.blk ? parseFloat(els.weights.blk.value) : 2.0,
      tpm: els.weights.tpm ? parseFloat(els.weights.tpm.value) : 0.5,
      tov: els.weights.tov ? parseFloat(els.weights.tov.value) : 1.0, // penalty
    };
  }

  // Simple CSV parser (no quotes-in-quote edge cases; works for our file format)
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(",").map(h => h.trim().toLowerCase());
    const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
    const toNum = (x) => {
      const n = parseFloat(x);
      return Number.isFinite(n) ? n : 0;
    };
    const rows = lines.map(line => {
      const cells = line.split(",").map(x => x.trim());
      return {
        player: cells[idx.player] || "",
        team: cells[idx.team] || "",
        pos: cells[idx.pos] || "",
        gp: toNum(cells[idx.gp]),
        min: toNum(cells[idx.min]),
        pts: toNum(cells[idx.pts]),
        reb: toNum(cells[idx.reb]),
        ast: toNum(cells[idx.ast]),
        stl: toNum(cells[idx.stl]),
        blk: toNum(cells[idx.blk]),
        tpm: toNum(cells[idx.tpm]),
        tov: toNum(cells[idx.tov]),
        fga: idx.fga != null ? toNum(cells[idx.fga]) : 0,
        fta: idx.fta != null ? toNum(cells[idx.fta]) : 0,
        fg:  idx.fg  != null ? toNum(cells[idx.fg])  : 0,
        ft:  idx.ft  != null ? toNum(cells[idx.ft])  : 0,
        adp: idx.adp != null ? toNum(cells[idx.adp]) : 999,
      };
    });
    return rows.filter(r => r.player);
  }

  async function fetchDefaultCSV() {
    // Try local path first
    try {
      const res = await fetch("data/projections.csv", { cache: "no-store" });
      if (!res.ok) throw new Error("fetch projections.csv failed");
      const text = await res.text();
      return parseCSV(text);
    } catch (e) {
      // Fallback: fetch raw GitHub (change USER/REPO if you renamed)
      const raw = "https://raw.githubusercontent.com/TheEarleBird/fantasy-basketball-draft/main/data/projections.csv";
      const res2 = await fetch(raw, { cache: "no-store" });
      if (!res2.ok) throw new Error("fallback fetch failed");
      const text2 = await res2.text();
      return parseCSV(text2);
    }
  }

  async function loadCSVFromPicker() {
    const f = els.file && els.file.files && els.file.files[0];
    if (!f) return null;
    const text = await f.text();
    return parseCSV(text);
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
    const body = rows.map(r=>`
      <tr>
        <td>${r.player}</td><td>${r.team}</td><td>${r.pos}</td>
        <td>${r.pts.toFixed(1)}</td><td>${r.reb.toFixed(1)}</td><td>${r.ast.toFixed(1)}</td>
        <td>${r.stl.toFixed(1)}</td><td>${r.blk.toFixed(1)}</td><td>${r.tpm.toFixed(1)}</td><td>${r.tov.toFixed(1)}</td>
        <td><b>${r.total.toFixed(2)}</b></td><td><span class="badge tier-${r.tier}">T${r.tier}</span></td>
      </tr>`).join("");
    target.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
  }

  function computeTotals(rows) {
    const w = getWeights();
    // compute simple points total using weights (TOV is a penalty)
    rows.forEach(r => {
      r.total = (r.pts*w.pts) + (r.reb*w.reb) + (r.ast*w.ast) + (r.stl*w.stl) + (r.blk*w.blk) + (r.tpm*w.tpm) - (r.tov*w.tov);
    });
    // tiers by z-bands (rough, based on total)
    const scores = rows.map(r=>r.total);
    const mean = scores.reduce((a,b)=>a+b,0)/scores.length || 0;
    const std = Math.sqrt(scores.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(scores.length||1)) || 1;
    rows.forEach(r => {
      const z = (r.total - mean)/std;
      r.tier = z>=1.2?1: z>=0.5?2: z>=0?3: z>=-0.5?4: z>=-1.0?5:6;
    });
    rows.sort((a,b)=>b.total - a.total);
    return rows;
  }

  function applyDraftedFilter(rows) {
    if (!els.drafted) return rows;
    const names = (els.drafted.value || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    if (!names.length) return rows;
    return rows.filter(r => !names.includes(r.player.toLowerCase()));
  }

  async function recompute() {
    // load from file picker if provided; else from repo
    let rows = await loadCSVFromPicker();
    if (!rows) rows = await fetchDefaultCSV();

    // expose for debugging
    window.data = rows;

    // Update preview
    if (els.preview) {
      els.preview.innerHTML = `<div class="small">${rows.length} players loaded.</div>`;
    }

    // remove drafted
    rows = applyDraftedFilter(rows);

    // score and render
    const scored = computeTotals(rows).slice(0, 50);
    renderTable(els.board, scored);

    // simple availability panel placeholder
    if (els.avail) {
      els.avail.innerHTML = `<div class="small">Availability model coming soon. For now, board is sorted by your scoring weights.</div>`;
    }
  }

  // Hook up button
  if (els.recompute) els.recompute.addEventListener("click", recompute);

  // Auto-run once on load (helps when using repo default CSV)
  try { await recompute(); } catch(e) { console.error(e); }

  console.log("Fantasy Basketball Draft Tool ready");
})();
