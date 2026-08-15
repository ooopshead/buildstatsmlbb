const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

// --- aggregation helpers (run on the client over filtered matches) ---

function wilsonLower(wins, games, z = 1.96) {
  if (games === 0) return 0;
  const p = wins / games, n = games;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return Math.round(((center - margin) / denom) * 10000) / 10000;
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(i);
  yield idx.map(i => arr[i]);
  while (true) {
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    yield idx.map(i => arr[i]);
  }
}

const TOP_COMBOS = 20;
const TOP_PLAYERS = 30;

// Map a match's battle spell to retribution variant if applicable.
// Hunter-boot prefix → retribution type:
//   Ice Hunter      → Ice Retribution
//   Flame Hunter    → Flame Retribution
//   Behemoth Hunter → Bloody Retribution
function effectiveSpell(m) {
  if (m.s !== 'Retribution') return m.s;
  for (const n of (m.items || [])) {
    if (!n) continue;
    if (n.startsWith('Ice Hunter')) return 'Ice Retribution';
    if (n.startsWith('Flame Hunter')) return 'Flame Retribution';
    if (n.startsWith('Behemoth Hunter')) return 'Bloody Retribution';
  }
  return 'Retribution';
}

function aggregate(matches) {
  const itemMap = new Map();
  const comboMap = { 3: new Map(), 4: new Map(), 5: new Map(), 6: new Map() };
  const emblemMap = new Map();
  const talentMap = new Map();
  const embTalMap = new Map();
  const playerMap = new Map();
  const spellMap = new Map();
  let total = matches.length, wins = 0;

  for (const m of matches) {
    wins += m.w;

    const itemNames = (m.items || []).filter(Boolean);
    const sortedItems = [...itemNames].sort();
    for (const name of itemNames) {
      const v = itemMap.get(name) || [0, 0, null];
      v[0] += m.w; v[1]++;
      if (m.cs) v[2] = csAdd(v[2], m.cs);
      itemMap.set(name, v);
    }
    for (const k of [3, 4, 5, 6]) {
      if (sortedItems.length >= k) {
        for (const combo of combinations(sortedItems, k)) {
          const key = combo.join('');
          let v = comboMap[k].get(key);
          if (!v) { v = { wins: 0, games: 0, items: combo, cs: null }; comboMap[k].set(key, v); }
          v.wins += m.w; v.games++;
          if (m.cs) v.cs = csAdd(v.cs, m.cs);
        }
      }
    }
    if (m.e) {
      let v = emblemMap.get(m.e);
      if (!v) { v = { wins: 0, games: 0, eid: m.eid, name: m.e, cs: null }; emblemMap.set(m.e, v); }
      v.wins += m.w; v.games++;
      if (m.cs) v.cs = csAdd(v.cs, m.cs);
    }
    for (const t of m.t || []) {
      let v = talentMap.get(t.id);
      if (!v) { v = { wins: 0, games: 0, id: t.id, name: t.name, class: t.class, type: t.type, cs: null }; talentMap.set(t.id, v); }
      v.wins += m.w; v.games++;
      if (m.cs) v.cs = csAdd(v.cs, m.cs);
    }
    if (m.e && m.t && m.t.length) {
      const sortedTal = [...m.t].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      const tk = sortedTal.map(t => t.id + '' + t.name).join('');
      const key = m.e + '' + tk;
      let v = embTalMap.get(key);
      if (!v) {
        v = {
          wins: 0, games: 0, eid: m.eid, emblem: m.e,
          talents: sortedTal.map(t => ({ id: t.id, name: t.name })), cs: null,
        };
        embTalMap.set(key, v);
      }
      v.wins += m.w; v.games++;
      if (m.cs) v.cs = csAdd(v.cs, m.cs);
    }
    const spellName = effectiveSpell(m);
    if (spellName) {
      let v = spellMap.get(spellName);
      if (!v) { v = { wins: 0, games: 0, name: spellName, cs: null }; spellMap.set(spellName, v); }
      v.wins += m.w; v.games++;
      if (m.cs) v.cs = csAdd(v.cs, m.cs);
    }
    const pn = m.p || 'Unknown';
    let p = playerMap.get(pn);
    if (!p) {
      p = { wins: 0, games: 0, builds: [], emblems: [], talentSets: [] };
      playerMap.set(pn, p);
    }
    p.wins += m.w; p.games++;
    p.builds.push(itemNames);
    if (m.e) p.emblems.push(m.e);
    if (m.t && m.t.length) p.talentSets.push(m.t.map(t => ({ id: t.id, name: t.name })));
  }

  const items = [];
  for (const [name, [w, g, cs]] of itemMap) {
    items.push({ id: null, name, games: g, wins: w, wr: g ? w / g : 0, wlb: wilsonLower(w, g), cs });
  }

  const item_combos = {};
  for (const k of [3, 4, 5, 6]) {
    const arr = [];
    for (const v of comboMap[k].values()) {
      arr.push({
        items: v.items, games: v.games, wins: v.wins,
        wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games), cs: v.cs,
      });
    }
    arr.sort((a, b) => b.wlb - a.wlb || b.games - a.games);
    item_combos[k] = arr.slice(0, TOP_COMBOS);
  }

  const emblems = [];
  for (const v of emblemMap.values()) {
    emblems.push({
      id: v.eid, name: v.name, games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games), cs: v.cs,
    });
  }

  const talents = [];
  for (const v of talentMap.values()) {
    talents.push({
      id: v.id, name: v.name, class: v.class, type: v.type,
      games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games), cs: v.cs,
    });
  }

  const emblem_talent_combos = [];
  for (const v of embTalMap.values()) {
    emblem_talent_combos.push({
      emblem_id: v.eid, emblem: v.emblem, talents: v.talents,
      games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games), cs: v.cs,
    });
  }

  const players = [];
  for (const [name, p] of playerMap) {
    const buildC = new Map();
    for (const b of p.builds) {
      const key = [...b].sort().join('');
      if (key) buildC.set(key, (buildC.get(key) || 0) + 1);
    }
    let topBuild = [], maxC = 0;
    for (const [key, cnt] of buildC) {
      if (cnt > maxC) { maxC = cnt; topBuild = key.split(''); }
    }

    const embC = new Map();
    for (const e of p.emblems) embC.set(e, (embC.get(e) || 0) + 1);
    let topEmb = ''; maxC = 0;
    for (const [e, cnt] of embC) if (cnt > maxC) { maxC = cnt; topEmb = e; }

    const talC = new Map();
    let topTalKey = ''; maxC = 0;
    for (const ts of p.talentSets) {
      const key = ts.map(t => (t.id || '') + '' + (t.name || '')).sort().join('');
      const cnt = (talC.get(key) || 0) + 1;
      talC.set(key, cnt);
      if (cnt > maxC) { maxC = cnt; topTalKey = key; }
    }
    let topTalents = [];
    if (topTalKey) topTalents = topTalKey.split('').map(s => {
      const [id, nm] = s.split('');
      return { id, name: nm };
    });

    players.push({
      name, games: p.games, wins: p.wins,
      wr: p.games ? p.wins / p.games : 0, wlb: wilsonLower(p.wins, p.games),
      top_build: topBuild, top_emblem: topEmb, top_talents: topTalents,
    });
  }
  players.sort((a, b) => b.games - a.games || b.wlb - a.wlb);

  const spells = [];
  for (const v of spellMap.values()) {
    spells.push({
      name: v.name, games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games), cs: v.cs,
    });
  }
  spells.sort((a, b) => b.games - a.games || b.wlb - a.wlb);

  return {
    total_games: total, wins, wr: total ? wins / total : 0,
    items, item_combos, emblems, talents, emblem_talent_combos,
    players: players.slice(0, TOP_PLAYERS),
    spells,
  };
}

// Aggregate combat stats over a set of matches (each carrying an optional m.cs).
// Counts -> per-game averages; ratios/shares/KDA -> pooled (sum/sum), so 0-death
// games don't blow up. Mirrors combat_aggregate() in process_data.py.
function combatAggregate(matches) {
  const sr = (matches || []).filter(m => m.cs);
  const n = sr.length;
  if (!n) return null;
  let sk = 0, sd = 0, sa = 0, sdmg = 0, sdt = 0, sg = 0, ssec = 0, std = 0;
  for (const m of sr) {
    const c = m.cs;
    sk += c.k; sd += c.d; sa += c.a; sdmg += c.dmg;
    sdt += c.dt; sg += c.g; ssec += c.sec; std += c.td;
  }
  return {
    n,
    k: sk / n, d: sd / n, a: sa / n,
    kda: sd ? (sk + sa) / sd : (sk + sa),
    dmg: sdmg / n,
    dpm: ssec ? sdmg / (ssec / 60) : 0,
    dmg_gold: sg ? sdmg / sg * 100 : 0,     // percent
    dmg_share: std ? sdmg / std * 100 : 0,  // percent
    dtaken: sdt / n,
    dt_death: sd ? sdt / sd : sdt,
  };
}

// Compact number formatting for the stats tables.
function fmtK(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return (n / 1000).toFixed(a >= 10000 ? 1 : 2) + 'k';
  return Math.round(n).toString();
}
function fmtInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
function fmt1(n) { return n == null ? '—' : n.toFixed(1); }
function fmt2(n) { return n == null ? '—' : n.toFixed(2); }
function fmtPct(n) { return n == null ? '—' : n.toFixed(1) + '%'; }

// Accumulate per-match combat stats into a running sum bucket (for per-row combat
// aggregates on builds/emblems/talents). `acc` may be undefined on first call.
function csAdd(acc, cs) {
  if (!acc) acc = { n: 0, k: 0, d: 0, a: 0, dmg: 0, dt: 0, g: 0, sec: 0, td: 0 };
  acc.n++; acc.k += cs.k; acc.d += cs.d; acc.a += cs.a; acc.dmg += cs.dmg;
  acc.dt += cs.dt; acc.g += cs.g; acc.sec += cs.sec; acc.td += cs.td;
  return acc;
}

// Compute one combat metric from a sum bucket. Counts -> per-game avg; ratios pooled.
function metricValue(acc, key) {
  if (!acc || !acc.n) return null;
  const n = acc.n;
  switch (key) {
    case 'kda':       return acc.d ? (acc.k + acc.a) / acc.d : (acc.k + acc.a);
    case 'dmg':       return acc.dmg / n;
    case 'dpm':       return acc.sec ? acc.dmg / (acc.sec / 60) : 0;
    case 'dmg_gold':  return acc.g ? acc.dmg / acc.g * 100 : 0;
    case 'dmg_share': return acc.td ? acc.dmg / acc.td * 100 : 0;
    case 'dtaken':    return acc.dt / n;
    case 'dt_death':  return acc.d ? acc.dt / acc.d : acc.dt;
    case 'k':         return acc.k / n;
    case 'd':         return acc.d / n;
    case 'a':         return acc.a / n;
  }
  return null;
}

// Selectable combat metrics for the builds/emblems/talents tables (dropdown).
const METRICS = [
  { key: 'kda',       label: 'KDA',          fmt: fmt2 },
  { key: 'dmg',       label: 'Damage',       fmt: fmtInt },
  { key: 'dpm',       label: 'DMG / min',    fmt: fmtInt },
  { key: 'dmg_gold',  label: 'DMG / gold',   fmt: fmtPct },
  { key: 'dmg_share', label: '% team DMG',   fmt: fmtPct },
  { key: 'dtaken',    label: 'DMG taken',    fmt: fmtInt },
  { key: 'dt_death',  label: 'Taken / death',fmt: fmtInt },
  { key: 'k',         label: 'Avg kills',    fmt: fmt1 },
  { key: 'd',         label: 'Avg deaths',   fmt: fmt1 },
  { key: 'a',         label: 'Avg assists',  fmt: fmt1 },
];

createApp({
  setup() {
    // --- state ---
    const view = ref('list');
    const search = ref('');
    const sortBy = ref('games');
    const minGames = ref(0);
    const heroes = ref([]);
    const hero = ref(null);
    const tab = ref('items');
    const loading = ref(false);
    const comboSize = ref('6');

    // Date filter state (per-hero detail view)
    const dateFrom = ref('');
    const dateTo = ref('');
    const dateMin = ref('');
    const dateMax = ref('');

    // Matchup filter (per-hero detail view)
    const enemyFilter = ref('');

    // Sorting per table
    const spellSort = ref({ key: 'games', dir: -1 });

    // Sorting state per table
    const itemSort = ref({ key: 'wlb', dir: -1 });
    const comboSort = ref({ key: 'wlb', dir: -1 });
    const emblemSort = ref({ key: 'games', dir: -1 });
    const talentSort = ref({ key: 'wlb', dir: -1 });
    const embTalSort = ref({ key: 'wlb', dir: -1 });
    const playerSort = ref({ key: 'games', dir: -1 });

    // Combat-stats leaderboard state
    const statSort = ref({ key: 'dmg', dir: -1 });
    const statMinGames = ref(3);

    // Optional combat-metric column shown in the build/emblem/talent tables ('' = off)
    const metric = ref('');

    // Talent filters
    const talentClassFilter = ref('');
    const talentTypeFilter = ref('');

    // Name → item id index (built from items.json)
    const nameIndex = ref({});

    // Admin state
    const tournaments = ref([]);
    const uploading = ref(false);
    const uploadMsg = ref('');
    const uploadError = ref(false);
    const dragOver = ref(false);
    const deleting = ref(null);
    const rebuilding = ref(false);
    const rebuildOutput = ref('');

    // Config state
    const configStatus = ref({ token_set: false, uid: '', token_preview: '' });
    const cfgToken = ref('');
    const cfgUid = ref('');
    const configMsg = ref('');

    // Fetch state
    const fetchTournamentId = ref('');
    const fetchStartDate = ref('');
    const fetchEndDate = ref('');
    const fetching = ref(false);
    const fetchMsg = ref('');
    const fetchError = ref(false);

    // --- loaders ---
    async function loadHeroes() {
      const resp = await fetch('data/heroes.json');
      heroes.value = await resp.json();
    }

    async function loadNameIndex() {
      try {
        const resp = await fetch('data/items_name_index.json');
        if (resp.ok) nameIndex.value = await resp.json();
      } catch(e) {}
    }

    async function openHero(h) {
      if (h.games === 0) return;
      loading.value = true;
      try {
        const resp = await fetch(`data/heroes/${h.slug}.json`);
        hero.value = await resp.json();
        view.value = 'hero';
        tab.value = 'items';
        // Compute available date range from raw matches
        const dates = (hero.value.matches || []).map(m => m.d).filter(Boolean).sort();
        dateMin.value = dates[0] || '';
        dateMax.value = dates[dates.length - 1] || '';
        dateFrom.value = '';
        dateTo.value = '';
        enemyFilter.value = '';
        window.location.hash = `#/hero/${h.slug}`;
      } catch(e) {
        console.error('Failed to load hero', e);
      }
      loading.value = false;
      nextTick(() => window.scrollTo(0, 0));
    }

    function goHome() {
      view.value = 'list';
      hero.value = null;
      window.location.hash = '';
    }

    function goStats() {
      view.value = 'stats';
      hero.value = null;
      window.location.hash = '#/stats';
      nextTick(() => window.scrollTo(0, 0));
    }

    function setDatePreset(preset) {
      if (!dateMax.value) return;
      const max = dateMax.value;
      const maxDate = new Date(max + 'T00:00:00');
      const fmt = (d) => d.toISOString().slice(0, 10);
      if (preset === 'all') {
        dateFrom.value = ''; dateTo.value = '';
      } else if (preset === '7d') {
        const from = new Date(maxDate); from.setDate(from.getDate() - 6);
        dateFrom.value = fmt(from); dateTo.value = max;
      } else if (preset === '14d') {
        const from = new Date(maxDate); from.setDate(from.getDate() - 13);
        dateFrom.value = fmt(from); dateTo.value = max;
      } else if (preset === '30d') {
        const from = new Date(maxDate); from.setDate(from.getDate() - 29);
        dateFrom.value = fmt(from); dateTo.value = max;
      }
    }

    // --- Admin functions ---
    function toggleAdmin() {
      if (view.value === 'admin') { goHome(); return; }
      view.value = 'admin';
      window.location.hash = '#/admin';
      loadTournaments();
      loadConfigStatus();
    }

    async function loadTournaments() {
      try {
        const resp = await fetch('/api/tournaments');
        if (resp.ok) tournaments.value = await resp.json();
      } catch(e) {
        tournaments.value = [];
      }
    }

    async function loadConfigStatus() {
      try {
        const resp = await fetch('/api/config');
        if (resp.ok) configStatus.value = await resp.json();
      } catch(e) {}
    }

    async function saveConfig() {
      configMsg.value = '';
      const body = {};
      if (cfgToken.value) body.token = cfgToken.value;
      if (cfgUid.value) body.uid = cfgUid.value;
      try {
        const resp = await fetch('/api/config', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          configMsg.value = 'Token saved';
          cfgToken.value = '';
          cfgUid.value = '';
          await loadConfigStatus();
        }
      } catch(e) {
        configMsg.value = 'Error: ' + e.message;
      }
    }

    async function fetchFromScoregg() {
      fetching.value = true;
      fetchMsg.value = '';
      fetchError.value = false;
      try {
        const body = {
          tournament_id: fetchTournamentId.value,
          start_time: fetchStartDate.value || '',
          end_time: fetchEndDate.value || '',
        };
        const resp = await fetch('/api/tournaments/fetch', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (resp.ok) {
          fetchMsg.value = data.message;
          await loadTournaments();
        } else {
          fetchMsg.value = data.error || 'Fetch failed';
          fetchError.value = true;
        }
      } catch(e) {
        fetchMsg.value = 'Error: ' + e.message;
        fetchError.value = true;
      }
      fetching.value = false;
    }

    async function uploadFiles(files) {
      uploading.value = true;
      uploadMsg.value = '';
      uploadError.value = false;
      let results = [];
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        try {
          const resp = await fetch('/api/tournaments/upload', { method: 'POST', body: form });
          const data = await resp.json();
          if (resp.ok) {
            results.push(`${file.name}: ${data.tournament?.records || 0} records`);
          } else {
            results.push(`${file.name}: ERROR — ${data.error}`);
            uploadError.value = true;
          }
        } catch(e) {
          results.push(`${file.name}: ERROR — ${e.message}`);
          uploadError.value = true;
        }
      }
      uploadMsg.value = results.join('\n');
      uploading.value = false;
      loadTournaments();
    }

    function handleDrop(e) {
      dragOver.value = false;
      const files = [...e.dataTransfer.files].filter(f =>
        f.name.endsWith('.json') || f.name.endsWith('.xls')
      );
      if (files.length) uploadFiles(files);
    }

    function handleFileSelect(e) {
      const files = [...e.target.files];
      if (files.length) uploadFiles(files);
      e.target.value = '';
    }

    async function deleteTournament(t) {
      if (!confirm(`Delete ${t.filename}? (${t.records} records)`)) return;
      deleting.value = t.filename;
      try {
        const resp = await fetch(`/api/tournaments/${t.filename}`, { method: 'DELETE' });
        if (resp.ok) {
          loadTournaments();
        }
      } catch(e) { }
      deleting.value = null;
    }

    async function rebuild() {
      rebuilding.value = true;
      rebuildOutput.value = '';
      try {
        const resp = await fetch('/api/rebuild', { method: 'POST' });
        const data = await resp.json();
        rebuildOutput.value = data.output || '';
        if (data.success) {
          rebuildOutput.value += '\n✓ Rebuild complete! Reloading heroes...';
          await loadHeroes();
        } else {
          rebuildOutput.value += '\n✗ Rebuild failed (see output above)';
        }
      } catch(e) {
        rebuildOutput.value = 'Error: ' + e.message;
      }
      rebuilding.value = false;
    }

    // --- computed: hero list ---
    const filteredHeroes = computed(() => {
      let list = heroes.value.filter(h => {
        if (minGames.value > 0 && h.games < minGames.value && h.games > 0) return false;
        if (search.value && !h.name.toLowerCase().includes(search.value.toLowerCase())) return false;
        return true;
      });
      const s = sortBy.value;
      if (s === 'games') list.sort((a, b) => b.games - a.games);
      else if (s === 'wr') list.sort((a, b) => b.wr - a.wr || b.games - a.games);
      else if (s === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    });

    // --- computed: combat-stats leaderboard (one row per hero) ---
    const statRows = computed(() => {
      const rows = heroes.value
        .filter(h => h.cs && h.games >= statMinGames.value)
        .map(h => ({
          slug: h.slug, name: h.name, portrait: h.portrait,
          games: h.games, wr: h.wr,
          ...h.cs,   // n, k, d, a, kda, dmg, dpm, dmg_gold, dmg_share, dtaken, dt_death
        }));
      const { key, dir } = statSort.value;
      rows.sort((a, b) => {
        const av = a[key], bv = b[key];
        if (typeof av === 'string') return dir * av.localeCompare(bv);
        return dir * ((av ?? 0) - (bv ?? 0));
      });
      return rows;
    });
    function sortStats(k) { toggleSort(statSort, k); }
    function statCls(k) {
      if (statSort.value.key !== k) return '';
      return statSort.value.dir < 0 ? 'sort-desc' : 'sort-asc';
    }

    // --- computed: filtered matches + aggregated stats ---
    const filteredMatches = computed(() => {
      const ms = hero.value?.matches || [];
      const from = dateFrom.value, to = dateTo.value;
      const enemy = enemyFilter.value;
      if (!from && !to && !enemy) return ms;
      return ms.filter(m => {
        if (from && (!m.d || m.d < from)) return false;
        if (to && (!m.d || m.d > to)) return false;
        if (enemy && !(m.enemies || []).includes(enemy)) return false;
        return true;
      });
    });

    const enemyCounts = computed(() => {
      const counts = new Map();
      const ms = hero.value?.matches || [];
      for (const m of ms) {
        for (const e of m.enemies || []) {
          counts.set(e, (counts.get(e) || 0) + 1);
        }
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, games]) => ({ name, games }));
    });

    const aggregated = computed(() => aggregate(filteredMatches.value));

    // Combat stats for the current hero, over the same date/enemy-filtered matches.
    const heroCombat = computed(() => combatAggregate(filteredMatches.value));

    // --- computed: hero detail tables ---
    function makeSorter(data, state) {
      return computed(() => {
        if (!data.value) return [];
        const arr = [...data.value];
        const { key, dir } = state.value;
        const mk = metric.value;
        arr.sort((a, b) => {
          let av, bv;
          if (key === 'mv') {
            av = metricValue(a.cs, mk); bv = metricValue(b.cs, mk);
            if (av == null) av = -Infinity;
            if (bv == null) bv = -Infinity;
          } else { av = a[key]; bv = b[key]; }
          if (typeof av === 'string') return dir * av.localeCompare(bv);
          return dir * (av - bv);
        });
        return arr;
      });
    }

    const heroItems = computed(() => aggregated.value.items);
    const sortedItems = makeSorter(heroItems, itemSort);

    const heroCombos = computed(() => aggregated.value.item_combos[comboSize.value] || []);
    const sortedCombos = makeSorter(heroCombos, comboSort);

    const heroEmblems = computed(() => aggregated.value.emblems);
    const sortedEmblems = makeSorter(heroEmblems, emblemSort);

    const heroTalents = computed(() => {
      let list = aggregated.value.talents;
      if (talentClassFilter.value) list = list.filter(t => t.class === talentClassFilter.value);
      if (talentTypeFilter.value) list = list.filter(t => t.type === talentTypeFilter.value);
      return list;
    });
    const sortedTalents = makeSorter(heroTalents, talentSort);

    const talentClasses = computed(() => {
      const classes = new Set(aggregated.value.talents.map(t => t.class));
      return [...classes].sort();
    });

    const heroEmbTal = computed(() => aggregated.value.emblem_talent_combos);
    const sortedEmbTal = makeSorter(heroEmbTal, embTalSort);

    const heroPlayers = computed(() => aggregated.value.players);
    const sortedPlayers = makeSorter(heroPlayers, playerSort);

    const heroSpells = computed(() => aggregated.value.spells || []);
    const sortedSpells = makeSorter(heroSpells, spellSort);

    function spellIcon(name) {
      if (!name) return '';
      if (name === 'Ice Retribution') return 'img/battle_spells/Item_Ice_Retribution.png';
      if (name === 'Flame Retribution') return 'img/battle_spells/Item_Flame_Retribution.png';
      if (name === 'Bloody Retribution') return 'img/battle_spells/Item_Bloody_Retribution.png';
      return `img/battle_spells/${name}.png`;
    }
    function heroIcon(name) {
      const slug = (name || '').toLowerCase().replace(/ /g,'_').replace(/\./g,'_').replace(/'/g,'').replace(/\//g,'_');
      return `img/heroes/${slug}.png`;
    }
    function heroSlugFromName(name) {
      return (name || '').toLowerCase().replace(/ /g,'_').replace(/\./g,'_').replace(/'/g,'').replace(/\//g,'_');
    }

    // --- sort togglers ---
    function toggleSort(state, key) {
      if (state.value.key === key) state.value = { key, dir: -state.value.dir };
      else state.value = { key, dir: -1 };
    }
    const sortItems = (k) => toggleSort(itemSort, k);
    const sortCombos = (k) => toggleSort(comboSort, k);
    const sortEmblems = (k) => toggleSort(emblemSort, k);
    const sortTalents = (k) => toggleSort(talentSort, k);
    const sortEmbTal = (k) => toggleSort(embTalSort, k);
    const sortPlayers = (k) => toggleSort(playerSort, k);
    const sortSpells = (k) => toggleSort(spellSort, k);

    // --- icon helpers ---
    function itemIcon(id) {
      return id ? `img/items/${id}.png` : '';
    }
    function itemIconByName(name) {
      const normalized = name.toLowerCase().trim().replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ');
      const id = nameIndex.value[normalized];
      if (id) return `img/items/${id}.png`;
      return '';
    }
    function runeIcon(id) {
      return id ? `img/runes/${id}.png` : '';
    }
    function emblemIcon(id) {
      return id ? `img/emblems/${id}.png` : '';
    }

    // --- formatting ---
    function wrClass(wr) {
      if (wr >= 0.55) return 'wr-high';
      if (wr >= 0.48) return 'wr-mid';
      return 'wr-low';
    }
    function deltaFmt(d) {
      return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%';
    }
    function deltaClass(d) {
      return d >= 0 ? 'wr-high' : 'wr-low';
    }

    // Label + formatted value for the currently selected combat metric column.
    const metricLabel = computed(() => {
      const m = METRICS.find(x => x.key === metric.value);
      return m ? m.label : '';
    });
    function mvFmt(row) {
      const m = METRICS.find(x => x.key === metric.value);
      if (!m) return '';
      const v = metricValue(row && row.cs, metric.value);
      return v == null ? '—' : m.fmt(v);
    }

    // --- routing ---
    async function handleRoute() {
      const hash = window.location.hash;
      if (hash === '#/admin') {
        view.value = 'admin';
        loadTournaments();
        return;
      }
      if (hash === '#/stats') {
        view.value = 'stats';
        return;
      }
      const m = hash.match(/^#\/hero\/(.+)$/);
      if (m) {
        const slug = m[1];
        const h = heroes.value.find(h => h.slug === slug);
        if (h && h.games > 0) {
          await openHero(h);
          return;
        }
      }
      goHome();
    }

    // --- init ---
    onMounted(async () => {
      await loadHeroes();
      await loadNameIndex();
      handleRoute();
    });

    window.addEventListener('hashchange', handleRoute);

    return {
      view, search, sortBy, minGames, heroes, hero, tab, loading,
      comboSize, talentClassFilter, talentTypeFilter,
      dateFrom, dateTo, dateMin, dateMax, setDatePreset,
      enemyFilter, enemyCounts,
      filteredMatches, aggregated, heroCombat,
      filteredHeroes, sortedItems, sortedCombos, sortedEmblems,
      sortedTalents, sortedEmbTal, sortedPlayers, sortedSpells, talentClasses,
      statRows, statSort, statMinGames, sortStats, statCls,
      metric, metrics: METRICS, metricLabel, mvFmt,
      openHero, goHome, goStats, toggleAdmin,
      sortItems, sortCombos, sortEmblems, sortTalents, sortEmbTal, sortPlayers, sortSpells,
      itemIcon, itemIconByName, runeIcon, emblemIcon, spellIcon, heroIcon, heroSlugFromName,
      wrClass, deltaFmt, deltaClass, fmtK, fmtInt, fmt1, fmt2, fmtPct,
      // Admin
      tournaments, uploading, uploadMsg, uploadError, dragOver,
      deleting, rebuilding, rebuildOutput,
      handleDrop, handleFileSelect, deleteTournament, rebuild,
      // Config + Fetch
      configStatus, cfgToken, cfgUid, configMsg, saveConfig,
      fetchTournamentId, fetchStartDate, fetchEndDate, fetching, fetchMsg, fetchError,
      fetchFromScoregg,
    };
  }
}).mount('#app');
