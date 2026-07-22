
(function () {
  const DAY = 86400000;

  // ---------- categories ----------
  const categories = {
    residence:    { label: "Residence",    color: "#6c85a6", exclusive: true,  icon: "🏠", visibility: "private" },
    job:          { label: "Job",          color: "#b8734f", exclusive: true,  icon: "💼", visibility: "private" },
    project:      { label: "Project",      color: "#d9a26a", exclusive: false, icon: "📌", visibility: "private" },
    relationship: { label: "Relationship", color: "#a9707a", exclusive: true,  icon: "❤",  visibility: "private" },
    possession:   { label: "Possession",   color: "#7a9b76", exclusive: false, icon: "🚲", visibility: "private" },
    membership:   { label: "Membership",   color: "#5f9088", exclusive: false, icon: "🎫", visibility: "private" },
    travel:       { label: "Travel",       color: "#8a6a92", exclusive: false, icon: "✈",  visibility: "private" },
    world:        { label: "World",        color: "#8f9aa6", exclusive: false, icon: "🌐", visibility: "shareable" },
  };
  const ICON_QUICKPICKS = ["🏠","💼","📌","❤","🚲","🎫","✈","🌐","🎓","👶","🎂","⭐"];

  function d(y, m, day) { return Date.UTC(y, m - 1, day || 1); }

  // ---------- people (special entities: can gate "inactive" time, show live age,
  // and are the future unit of import/subscription for someone else's "Me" timeline) ----------
  const people = {
    me:   { label: "Me",   birthDate: d(1988, 3, 14) },
    finn: { label: "Finn", birthDate: d(2021, 6, 11) },
  };
  function ageYears(birthMs) { return Math.floor((Date.now() - birthMs) / (365.2425 * DAY)); }
  function personLabelWithAge(personId) {
    const p = people[personId];
    if (!p) return "";
    return p.birthDate != null ? `${p.label} · ${ageYears(p.birthDate)}y` : p.label;
  }

  // ---------- groups (user-addable top level) ----------
  // a group with personId=X means the whole group *is* that person (e.g. "Me");
  // a group without personId can nest multiple person sub-groups (e.g. "Family" -> Finn),
  // which is also where someone else's shared/subscribed "Me" timeline would eventually attach.
  const groups = [
    { id: "me",     label: "Me",     personId: "me", collapsed: false },
    { id: "family", label: "Family", collapsed: false },
    { id: "work",   label: "Work",   collapsed: false },
    { id: "world",  label: "World",  collapsed: false },
  ];

  const rows = [
    { id: "r-residence", groupId: "me", cat: "residence", label: "Residence", entries: [
      { id:"e1", title:"Munich", start:{t:d(2011,9), p:"month"}, end:{t:d(2015,7), p:"month"}, desc:"Studied and lived in the Schwabing district.", links:["University of Munich"] },
      { id:"e2", title:"Berlin", start:{t:d(2015,8), p:"month"}, end:{t:d(2021,2), p:"month"}, desc:"First flat share, then moved in with Maren.", links:["Maren Voss"] },
      { id:"e3", title:"Hamburg", start:{t:d(2021,3), p:"month"}, end:null, desc:"Current home, near the Elbe.", links:[] },
    ]},
    { id: "r-relationship", groupId: "me", cat: "relationship", label: "Relationship", entries: [
      { id:"e8", title:"Lena", start:{t:d(2013,4), p:"circa"}, end:{t:d(2015,6), p:"month"}, desc:"Met during a semester abroad.", links:[] },
      { id:"e9", title:"Maren Voss", start:{t:d(2017,10), p:"day", day:d(2017,10,3)}, end:null, desc:"Met at a friend's birthday.", links:["Berlin","Kestrel Labs"], fadeIn: 60 },
    ]},
    { id: "r-possession", groupId: "me", cat: "possession", label: "Car / Bike", entries: [
      { id:"e10", title:"VW Golf Mk5", start:{t:d(2014,5), p:"month"}, end:{t:d(2020,9), p:"month"}, desc:"Bought used from a neighbor.", links:[] },
      { id:"e11", title:"Gravel bike", start:{t:d(2020,10), p:"month"}, end:null, desc:"", links:[] },
    ]},
    { id: "r-membership", groupId: "me", cat: "membership", label: "Memberships", entries: [
      { id:"e12", title:"Kletterzentrum Süd", start:{t:d(2016,1), p:"year"}, end:{t:d(2019,1), p:"year"}, desc:"Climbing gym membership.", links:[] },
      { id:"e13", title:"ADAC", start:{t:d(2014,6), p:"month"}, end:null, desc:"", links:[] },
    ]},
    { id: "r-travel", groupId: "me", cat: "travel", label: "Travel", entries: [
      { id:"e14", title:"Japan", start:{t:d(2018,10), p:"day", day:d(2018,10,4)}, end:{t:d(2018,10,20), p:"day"}, desc:"Three weeks, mostly Kansai.", links:[] },
      { id:"e15", title:"Portugal", start:{t:d(2023,5), p:"day", day:d(2023,5,2)}, end:{t:d(2023,5,15), p:"day"}, desc:"With Maren.", links:["Maren Voss"] },
    ]},

    { id: "r-son-residence", groupId: "family", personId: "finn", cat: "residence", label: "Residence", entries: [
      { id:"e16", title:"Hamburg", start:{t:d(2021,6), p:"day", day:d(2021,6,11)}, end:null, desc:"Born and raised here so far.", links:[] },
    ]},
    { id: "r-son-milestones", groupId: "family", personId: "finn", cat: "membership", label: "Milestones", entries: [
      { id:"e17", title:"Kita Sonnenblume", start:{t:d(2023,8), p:"month"}, end:null, desc:"Started daycare.", links:[] },
    ]},

    { id: "r-job", groupId: "work", cat: "job", label: "Job", entries: [
      { id:"e4", title:"Junior Dev, Loop GmbH", start:{t:d(2015,9), p:"month"}, end:{t:d(2018,12), p:"month"}, desc:"First job out of university.", links:[] },
      { id:"e5", title:"Kestrel Labs", start:{t:d(2019,1), p:"day", day:d(2019,1,14)}, end:null, desc:"Joined as the third engineer.", links:["Maren Voss"], fadeIn: 20 },
    ]},
    { id: "r-project", groupId: "work", cat: "project", label: "Projects at Kestrel", parentRowId: "r-job", entries: [
      { id:"e6", title:"Payments rewrite", start:{t:d(2020,2), p:"month"}, end:{t:d(2020,11), p:"month"}, desc:"Led the migration off the legacy billing engine.", links:[], parent:"e5" },
      { id:"e7", title:"Realtime sync", start:{t:d(2022,3), p:"circa"}, end:null, desc:"Ongoing — websocket infrastructure.", links:[], parent:"e5" },
    ]},

    { id: "r-world-chancellor", groupId: "world", cat: "world", label: "German Chancellor", entries: [
      { id:"e18", title:"Angela Merkel", start:{t:d(2005,11,22), p:"day"}, end:{t:d(2021,12,8), p:"day"}, desc:"4th term chancellor.", links:[] },
      { id:"e19", title:"Olaf Scholz", start:{t:d(2021,12,8), p:"day"}, end:null, desc:"", links:[] },
    ]},
    { id: "r-world-iphone", groupId: "world", cat: "world", label: "Latest iPhone", entries: [
      { id:"e20", title:"iPhone 6", start:{t:d(2014,9,19), p:"day"}, end:{t:d(2015,9,25), p:"day"}, desc:"", links:[] },
      { id:"e21", title:"iPhone 11", start:{t:d(2019,9,20), p:"day"}, end:{t:d(2020,10,23), p:"day"}, desc:"", links:[] },
      { id:"e22", title:"iPhone 15", start:{t:d(2023,9,22), p:"day"}, end:null, desc:"", links:[] },
    ]},
    { id: "r-world-covid", groupId: "world", cat: "world", label: "COVID measures (DE)", entries: [
      { id:"e23", title:"Contact restrictions", start:{t:d(2020,3), p:"month"}, end:{t:d(2020,5), p:"month"}, desc:"First lockdown.", links:[] },
      { id:"e24", title:"2G/3G rules", start:{t:d(2021,11), p:"circa"}, end:{t:d(2022,3), p:"circa"}, desc:"", links:[] },
    ]},
  ];

  const entryByTitle = {};
  rows.forEach(r => r.entries.forEach(e => entryByTitle[e.title] = e));
  rows.forEach(r => r.entries.forEach(e => {
    e.row = r.id;
    e.linkedEntryIds = (e.links || []).map(t => entryByTitle[t] ? entryByTitle[t].id : null).filter(Boolean);
  }));
  rows.forEach(r => r.entries.forEach(e => {
    if (e.parent) {
      const parentEntry = rows.flatMap(x=>x.entries).find(x=>x.id===e.parent);
      if (parentEntry) {
        e.linkedEntryIds.push(parentEntry.id);
        parentEntry.linkedEntryIds = parentEntry.linkedEntryIds || [];
        parentEntry.linkedEntryIds.push(e.id);
      }
    }
  }));

  const rowVisible = {};
  rows.forEach(r => rowVisible[r.id] = true);

  const view = {
    startMs: d(2009,1),
    pxPerDay: 0.9,
    scrollY: 0,
    selected: null,
    selectedRowId: null,   // a timeline the user selected by clicking its empty space — shows its + affordances
    selectedRowClickX: null, // where they clicked, used as the anchor when that row has no entries yet
    query: "",
    picking: null,       // { onPick: fn(ms) }
    pickHoverX: null,
  };
  let panelState = null; // { mode:'view'|'edit'|'new', entry, context }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const PRECISION_FUZZ_DAYS = { exact: 0, day: 0, month: 15, year: 182, circa: 365 };
  const PRECISION_LIST = [
    { key: "exact", glyph: "◆", txt: "Exact" },
    { key: "day",   glyph: "●", txt: "Day" },
    { key: "month", glyph: "◐", txt: "Month" },
    { key: "year",  glyph: "○", txt: "Year" },
    { key: "circa", glyph: "≈", txt: "Circa" },
  ];

  function entryStartMs(e) { return e.start.day !== undefined ? e.start.day : e.start.t; }
  function entryEndMs(e) { return e.end ? (e.end.day !== undefined ? e.end.day : e.end.t) : Date.now(); }

  // ---------- canvas ----------
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const wrap = document.getElementById("canvasWrap");
  const rail = document.getElementById("rail");
  const railInner = document.getElementById("railInner");
  const HEADER_H = 34, ROW_H = 34, SUB_ROW_H = 26, ROW_GAP = 8, SUB_GAP = 3;
  const GROUP_HEADER_H = 30, PERSON_HEADER_H = 26, GROUP_GAP_AFTER = 14, PERSON_GAP_AFTER = 8;

  function isMobile() { return window.innerWidth <= 760; }
  function railWidth() { return isMobile() ? 108 : 220; }

  function rowsInGroup(gid) { return rows.filter(r => r.groupId === gid && !r.parentRowId); }
  function subRowsOf(rowId) { return rows.filter(r => r.parentRowId === rowId); }
  // the person a row's "inactive before birth" / age treatment resolves to:
  // either the group IS a person (e.g. "Me"), or the row was explicitly assigned one (e.g. Finn's rows)
  function resolvePersonId(row, group) { return group.personId || row.personId || null; }

  // returns ordered list of layout items:
  //  {type:'group', group, y, h} | {type:'person', personId, group, y, h} | {type:'row', row, y, h, isSub, personId}
  function computeLayout() {
    let y = 0;
    const items = [];
    groups.forEach(g => {
      const label = g.personId ? personLabelWithAge(g.personId) : g.label;
      items.push({ type: "group", group: g, y, h: GROUP_HEADER_H, label });
      y += GROUP_HEADER_H;
      if (!g.collapsed) {
        if (g.personId) {
          y = layoutRowsBlock(items, rowsInGroup(g.id), g, g.personId, y);
        } else {
          // cluster this group's direct rows by distinct personId (e.g. Family -> Finn),
          // rows without a personId render directly under the group with no person sub-header
          const directRows = rowsInGroup(g.id);
          let i = 0;
          while (i < directRows.length) {
            const pid = directRows[i].personId;
            if (pid) {
              let j = i; const block = [];
              while (j < directRows.length && directRows[j].personId === pid) { block.push(directRows[j]); j++; }
              items.push({ type: "person", personId: pid, group: g, y, h: PERSON_HEADER_H });
              y += PERSON_HEADER_H;
              y = layoutRowsBlock(items, block, g, pid, y);
              y += PERSON_GAP_AFTER;
              i = j;
            } else {
              y = layoutRowsBlock(items, [directRows[i]], g, null, y);
              i++;
            }
          }
        }
        y += GROUP_GAP_AFTER;
      }
    });
    return { items, totalH: y };
  }
  function layoutRowsBlock(items, rowList, group, personId, y) {
    rowList.forEach(r => {
      items.push({ type: "row", row: r, y, h: ROW_H, isSub: false, personId });
      y += ROW_H + ROW_GAP;
      subRowsOf(r.id).forEach(sr => {
        items.push({ type: "row", row: sr, y, h: SUB_ROW_H, isSub: true, parentRowId: r.id, personId });
        y += SUB_ROW_H + SUB_GAP;
      });
    });
    return y;
  }

  function maxScrollY() {
    const { totalH } = computeLayout();
    const visibleH = wrap.clientHeight - HEADER_H;
    return Math.max(0, totalH - visibleH);
  }
  function clampScroll() { view.scrollY = Math.min(maxScrollY(), Math.max(0, view.scrollY)); }

  function xForMs(ms) { return railWidth() + (ms - view.startMs) / DAY * view.pxPerDay; }
  function msForX(x) { return view.startMs + (x - railWidth()) / view.pxPerDay * DAY; }

  function resize() {
    document.documentElement.style.setProperty("--rail-w", railWidth() + "px");
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clampScroll();
    buildRail();
    draw();
  }

  function fmtDate(part) {
    if (!part) return "ongoing";
    const ms = part.day !== undefined ? part.day : part.t;
    const dt = new Date(ms);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (part.p === "day") return dt.getUTCDate() + " " + months[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
    if (part.p === "month") return months[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
    if (part.p === "year") return String(dt.getUTCFullYear());
    if (part.p === "circa") return "circa " + dt.getUTCFullYear();
    return dt.toISOString();
  }
  function fmtMs(ms) {
    const dt = new Date(ms);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return dt.getUTCDate() + " " + months[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
  }

  function matchesQuery(e) {
    if (!view.query) return true;
    const q = view.query.toLowerCase();
    return e.title.toLowerCase().includes(q) || (e.desc||"").toLowerCase().includes(q) || (e.links||[]).some(l=>l.toLowerCase().includes(q));
  }

  // ========== DRAW ==========
  let addButtons = []; // quick-add hotspots (create mode)
  let positions = {};  // entry id -> screen rect

  function draw() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const RAIL_W = railWidth();
    railInner.style.transform = `translateY(${HEADER_H - view.scrollY}px)`;
    ctx.clearRect(0, 0, w, h);
    const bg = css("--bg"), panelLine = css("--panel-line"), text = css("--text"), textDim = css("--text-dim"), accent = css("--accent");

    drawTimeAxis(w, h, RAIL_W, panelLine, text, textDim);

    const { items } = computeLayout();
    positions = {}; addButtons = [];
    const selectedEntry = view.selected;
    const connectedIds = new Set();
    if (selectedEntry) { connectedIds.add(selectedEntry.id); (selectedEntry.linkedEntryIds||[]).forEach(id=>connectedIds.add(id)); }

    ctx.save();
    ctx.beginPath(); ctx.rect(RAIL_W, HEADER_H, w - RAIL_W, h - HEADER_H); ctx.clip();

    drawSubConnectors(items, h);

    items.forEach(it => {
      if (it.type !== "row") return;
      const screenY = HEADER_H + (it.y - view.scrollY);
      if (screenY + it.h < HEADER_H || screenY > h) return;
      const row = it.row;
      const rowColor = categories[row.cat].color;
      const visible = rowVisible[row.id];
      const entriesSorted = row.entries.slice().sort((a,b)=>entryStartMs(a)-entryStartMs(b));

      if (row.id === view.selectedRowId) {
        ctx.save();
        ctx.fillStyle = css("--accent"); ctx.globalAlpha = 0.05;
        ctx.fillRect(RAIL_W, screenY, w - RAIL_W, it.h);
        ctx.restore();
      }

      if (visible && it.personId && people[it.personId] && people[it.personId].birthDate != null) {
        const birthX = xForMs(people[it.personId].birthDate);
        if (birthX > RAIL_W) drawInactiveBand(RAIL_W, screenY, Math.min(birthX, w) - RAIL_W, it.h);
      }

      entriesSorted.forEach(e => {
        const x1 = xForMs(entryStartMs(e)), x2 = xForMs(entryEndMs(e));
        if (x2 < RAIL_W - 30 || x1 > w + 30) { positions[e.id] = null; }
        else {
          positions[e.id] = { x1, x2, y: screenY, h: it.h, color: rowColor };
          if (visible) {
            let alpha = 1;
            if (view.query && !matchesQuery(e)) alpha = 0.15;
            else if (selectedEntry && !connectedIds.has(e.id)) alpha = 0.22;
            drawBar(x1, x2, screenY, it.h, rowColor, e, alpha, w, RAIL_W);
          } else {
            drawBar(x1, x2, screenY, it.h, rowColor, e, 0.08, w, RAIL_W);
          }
        }
      });

      if (row.id === view.selectedRowId && visible) {
        drawQuickAdds(row, entriesSorted, screenY, it.h, w, RAIL_W);
      }
    });

    if (selectedEntry) {
      ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.setLineDash([4,3]);
      (selectedEntry.linkedEntryIds||[]).forEach(id => {
        const a = positions[selectedEntry.id], b = positions[id];
        if (!a || !b) return;
        const ax=(a.x1+a.x2)/2, ay=a.y+a.h/2, bx=(b.x1+b.x2)/2, by=b.y+b.h/2;
        ctx.beginPath(); ctx.moveTo(ax,ay); ctx.bezierCurveTo(ax,(ay+by)/2,bx,(ay+by)/2,bx,by); ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // date-picking guide line
    if (view.picking && view.pickHoverX != null) {
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(view.pickHoverX, HEADER_H); ctx.lineTo(view.pickHoverX, h); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawSubConnectors(items, h) {
    const accent = css("--panel-line");
    let i = 0;
    while (i < items.length) {
      if (items[i].type === "row" && items[i].isSub) {
        const parentId = items[i].parentRowId;
        let j = i;
        while (j < items.length && items[j].type === "row" && items[j].isSub && items[j].parentRowId === parentId) j++;
        const firstSub = items[i], lastSub = items[j-1];
        const parentItem = items.slice(0, i).reverse().find(it => it.type==="row" && it.row.id === parentId);
        if (parentItem) {
          const parentRow = parentItem.row;
          const allSubEntries = [];
          for (let k=i;k<j;k++) allSubEntries.push(...items[k].row.entries);
          if (allSubEntries.length) {
            const earliestMs = Math.min(...allSubEntries.map(entryStartMs));
            const x = xForMs(earliestMs);
            const parentScreenY = HEADER_H + (parentItem.y - view.scrollY);
            const lastSubScreenY = HEADER_H + (lastSub.y - view.scrollY) + lastSub.h;
            ctx.save();
            ctx.strokeStyle = css("--accent");
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, parentScreenY + parentItem.h/2);
            ctx.lineTo(x, lastSubScreenY);
            ctx.stroke();
            // notch cut across the parent bar
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x-4, parentScreenY + parentItem.h*0.22);
            ctx.lineTo(x+4, parentScreenY + parentItem.h*0.78);
            ctx.stroke();
            ctx.restore();
          }
        }
        i = j;
      } else i++;
    }
  }

  function drawQuickAdds(row, entriesSorted, y, h, w, RAIL_W) {
    const accent = css("--accent");
    const cy = y + h/2;
    function addBtn(x, ctxData) {
      if (x < RAIL_W - 10 || x > w + 10) return;
      addButtons.push({ x, y: cy, r: 9, ctxData });
      ctx.save();
      ctx.fillStyle = accent; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(x, cy, 8, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = css("--ink-900"); ctx.font = "700 12px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("+", x, cy+1);
      ctx.restore();
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    if (!entriesSorted.length) {
      const anchorX = view.selectedRowClickX != null ? view.selectedRowClickX : RAIL_W + 40;
      addBtn(anchorX, { rowId: row.id, mode: "only", atX: anchorX });
      return;
    }
    const first = entriesSorted[0], last = entriesSorted[entriesSorted.length-1];
    addBtn(xForMs(entryStartMs(first)) - 16, { rowId: row.id, mode: "before", left: null, right: first });
    for (let i=0;i<entriesSorted.length-1;i++) {
      const a = entriesSorted[i], b = entriesSorted[i+1];
      const gapX1 = xForMs(entryEndMs(a)), gapX2 = xForMs(entryStartMs(b));
      if (gapX2 - gapX1 > 22) addBtn((gapX1+gapX2)/2, { rowId: row.id, mode: "between", left: a, right: b });
    }
    if (last.end) addBtn(xForMs(entryEndMs(last)) + 16, { rowId: row.id, mode: "after", left: last, right: null });
  }

  function drawBar(x1, x2, y, rowH, color, entry, alpha, canvasW, RAIL_W) {
    const barH = rowH - 9;
    const top = y + 4.5;
    const clipX1 = Math.max(x1, RAIL_W - 20), clipX2 = Math.min(x2, canvasW + 20);
    if (clipX2 <= clipX1) return;
    const width = x2 - x1;

    const startFuzz = PRECISION_FUZZ_DAYS[entry.start.p] || 0;
    const endFuzz = entry.end ? (PRECISION_FUZZ_DAYS[entry.end.p] || 0) : 0;
    const fadeIn = entry.fadeIn || 0, fadeOut = entry.fadeOut || 0;
    const leftSoft = Math.min(Math.max(startFuzz, fadeIn) * view.pxPerDay, width * 0.42);
    const rightSoft = Math.min(Math.max(endFuzz, fadeOut) * view.pxPerDay, width * 0.42);

    ctx.save();
    ctx.globalAlpha = alpha;

    // single continuous alpha-ramped fill (no seam between solid + gradient)
    const grad = ctx.createLinearGradient(x1, 0, x2, 0);
    const rgb = hexToRgbTuple(color);
    const stops = [];
    stops.push([0, 0]);
    if (leftSoft > 1) stops.push([leftSoft/width, 1]); else stops.push([0, 1]);
    if (entry.end && rightSoft > 1) { stops.push([1 - rightSoft/width, 1]); stops.push([1, 0]); }
    else stops.push([1, 1]);
    stops.forEach(([off, a]) => grad.addColorStop(Math.min(1,Math.max(0,off)), `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`));
    ctx.fillStyle = grad;
    roundRectPath(x1, top, width, barH, 4);
    ctx.fill();

    if (entry.start.p === "circa" && leftSoft > 1) drawHatch(x1, top, leftSoft, barH, color);
    if (entry.end && entry.end.p === "circa" && rightSoft > 1) drawHatch(x2-rightSoft, top, rightSoft, barH, color);

    if (!entry.end) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x2-6, top); ctx.lineTo(x2+4, top+barH/2); ctx.lineTo(x2-6, top+barH); ctx.closePath(); ctx.fill();
    }

    // label — always fully legible, positioned in the most-opaque visible span
    if (width > 30) {
      const visStart = Math.max(clipX1, RAIL_W);
      const visEnd = clipX2;
      const solidStart = x1 + leftSoft, solidEnd = entry.end ? x2 - rightSoft : x2;
      let labelX;
      if (solidEnd > solidStart) labelX = Math.max(visStart, solidStart) + 8;
      else labelX = Math.max(visStart, x1) + 8;
      if (visEnd - labelX > 20) {
        ctx.save();
        ctx.beginPath(); ctx.rect(visStart, top, visEnd - visStart, barH); ctx.clip();
        ctx.globalAlpha = Math.max(alpha, 0.94);
        const textColor = perceivedBrightness(color) > 150 ? "#1a1a1a" : "#fbf8f0";
        ctx.fillStyle = textColor;
        ctx.font = "500 11.5px -apple-system, system-ui, sans-serif";
        ctx.fillText(entry.title, labelX, top + barH/2 + 4);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawInactiveBand(x, y, w, h) {
    if (w <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = css("--text-dim"); ctx.globalAlpha = 0.06;
    ctx.fillRect(x, y + 3, w, h - 6);
    ctx.strokeStyle = css("--text-dim"); ctx.globalAlpha = 0.16; ctx.lineWidth = 1;
    for (let i=-h; i<w+h; i+=8) { ctx.beginPath(); ctx.moveTo(x+i, y+h); ctx.lineTo(x+i+h, y); ctx.stroke(); }
    ctx.restore();
  }
  function drawHatch(x, y, w, h, color) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = hexToRgba(color, 0.3); ctx.lineWidth = 1;
    for (let i=-h; i<w+h; i+=6) { ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.stroke(); }
    ctx.restore();
  }
  function roundRectPath(x,y,w,h,r) {
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function hexToRgbTuple(hex) {
    hex = hex.replace("#",""); if (hex.length===3) hex = hex.split("").map(c=>c+c).join("");
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  function hexToRgba(hex, a) { const [r,g,b]=hexToRgbTuple(hex); return `rgba(${r},${g},${b},${a})`; }
  function perceivedBrightness(hex) { const [r,g,b]=hexToRgbTuple(hex); return (r*299+g*587+b*114)/1000; }

  function drawTimeAxis(w, h, RAIL_W, panelLine, text, textDim) {
    // paint the header strip FIRST — grid lines/labels are drawn on top of it,
    // never after, so text never gets silently erased by this fill.
    ctx.fillStyle = css("--bg");
    ctx.fillRect(0, 0, w, HEADER_H);

    ctx.save();
    ctx.beginPath(); ctx.rect(RAIL_W, 0, w-RAIL_W, h); ctx.clip();
    const pxPerDay = view.pxPerDay;
    const startDate = new Date(msForX(RAIL_W));
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.strokeStyle = panelLine; ctx.lineWidth = 1;

    if (pxPerDay > 34) {
      // day-level: also show week gridlines a bit stronger
      let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
      for (let i=0;i<800;i++) {
        const x = xForMs(cursor.getTime());
        if (x > w+40) break;
        if (x > RAIL_W-40) {
          const isWeekStart = cursor.getUTCDay() === 1;
          ctx.globalAlpha = isWeekStart ? 0.7 : 0.18;
          ctx.beginPath(); ctx.moveTo(x, HEADER_H); ctx.lineTo(x, h); ctx.stroke();
          if (isWeekStart) {
            ctx.globalAlpha = 1; ctx.fillStyle = textDim;
            ctx.fillText(cursor.getUTCDate()+"."+(cursor.getUTCMonth()+1)+".", x+5, 24);
          }
        }
        cursor = new Date(cursor.getTime() + DAY);
      }
    } else if (pxPerDay > 6) {
      let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      for (let i=0;i<400;i++) {
        const x = xForMs(cursor.getTime());
        if (x > w+40) break;
        if (x > RAIL_W-40) {
          ctx.globalAlpha = cursor.getUTCMonth()===0 ? 0.9 : 0.35;
          ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,h); ctx.stroke();
          ctx.globalAlpha = 1; ctx.fillStyle = cursor.getUTCMonth()===0 ? text : textDim;
          ctx.fillText(cursor.getUTCMonth()===0 ? String(cursor.getUTCFullYear()) : months[cursor.getUTCMonth()], x+5, 24);
        }
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth()+1, 1));
      }
    } else {
      const yearStep = pxPerDay > 0.35 ? 1 : (pxPerDay > 0.08 ? 5 : 20);
      let year = Math.floor(startDate.getUTCFullYear()/yearStep)*yearStep;
      for (let i=0;i<200;i++) {
        const x = xForMs(Date.UTC(year,0,1));
        if (x > w+40) break;
        if (x > RAIL_W-40) {
          ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,h); ctx.stroke();
          ctx.globalAlpha = 1; ctx.fillStyle = text; ctx.fillText(String(year), x+5, 24);
        }
        year += yearStep;
      }
    }
    ctx.restore();
    ctx.strokeStyle = panelLine;
    ctx.beginPath(); ctx.moveTo(0,HEADER_H); ctx.lineTo(w,HEADER_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(RAIL_W,HEADER_H); ctx.lineTo(RAIL_W,h); ctx.stroke();
  }

  // ========== rail (headers) ==========
  let openPopover = null;
  function buildRail() {
    railInner.innerHTML = "";
    const { items, totalH } = computeLayout();
    railInner.style.height = totalH + "px";
    const mobile = isMobile();
    items.forEach(it => {
      if (it.type === "group") {
        const g = it.group;
        const div = document.createElement("div");
        div.className = "group-header" + (g.collapsed ? " collapsed" : "");
        div.style.position = "absolute"; div.style.top = it.y + "px"; div.style.left = "0"; div.style.right = "0";
        div.innerHTML = `<span class="chev">▾</span><span class="glabel" title="${it.label}">${it.label}</span>` +
          (g.personId ? `<button class="icon-btn" data-edit-person title="Edit ${people[g.personId].label}">⚙</button>` : "") +
          `<button class="icon-btn" data-add-menu title="Add to ${g.label}">+</button>`;
        div.addEventListener("click", (ev) => {
          if (ev.target.closest(".icon-btn")) return;
          g.collapsed = !g.collapsed; resize();
        });
        const editPerson = div.querySelector("[data-edit-person]");
        if (editPerson) editPerson.addEventListener("click", (ev) => { ev.stopPropagation(); openPersonPopover(g.personId, ev.currentTarget); });
        div.querySelector("[data-add-menu]").addEventListener("click", (ev) => {
          ev.stopPropagation();
          openAddMenu(ev.currentTarget, g.label, !g.personId);
        });
        railInner.appendChild(div);
      } else if (it.type === "person") {
        const div = document.createElement("div");
        div.className = "group-header";
        div.style.position = "absolute"; div.style.top = it.y + "px"; div.style.left = "16px"; div.style.right = "0";
        div.style.fontSize = "11px";
        div.innerHTML = `<span class="glabel" title="${personLabelWithAge(it.personId)}">${personLabelWithAge(it.personId)}</span>` +
          `<button class="icon-btn" data-edit-person title="Edit ${people[it.personId].label}">⚙</button>` +
          `<button class="icon-btn" data-add-menu title="Add for ${people[it.personId].label}">+</button>`;
        div.querySelector("[data-edit-person]").addEventListener("click", (ev) => { ev.stopPropagation(); openPersonPopover(it.personId, ev.currentTarget); });
        div.querySelector("[data-add-menu]").addEventListener("click", (ev) => {
          ev.stopPropagation();
          openAddMenu(ev.currentTarget, people[it.personId].label, false);
        });
        railInner.appendChild(div);
      } else {
        const row = it.row;
        const cat = categories[row.cat];
        const div = document.createElement("div");
        div.className = "row-header" + (it.isSub ? " sub" : "") + (rowVisible[row.id] ? "" : " off") + (mobile ? " mobile-compact" : "");
        div.style.position = "absolute"; div.style.top = it.y + "px"; div.style.left = "0"; div.style.right = "0"; div.style.height = it.h + "px";
        const labelText = mobile ? row.label.charAt(0).toUpperCase() : row.label;
        div.innerHTML = `
          <input type="checkbox" ${rowVisible[row.id] ? "checked" : ""} />
          <span class="row-swatch" style="background:${cat.color}"></span>
          <span class="row-icon">${cat.icon || ""}</span>
          <span class="row-label" title="${row.label}">${labelText}</span>
          ${it.isSub ? "" : `<button class="icon-btn" data-add-sub title="Add sub-timeline">⎘</button>`}
          <button class="icon-btn" data-edit-cat title="Edit category">⚙</button>
        `;
        div.querySelector('input[type="checkbox"]').addEventListener("change", (ev) => {
          rowVisible[row.id] = ev.target.checked; buildRail(); draw();
        });
        const addSub = div.querySelector("[data-add-sub]");
        if (addSub) addSub.addEventListener("click", (ev) => { ev.stopPropagation(); addSub.title = "Prototype only — would create a sub-timeline under " + row.label; });
        div.querySelector("[data-edit-cat]").addEventListener("click", (ev) => {
          ev.stopPropagation();
          openCategoryPopover(row.cat, ev.currentTarget);
        });
        railInner.appendChild(div);
      }
    });
  }

  function dateInputValue(ms) {
    if (ms == null) return "";
    const dt = new Date(ms);
    return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth()+1).padStart(2,"0") + "-" + String(dt.getUTCDate()).padStart(2,"0");
  }
  function parseDateInputValue(v) {
    if (!v) return null;
    const [y,m,day] = v.split("-").map(Number);
    return Date.UTC(y, m-1, day);
  }

  function openAddMenu(anchorEl, targetLabel, allowPerson) {
    popoverAnchorRect = anchorEl.getBoundingClientRect();
    closePopover();
    const pop = document.createElement("div");
    pop.className = "popover menu-popover";
    pop.style.top = (popoverAnchorRect.bottom + 6) + "px";
    pop.style.left = Math.min(window.innerWidth - 200, popoverAnchorRect.left) + "px";
    pop.innerHTML = `
      <h5>Add to ${targetLabel}</h5>
      ${allowPerson ? `<div class="menu-item" data-kind="person">👤 Person</div>` : ""}
      <div class="menu-item" data-kind="category">🏷 Category (new timeline)</div>
    `;
    document.body.appendChild(pop);
    openPopover = pop;
    document.removeEventListener("mousedown", outsidePopoverClick);
    document.addEventListener("mousedown", outsidePopoverClick);
    pop.querySelectorAll(".menu-item").forEach(mi => mi.addEventListener("click", () => {
      const kind = mi.dataset.kind === "person" ? "a new person" : "a new category/timeline";
      mi.textContent = "Prototype only — would add " + kind + " to " + targetLabel;
      mi.style.pointerEvents = "none"; mi.style.color = "var(--text-dim)";
      setTimeout(closePopover, 1400);
    }));
  }

  function openPersonPopover(personId, anchorEl) {
    popoverAnchorRect = anchorEl.getBoundingClientRect();
    renderPersonPopover(personId);
  }
  function renderPersonPopover(personId) {
    closePopover();
    const person = people[personId];
    const pop = document.createElement("div");
    pop.className = "popover";
    pop.style.top = (popoverAnchorRect.bottom + 6) + "px";
    pop.style.left = Math.min(window.innerWidth - 246, popoverAnchorRect.left) + "px";
    pop.innerHTML = `
      <h5>Person</h5>
      <input type="text" id="popPersonName" value="${person.label}" />
      <div class="field-label">Birthdate</div>
      <input type="date" id="popPersonBirth" value="${dateInputValue(person.birthDate)}" style="width:100%;margin-bottom:12px;background:var(--bg);border:1px solid var(--panel-line);color:var(--text);border-radius:6px;padding:7px 9px;font-size:13px;" />
    `;
    document.body.appendChild(pop);
    openPopover = pop;
    document.removeEventListener("mousedown", outsidePopoverClick);
    document.addEventListener("mousedown", outsidePopoverClick);
    pop.querySelector("#popPersonName").addEventListener("input", (ev) => { person.label = ev.target.value; buildRail(); });
    pop.querySelector("#popPersonBirth").addEventListener("change", (ev) => {
      person.birthDate = parseDateInputValue(ev.target.value);
      buildRail(); draw();
    });
  }

  let popoverAnchorRect = null;
  function openCategoryPopover(catId, anchorEl) {
    if (anchorEl) popoverAnchorRect = anchorEl.getBoundingClientRect();
    renderCategoryPopover(catId);
  }
  function renderCategoryPopover(catId) {
    closePopover();
    const cat = categories[catId];
    const pop = document.createElement("div");
    pop.className = "popover";
    const rect = popoverAnchorRect;
    pop.style.top = (rect.bottom + 6) + "px";
    pop.style.left = Math.min(window.innerWidth - 246, rect.left) + "px";
    pop.innerHTML = `
      <h5>Category</h5>
      <input type="text" value="${cat.label}" />
      <div class="field-label">Color &amp; icon</div>
      <div class="color-icon-row">
        <input type="color" id="popColor" value="${cat.color}" title="Any color" />
        <input type="text" id="popIcon" maxlength="4" value="${cat.icon || ""}" placeholder="🙂" title="Any emoji" />
      </div>
      <div class="icon-row">${ICON_QUICKPICKS.map(ic => `<span class="icon-choice${ic===cat.icon?' active':''}" data-icon="${ic}">${ic}</span>`).join("")}</div>
      <div class="field-label">Behavior</div>
      <div class="icon-row" data-field="exclusive">
        <span class="icon-choice${cat.exclusive?' active':''}" data-v="true">◆ Exclusive</span>
        <span class="icon-choice${!cat.exclusive?' active':''}" data-v="false">⬦ Concurrent</span>
      </div>
      <div class="field-label">Visibility</div>
      <div class="icon-row" data-field="visibility">
        <span class="icon-choice${cat.visibility==='private'?' active':''}" data-v="private">🔒 Private</span>
        <span class="icon-choice${cat.visibility==='shareable'?' active':''}" data-v="shareable">🌐 Shareable</span>
      </div>
    `;
    document.body.appendChild(pop);
    openPopover = pop;
    document.removeEventListener("mousedown", outsidePopoverClick);
    document.addEventListener("mousedown", outsidePopoverClick);
    pop.querySelector('input[type="text"]').addEventListener("input", (ev) => { cat.label = ev.target.value; buildRail(); });
    pop.querySelector("#popColor").addEventListener("input", (ev) => { cat.color = ev.target.value; buildRail(); draw(); });
    pop.querySelector("#popIcon").addEventListener("input", (ev) => { cat.icon = ev.target.value; buildRail(); });
    pop.querySelectorAll('[data-icon]').forEach(s => s.addEventListener("click", () => { cat.icon = s.dataset.icon; renderCategoryPopover(catId); buildRail(); }));
    pop.querySelectorAll('[data-field="exclusive"] .icon-choice').forEach(s => s.addEventListener("click", () => { cat.exclusive = s.dataset.v === "true"; renderCategoryPopover(catId); }));
    pop.querySelectorAll('[data-field="visibility"] .icon-choice').forEach(s => s.addEventListener("click", () => { cat.visibility = s.dataset.v; renderCategoryPopover(catId); }));
  }
  function outsidePopoverClick(ev) {
    if (openPopover && !openPopover.contains(ev.target) && !ev.target.closest(".icon-btn")) closePopover();
  }
  function closePopover() {
    if (openPopover) { openPopover.remove(); openPopover = null; document.removeEventListener("mousedown", outsidePopoverClick); }
  }

  // ========== interaction: pan / scroll / zoom ==========
  let dragging = false, dragStartX = 0, dragStartY = 0, dragStartViewMs = 0, dragStartScrollY = 0, moved = false;
  let pinchStartDist = null, pinchStartPxPerDay = null, pinchMidStart = null, pinchStartScrollY = null, pinchStartViewMs = null;

  canvas.addEventListener("mousedown", (ev) => {
    dragging = true; moved = false;
    dragStartX = ev.clientX; dragStartY = ev.clientY;
    dragStartViewMs = view.startMs; dragStartScrollY = view.scrollY;
    canvas.classList.add("grabbing");
  });
  window.addEventListener("mousemove", (ev) => {
    if (view.picking) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      if (x > railWidth()) { view.pickHoverX = x; draw(); updatePickTooltip(ev.clientX, ev.clientY, msForX(x)); }
      return;
    }
    if (!dragging) return;
    const dx = ev.clientX - dragStartX, dy = ev.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    view.startMs = dragStartViewMs - dx / view.pxPerDay * DAY;
    view.scrollY = dragStartScrollY - dy;
    clampScroll();
    draw();
  });
  window.addEventListener("mouseup", (ev) => {
    if (view.picking) { commitPick(ev); return; }
    if (dragging && !moved) handleClick(ev.clientX, ev.clientY);
    dragging = false; canvas.classList.remove("grabbing");
  });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    if (ev.ctrlKey) {
      const msAtCursor = msForX(mx);
      const factor = Math.exp(-ev.deltaY * 0.018);
      view.pxPerDay = Math.min(200, Math.max(0.015, view.pxPerDay * factor));
      view.startMs = msAtCursor - (mx - railWidth()) / view.pxPerDay * DAY;
    } else {
      view.startMs += ev.deltaX / view.pxPerDay * DAY;
      view.scrollY += ev.deltaY;
      clampScroll();
    }
    draw();
  }, { passive: false });

  canvas.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1) {
      dragging = true; moved = false;
      dragStartX = ev.touches[0].clientX; dragStartY = ev.touches[0].clientY;
      dragStartViewMs = view.startMs; dragStartScrollY = view.scrollY;
    } else if (ev.touches.length === 2) {
      dragging = false;
      pinchStartDist = touchDist(ev.touches);
      pinchStartPxPerDay = view.pxPerDay;
      pinchMidStart = touchMid(ev.touches);
      pinchStartScrollY = view.scrollY; pinchStartViewMs = view.startMs;
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (ev) => {
    if (ev.touches.length === 1 && dragging) {
      const dx = ev.touches[0].clientX - dragStartX, dy = ev.touches[0].clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      view.startMs = dragStartViewMs - dx / view.pxPerDay * DAY;
      view.scrollY = dragStartScrollY - dy;
      clampScroll();
      draw();
    } else if (ev.touches.length === 2 && pinchStartDist) {
      const dist = touchDist(ev.touches);
      view.pxPerDay = Math.min(200, Math.max(0.015, pinchStartPxPerDay * (dist / pinchStartDist)));
      const mid = touchMid(ev.touches);
      view.startMs = pinchStartViewMs - (mid.x - pinchMidStart.x) / view.pxPerDay * DAY;
      view.scrollY = pinchStartScrollY - (mid.y - pinchMidStart.y);
      clampScroll();
      draw();
    }
  }, { passive: true });
  canvas.addEventListener("touchend", (ev) => {
    if (ev.touches.length === 0) {
      if (view.picking) { commitPick({ clientX: ev.changedTouches[0].clientX, clientY: ev.changedTouches[0].clientY }); }
      else if (dragging && !moved) { const t = ev.changedTouches[0]; handleClick(t.clientX, t.clientY); }
      dragging = false; pinchStartDist = null;
    }
  });
  function touchDist(t) { const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); }
  function touchMid(t) { return { x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2 }; }

  function handleClick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const RAIL_W = railWidth();

    const hitAdd = addButtons.find(b => Math.hypot(b.x-x, b.y-y) <= b.r+4);
    if (hitAdd) { openQuickAdd(hitAdd.ctxData); return; }

    let hitEntry = null;
    for (const id in positions) { const p = positions[id]; if (!p) continue; if (x>=p.x1 && x<=p.x2 && y>=p.y && y<=p.y+p.h) { hitEntry = id; break; } }
    if (hitEntry) {
      const entry = rows.flatMap(r=>r.entries).find(e=>e.id===hitEntry);
      view.selectedRowId = null;
      if (view.selected && view.selected.id === hitEntry) { view.selected = null; closeSidePanel(); }
      else { view.selected = entry; openSidePanelView(entry); }
      draw();
      return;
    }

    view.selected = null; closeSidePanel();
    // clicking empty space inside a row's band selects that timeline and reveals its + affordances
    const rowHit = findRowAt(x, y, RAIL_W);
    if (rowHit) { view.selectedRowId = rowHit.row.id; view.selectedRowClickX = x; }
    else { view.selectedRowId = null; view.selectedRowClickX = null; }
    draw();
  }

  function findRowAt(x, y, RAIL_W) {
    if (x < RAIL_W || y < HEADER_H) return null;
    const { items } = computeLayout();
    for (const it of items) {
      if (it.type !== "row") continue;
      const screenY = HEADER_H + (it.y - view.scrollY);
      if (y >= screenY && y <= screenY + it.h) return it;
    }
    return null;
  }

  document.getElementById("zoomIn").onclick = () => zoomStep(1.35);
  document.getElementById("zoomOut").onclick = () => zoomStep(1/1.35);
  function zoomStep(factor) {
    const w = wrap.clientWidth;
    const cx = railWidth() + (w - railWidth())/2;
    const msAtCursor = msForX(cx);
    view.pxPerDay = Math.min(200, Math.max(0.015, view.pxPerDay * factor));
    view.startMs = msAtCursor - (cx - railWidth())/view.pxPerDay*DAY;
    draw();
  }

  // ========== keyboard shortcuts ==========
  window.addEventListener("keydown", (ev) => {
    const tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") {
      if (ev.key === "Escape") ev.target.blur();
      return;
    }
    if (ev.key === "Escape") {
      if (view.picking) { view.picking = null; view.pickHoverX=null; hidePickTooltip(); draw(); return; }
      if (panelState) { closeSidePanel(); view.selected = null; draw(); return; }
      if (view.selectedRowId) { view.selectedRowId = null; draw(); return; }
    } else if (ev.key === "ArrowLeft") { view.startMs -= (200/view.pxPerDay)*DAY; draw(); }
    else if (ev.key === "ArrowRight") { view.startMs += (200/view.pxPerDay)*DAY; draw(); }
    else if (ev.key === "ArrowUp") { view.scrollY -= ROW_H; clampScroll(); draw(); }
    else if (ev.key === "ArrowDown") { view.scrollY += ROW_H; clampScroll(); draw(); }
    else if (ev.key === "+" || ev.key === "=") { zoomStep(1.35); }
    else if (ev.key === "-" || ev.key === "_") { zoomStep(1/1.35); }
  });

  // ========== side panel (view / edit / new) ==========
  const sidePanel = document.getElementById("sidePanel");
  const sidePanelInner = document.getElementById("sidePanelInner");

  function openSidePanelView(entry) {
    const row = rows.find(r => r.id === entry.row);
    const cat = categories[row.cat];
    panelState = { mode: "view", entry, row };
    sidePanelInner.innerHTML = `
      <div class="panel-topline"><div class="cat">${cat.icon} ${cat.label} · ${row.label}</div><button id="pClose">✕</button></div>
      <div class="view-title">${entry.title}</div>
      <div class="view-range">${fmtDate(entry.start)} → ${fmtDate(entry.end)}</div>
      <div class="view-desc">${entry.desc || '<span style="color:var(--text-dim)">No description yet.</span>'}</div>
      <div class="chip-row">${(entry.links||[]).map(l=>`<span class="chip">${l}</span>`).join("")}</div>
      <button class="edit-btn" id="pEdit">✎ Edit entry</button>
    `;
    sidePanelInner.querySelector("#pClose").onclick = () => { view.selected=null; closeSidePanel(); draw(); };
    sidePanelInner.querySelector("#pEdit").onclick = () => openSidePanelEdit(entry, row);
    sidePanel.classList.add("open");
  }

  function openQuickAdd(ctxData) {
    const row = rows.find(r => r.id === ctxData.rowId);
    const cat = categories[row.cat];
    let startVal = null, endVal = null, note = "";
    if (ctxData.mode === "after" && ctxData.left) {
      startVal = { ms: entryEndMs(ctxData.left), p: "day" };
      if (cat.exclusive) note = `This is an exclusive category — saving will close "<strong>${ctxData.left.title}</strong>" on this start date.`;
    } else if (ctxData.mode === "before" && ctxData.right) {
      endVal = { ms: entryStartMs(ctxData.right), p: "day" };
    } else if (ctxData.mode === "between") {
      startVal = { ms: entryEndMs(ctxData.left), p: "day" };
      endVal = { ms: entryStartMs(ctxData.right), p: "day" };
    } else if (ctxData.mode === "only") {
      startVal = { ms: msForX(ctxData.atX), p: "month" };
    }
    const draftEntry = {
      id: null, title: "", desc: "", links: [], row: row.id,
      start: startVal ? { t: startVal.ms, p: startVal.p, day: startVal.ms } : { t: Date.now(), p: "month" },
      end: endVal ? { t: endVal.ms, p: endVal.p, day: endVal.ms } : null,
    };
    panelState = { mode: "new", entry: draftEntry, row, note };
    renderEditForm();
    sidePanel.classList.add("open");
  }

  function openSidePanelEdit(entry, row) {
    panelState = { mode: "edit", entry, row, note: "" };
    renderEditForm();
  }

  function renderEditForm() {
    const { entry, row, note } = panelState;
    const cat = categories[row.cat];
    sidePanelInner.innerHTML = `
      <div class="panel-topline"><div class="cat">${cat.icon} ${cat.label} · ${row.label}</div><button id="pClose">✕</button></div>
      ${note ? `<div class="concurrency-note">${note}</div>` : ""}
      <div class="field">
        <label>Title</label>
        <input type="text" id="fTitle" value="${entry.title || ""}" placeholder="What happened?" />
      </div>
      <div class="field">
        <label>Start</label>
        <div class="date-field-row">
          <input type="text" id="fStartText" value="${fmtMs(entryStartMs(entry))}" readonly />
          <button class="pick-btn" id="fStartPick" title="Pick on timeline">⌖</button>
        </div>
        <div class="precision-pills" id="fStartPrec">
          ${PRECISION_LIST.map(p => `<button data-p="${p.key}" class="${entry.start.p===p.key?'active':''}">${p.glyph} ${p.txt}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>End</label>
        <div class="date-field-row">
          <input type="text" id="fEndText" value="${entry.end ? fmtMs(entryEndMs(entry)) : 'ongoing'}" readonly />
          <button class="pick-btn" id="fEndPick" title="Pick on timeline">⌖</button>
        </div>
        <div class="precision-pills" id="fEndPrec">
          <button data-p="ongoing" class="${!entry.end?'active':''}">— Ongoing</button>
          ${PRECISION_LIST.map(p => `<button data-p="${p.key}" class="${entry.end && entry.end.p===p.key?'active':''}">${p.glyph} ${p.txt}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="fDesc" placeholder="Optional notes…">${entry.desc || ""}</textarea>
      </div>
      <div class="field">
        <label>Visibility</label>
        <div class="pill-select" id="fVisibility">
          <div class="pill-opt ${(entry.visibility||cat.visibility)==='private'?'active':''}" data-v="private"><span class="glyph">🔒</span><span class="txt">Private</span></div>
          <div class="pill-opt ${(entry.visibility||cat.visibility)==='shareable'?'active':''}" data-v="shareable"><span class="glyph">🌐</span><span class="txt">Shareable</span></div>
        </div>
      </div>
    `;
    sidePanel.classList.add("open");
    sidePanelInner.querySelector("#pClose").onclick = () => { closeSidePanel(); view.selected=null; draw(); };
    sidePanelInner.querySelector("#fTitle").addEventListener("input", (ev) => { entry.title = ev.target.value; commitEntry(); buildRail(); });
    sidePanelInner.querySelector("#fDesc").addEventListener("input", (ev) => { entry.desc = ev.target.value; commitEntry(); });
    sidePanelInner.querySelectorAll("#fStartPrec button").forEach(b => b.onclick = () => {
      entry.start.p = b.dataset.p; commitEntry(); renderEditForm();
    });
    sidePanelInner.querySelectorAll("#fEndPrec button").forEach(b => b.onclick = () => {
      if (b.dataset.p === "ongoing") entry.end = null;
      else entry.end = { t: entry.end ? entryEndMs(entry) : entryStartMs(entry), p: b.dataset.p, day: entry.end ? entryEndMs(entry) : entryStartMs(entry) };
      commitEntry(); renderEditForm();
    });
    sidePanelInner.querySelectorAll("#fVisibility .pill-opt").forEach(b => b.onclick = () => {
      entry.visibility = b.dataset.v; commitEntry(); renderEditForm();
    });
    sidePanelInner.querySelector("#fStartPick").onclick = () => armPicking("start");
    sidePanelInner.querySelector("#fEndPick").onclick = () => armPicking("end");
  }

  // commits a draft entry into its row the first time it has meaningful content,
  // then every later edit just mutates the already-referenced object — no explicit save step
  function commitEntry() {
    const { entry, row } = panelState;
    if (panelState.mode === "new") {
      if (!entry.title || !entry.title.trim()) return;
      entry.id = "e" + Math.random().toString(36).slice(2, 8);
      entry.links = entry.links || [];
      entry.linkedEntryIds = entry.linkedEntryIds || [];
      row.entries.push(entry);
      panelState.mode = "edit";
    }
    draw();
  }

  function armPicking(field) {
    sidePanelInner.querySelector("#f" + field.charAt(0).toUpperCase()+field.slice(1) + "Pick").classList.add("active");
    view.picking = { field };
    view.pickHoverX = null;
    draw();
  }
  let pickTooltipEl = null;
  function updatePickTooltip(clientX, clientY, ms) {
    if (!pickTooltipEl) { pickTooltipEl = document.createElement("div"); pickTooltipEl.className="pick-tooltip"; document.body.appendChild(pickTooltipEl); }
    pickTooltipEl.style.left = clientX + "px"; pickTooltipEl.style.top = clientY + "px";
    pickTooltipEl.textContent = fmtMs(ms);
  }
  function hidePickTooltip() { if (pickTooltipEl) { pickTooltipEl.remove(); pickTooltipEl = null; } }
  function commitPick(ev) {
    if (!view.picking) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    if (x > railWidth()) {
      const ms = msForX(x);
      const field = view.picking.field;
      const entry = panelState.entry;
      if (field === "start") entry.start = { t: ms, p: entry.start.p, day: ms };
      else entry.end = { t: ms, p: (entry.end && entry.end.p) || "day", day: ms };
      view.picking = null; view.pickHoverX = null; hidePickTooltip();
      renderEditForm();
      draw();
    }
  }

  function closeSidePanel() { sidePanel.classList.remove("open"); panelState = null; }

  window.addEventListener("resize", resize);
  resize();
})();
