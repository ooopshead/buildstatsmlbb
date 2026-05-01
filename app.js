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

function aggregate(matches) {
  const itemMap = new Map();
  const comboMap = { 3: new Map(), 4: new Map(), 5: new Map(), 6: new Map() };
  const emblemMap = new Map();
  const talentMap = new Map();
  const embTalMap = new Map();
  const playerMap = new Map();
  let total = matches.length, wins = 0;

  for (const m of matches) {
    wins += m.w;

    const itemNames = (m.items || []).filter(Boolean);
    const sortedItems = [...itemNames].sort();
    for (const name of itemNames) {
      const v = itemMap.get(name) || [0, 0];
      v[0] += m.w; v[1]++;
      itemMap.set(name, v);
    }
    for (const k of [3, 4, 5, 6]) {
      if (sortedItems.length >= k) {
        for (const combo of combinations(sortedItems, k)) {
          const key = combo.join('');
          let v = comboMap[k].get(key);
          if (!v) { v = { wins: 0, games: 0, items: combo }; comboMap[k].set(key, v); }
          v.wins += m.w; v.games++;
        }
      }
    }
    if (m.e) {
      let v = emblemMap.get(m.e);
      if (!v) { v = { wins: 0, games: 0, eid: m.eid, name: m.e }; emblemMap.set(m.e, v); }
      v.wins += m.w; v.games++;
    }
    for (const t of m.t || []) {
      let v = talentMap.get(t.id);
      if (!v) { v = { wins: 0, games: 0, id: t.id, name: t.name, class: t.class, type: t.type }; talentMap.set(t.id, v); }
      v.wins += m.w; v.games++;
    }
    if (m.e && m.t && m.t.length) {
      const sortedTal = [...m.t].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      const tk = sortedTal.map(t => t.id + '' + t.name).join('');
      const key = m.e + '' + tk;
      let v = embTalMap.get(key);
      if (!v) {
        v = {
          wins: 0, games: 0, eid: m.eid, emblem: m.e,
          talents: sortedTal.map(t => ({ id: t.id, name: t.name })),
        };
        embTalMap.set(key, v);
      }
      v.wins += m.w; v.games++;
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
  for (const [name, [w, g]] of itemMap) {
    items.push({ id: null, name, games: g, wins: w, wr: g ? w / g : 0, wlb: wilsonLower(w, g) });
  }

  const item_combos = {};
  for (const k of [3, 4, 5, 6]) {
    const arr = [];
    for (const v of comboMap[k].values()) {
      arr.push({
        items: v.items, games: v.games, wins: v.wins,
        wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games),
      });
    }
    arr.sort((a, b) => b.wlb - a.wlb || b.games - a.games);
    item_combos[k] = arr.slice(0, TOP_COMBOS);
  }

  const emblems = [];
  for (const v of emblemMap.values()) {
    emblems.push({
      id: v.eid, name: v.name, games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games),
    });
  }

  const talents = [];
  for (const v of talentMap.values()) {
    talents.push({
      id: v.id, name: v.name, class: v.class, type: v.type,
      games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games),
    });
  }

  const emblem_talent_combos = [];
  for (const v of embTalMap.values()) {
    emblem_talent_combos.push({
      emblem_id: v.eid, emblem: v.emblem, talents: v.talents,
      games: v.games, wins: v.wins,
      wr: v.games ? v.wins / v.games : 0, wlb: wilsonLower(v.wins, v.games),
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

  return {
    total_games: total, wins, wr: total ? wins / total : 0,
    items, item_combos, emblems, talents, emblem_talent_combos,
    players: players.slice(0, TOP_PLAYERS),
  };
}

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

    // Sorting state per table
    const itemSort = ref({ key: 'wlb', dir: -1 });
    const comboSort = ref({ key: 'wlb', dir: -1 });
    const emblemSort = ref({ key: 'games', dir: -1 });
    const talentSort = ref({ key: 'wlb', dir: -1 });
    const embTalSort = ref({ key: 'wlb', dir: -1 });
    const playerSort = ref({ key: 'games', dir: -1 });

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

    // --- computed: filtered matches + aggregated stats ---
    const filteredMatches = computed(() => {
      const ms = hero.value?.matches || [];
      const from = dateFrom.value, to = dateTo.value;
      if (!from && !to) return ms;
      return ms.filter(m => {
        if (from && (!m.d || m.d < from)) return false;
        if (to && (!m.d || m.d > to)) return false;
        return true;
      });
    });

    const aggregated = computed(() => aggregate(filteredMatches.value));

    // --- computed: hero detail tables ---
    function makeSorter(data, state) {
      return computed(() => {
        if (!data.value) return [];
        const arr = [...data.value];
        const { key, dir } = state.value;
        arr.sort((a, b) => {
          const av = a[key], bv = b[key];
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

    // --- routing ---
    async function handleRoute() {
      const hash = window.location.hash;
      if (hash === '#/admin') {
        view.value = 'admin';
        loadTournaments();
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
      filteredMatches, aggregated,
      filteredHeroes, sortedItems, sortedCombos, sortedEmblems,
      sortedTalents, sortedEmbTal, sortedPlayers, talentClasses,
      openHero, goHome, toggleAdmin,
      sortItems, sortCombos, sortEmblems, sortTalents, sortEmbTal, sortPlayers,
      itemIcon, itemIconByName, runeIcon, emblemIcon,
      wrClass, deltaFmt, deltaClass,
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
