const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

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
      } catch(e) {
        // Optional file — if missing, itemIconByName falls back
      }
    }

    async function openHero(h) {
      if (h.games === 0) return;
      loading.value = true;
      try {
        const resp = await fetch(`data/heroes/${h.slug}.json`);
        hero.value = await resp.json();
        view.value = 'hero';
        tab.value = 'items';
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

    const heroItems = computed(() => hero.value?.items || []);
    const sortedItems = makeSorter(heroItems, itemSort);

    const heroCombos = computed(() => {
      if (!hero.value?.item_combos) return [];
      return hero.value.item_combos[comboSize.value] || [];
    });
    const sortedCombos = makeSorter(heroCombos, comboSort);

    const heroEmblems = computed(() => hero.value?.emblems || []);
    const sortedEmblems = makeSorter(heroEmblems, emblemSort);

    const heroTalents = computed(() => {
      let list = hero.value?.talents || [];
      if (talentClassFilter.value) list = list.filter(t => t.class === talentClassFilter.value);
      if (talentTypeFilter.value) list = list.filter(t => t.type === talentTypeFilter.value);
      return list;
    });
    const sortedTalents = makeSorter(heroTalents, talentSort);

    const talentClasses = computed(() => {
      const classes = new Set((hero.value?.talents || []).map(t => t.class));
      return [...classes].sort();
    });

    const heroEmbTal = computed(() => hero.value?.emblem_talent_combos || []);
    const sortedEmbTal = makeSorter(heroEmbTal, embTalSort);

    const heroPlayers = computed(() => hero.value?.players || []);
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
      // Try name_index lookup first
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
