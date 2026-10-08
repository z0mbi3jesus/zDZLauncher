import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, CircleHelp, Copy, Download, Filter,
  FolderOpen, Gamepad2, Globe2, Heart, History, LayoutDashboard, ListFilter, LoaderCircle,
  LockKeyhole, Map as MapIcon, Play, Plus, RefreshCw, Search, Server as ServerIcon,
  Settings2, ShieldCheck, Signal, SlidersHorizontal, Sparkles, Star, Users,
  Wrench, X,
} from 'lucide-react';
import type { AppStatus, DayZServer, ServerScope, WorkshopMod, ServerModMatch } from '../electron/preload';

type Page = 'launch' | 'servers' | 'mods' | 'profiles' | 'settings';
type StoredProfile = { id: string; name: string; modIds: string[] };
type ModState = WorkshopMod & { enabled: boolean };

const starterProfile: StoredProfile = { id: 'survivor', name: 'Survivor', modIds: [] };

function loadProfiles(): StoredProfile[] {
  try {
    const saved = JSON.parse(localStorage.getItem('dz-profiles') ?? '[]') as StoredProfile[];
    return saved.length ? saved : [starterProfile];
  } catch {
    return [starterProfile];
  }
}

function App() {
  const [page, setPage] = useState<Page>('launch');
  const [status, setStatus] = useState<AppStatus>({ gamePath: '', gameFound: false, workshopPath: '', mods: [] });
  const [profiles, setProfiles] = useState<StoredProfile[]>(loadProfiles);
  const [activeProfile, setActiveProfile] = useState('survivor');
  const [mods, setMods] = useState<ModState[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [runtimeLogPath, setRuntimeLogPath] = useState('');
  const [serverModList, setServerModList] = useState<ServerModMatch[]>([]);
  const [serverModsLoading, setServerModsLoading] = useState(false);
  const [serverModsError, setServerModsError] = useState('');
  const [modCheckVersion, setModCheckVersion] = useState(0);
  const joining = useRef(false);
  const [serverScope, setServerScope] = useState<ServerScope>('internet');
  const [serverResults, setServerResults] = useState<DayZServer[]>([]);
  const [serverFavorites, setServerFavorites] = useState<string[]>([]);
  const [selectedServerAddress, setSelectedServerAddress] = useState('');
  const [serverSearch, setServerSearch] = useState('');
  const [serverMap, setServerMap] = useState('all');
  const [serverCategory, setServerCategory] = useState<'official' | 'community'>('official');
  const [serverSort, setServerSort] = useState<'players' | 'ping' | 'name' | 'map'>('players');
  const [serverLoading, setServerLoading] = useState(false);
  const [serverProgress, setServerProgress] = useState({ complete: 0, total: 0 });
  const [serverError, setServerError] = useState('');
  const [serverAddressInput, setServerAddressInput] = useState('');
  const [showAddServer, setShowAddServer] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [hideFull, setHideFull] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hideLocked, setHideLocked] = useState(false);
  const [secureOnly, setSecureOnly] = useState(false);
  const [maxPing, setMaxPing] = useState(2500);
  const activeServerScan = useRef('');
  const serverCache = useRef<Partial<Record<ServerScope, DayZServer[]>>>({});
  const activeServerScope = useRef<ServerScope>('internet');
  const [serverScrollTop, setServerScrollTop] = useState(0);
  const serverRowsRef = useRef<HTMLDivElement>(null);
  const deferredServerSearch = useDeferredValue(serverSearch);

  const profile = profiles.find((item) => item.id === activeProfile) ?? profiles[0];
  const enabledMods = mods.filter((mod) => mod.enabled);
  const filteredMods = useMemo(() => mods.filter((mod) => {
    const matchesSearch = `${mod.name} ${mod.id}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'enabled' ? mod.enabled : !mod.enabled);
    return matchesSearch && matchesFilter;
  }), [filter, mods, query]);

  const visibleServers = useMemo(() => serverResults.filter((server) => {
    const matchesSearch = `${server.name} ${server.map} ${server.address} ${server.tags.join(' ')}`.toLowerCase().includes(deferredServerSearch.toLowerCase());
    return matchesSearch
      && (serverCategory === 'official' ? server.category === 'official' : server.category !== 'official')
      && (serverMap === 'all' || server.map.toLowerCase() === serverMap.toLowerCase())
      && (!hideFull || server.players < server.maxPlayers)
      && (!hideEmpty || server.players > 0)
      && (!hideLocked || !server.password)
      && (!secureOnly || server.vac)
      && (maxPing >= 2500 || (server.ping !== null && server.ping <= maxPing));
  }).sort((left, right) => {
    if (serverSort === 'ping') return (left.ping ?? Number.MAX_SAFE_INTEGER) - (right.ping ?? Number.MAX_SAFE_INTEGER);
    if (serverSort === 'name') return left.name.localeCompare(right.name);
    if (serverSort === 'map') return left.map.localeCompare(right.map) || right.players - left.players;
    return right.players - left.players || (left.ping ?? Number.MAX_SAFE_INTEGER) - (right.ping ?? Number.MAX_SAFE_INTEGER);
  }), [hideEmpty, hideFull, hideLocked, maxPing, secureOnly, serverMap, serverCategory, serverResults, deferredServerSearch, serverSort]);
  const firstVisibleRow = Math.max(0, Math.min(Math.floor(serverScrollTop / 61) - 5, visibleServers.length - 30));
  const renderedServers = visibleServers.slice(firstVisibleRow, firstVisibleRow + 30);
  const selectedServer = visibleServers.find((server) => server.address === selectedServerAddress);
  const officialServerCount = useMemo(() => serverResults.filter((server) => server.category === 'official').length, [serverResults]);
  const serverMaps = useMemo(() => [...new Set(serverResults.map((server) => server.map).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [serverResults]);
  const typicalPing = useMemo(() => {
    const measured = serverResults.flatMap((server) => server.ping === null ? [] : [server.ping]).sort((a, b) => a - b);
    return measured.length ? measured[Math.floor(measured.length / 2)] : null;
  }, [serverResults]);

  useEffect(() => {
    setServerScrollTop(0);
    serverRowsRef.current?.scrollTo(0, 0);
  }, [serverScope, deferredServerSearch, serverMap, serverCategory, serverSort, hideFull, hideEmpty, hideLocked, secureOnly, maxPing]);

  async function refresh() {
    setWorking(true);
    try {
      const nextStatus = await window.dayz.status();
      setStatus(nextStatus);
      setMods((previous) => {
        const oldState = new Map(previous.map((mod) => [mod.id, mod]));
        const profileIds = new Set(profile?.modIds ?? []);
        const discovered = nextStatus.mods.map((mod) => ({
          ...mod,
          enabled: oldState.has(mod.id) ? oldState.get(mod.id)!.enabled : profileIds.has(mod.id),
        }));
        return discovered.sort((a, b) => {
          const aIndex = profile?.modIds.indexOf(a.id) ?? -1;
          const bIndex = profile?.modIds.indexOf(b.id) ?? -1;
          if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
          if (aIndex >= 0) return -1;
          if (bIndex >= 0) return 1;
          return a.name.localeCompare(b.name);
        });
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not scan the DayZ installation.');
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    void window.dayz.serverFavorites().then(setServerFavorites).catch(() => undefined);
    void window.dayz.logPath().then(setRuntimeLogPath).catch(() => undefined);
    return window.dayz.onServerProgress((progress) => {
      if (progress.id !== activeServerScan.current) return;
      serverCache.current[activeServerScope.current] = progress.servers;
      startTransition(() => {
        setServerResults(progress.servers);
        setServerProgress({ complete: progress.complete, total: progress.total });
      });
      setServerError('');
    });
  }, []);

  async function scanServers(scope = serverScope) {
    if (activeServerScan.current) void window.dayz.cancelServerSearch(activeServerScan.current);
    const id = crypto.randomUUID();
    activeServerScan.current = id;
    activeServerScope.current = scope;
    setServerLoading(true);
    setServerError('');
    setServerProgress({ complete: 0, total: 0 });
    setServerResults(serverCache.current[scope] ?? []);
    try {
      const results = await window.dayz.searchServers(id, scope);
      if (activeServerScan.current === id) {
        serverCache.current[scope] = results;
        setServerResults(results);
        setServerProgress({ complete: results.length, total: results.length });
        setSelectedServerAddress((current) => results.some((server) => server.address === current) ? current : results[0]?.address ?? '');
      }
    } catch (error) {
      if (activeServerScan.current === id) setServerError(error instanceof Error ? error.message : 'Steam server discovery failed.');
    } finally {
      if (activeServerScan.current === id) {
        activeServerScan.current = '';
        setServerLoading(false);
      }
    }
  }

  useEffect(() => {
    if (page !== 'servers') return;
    const cached = serverCache.current[serverScope];
    if (cached) {
      setServerResults(cached);
      setServerProgress({ complete: cached.length, total: cached.length });
      setServerError('');
    } else void scanServers(serverScope);
    return () => {
      const id = activeServerScan.current;
      if (id) {
        activeServerScan.current = '';
        void window.dayz.cancelServerSearch(id);
      }
      setServerLoading(false);
    };
  }, [page, serverScope]);

  async function toggleFavorite(server: DayZServer) {
    try {
      setServerFavorites(await window.dayz.toggleServerFavorite(server.address));
      delete serverCache.current.favorites;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update favorites.');
    }
  }

  async function addServer() {
    if (!serverAddressInput.trim()) return;
    setAddingServer(true);
    setServerError('');
    try {
      const added = await window.dayz.addServer(serverAddressInput);
      delete serverCache.current.favorites;
      setServerFavorites(await window.dayz.serverFavorites());
      setServerResults(added);
      setSelectedServerAddress(added[0]?.address ?? '');
      setServerScope('favorites');
      setServerAddressInput('');
      if (!added.length) setServerError('Address saved, but the server did not answer. Check its query port and try again.');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not add that server.');
    } finally {
      setAddingServer(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setServerModList([]);
    setServerModsError('');
    setServerModsLoading(Boolean(selectedServerAddress));
    if (selectedServerAddress) {
      window.dayz.serverMods(selectedServerAddress).then((result) => {
        if (!cancelled) setServerModList(result);
      }).catch((error) => {
        if (!cancelled) setServerModsError(error instanceof Error ? error.message : 'Could not retrieve required mods.');
      }).finally(() => { if (!cancelled) setServerModsLoading(false); });
    }
    return () => { cancelled = true; };
  }, [selectedServerAddress, modCheckVersion]);

  async function joinServer(server: DayZServer) {
    if (!status.gameFound) {
      setNotice('Set the DayZ installation path in Settings before joining.');
      return;
    }
    if (joining.current) return;
    const password = server.password ? window.prompt(`Password for ${server.name}`) : undefined;
    if (server.password && password === null) return;
    joining.current = true;
    try {
      setNotice(`Checking required mods for ${server.name}...`);
      await window.dayz.joinServer(server, [], password ?? undefined);
      delete serverCache.current.history;
      setNotice(`Connecting to ${server.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not join the server.');
      setModCheckVersion((value) => value + 1);
    } finally {
      joining.current = false;
    }
  }

  async function copyServerAddress(server: DayZServer) {
    try {
      await navigator.clipboard.writeText(server.address);
      setNotice(`Copied ${server.address}.`);
    } catch {
      setNotice('Clipboard access is unavailable.');
    }
  }

  useEffect(() => {
    localStorage.setItem('dz-profiles', JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    if (!profile) return;
    setMods((current) => current.map((mod) => ({ ...mod, enabled: profile.modIds.includes(mod.id) })));
  }, [activeProfile]);

  function saveCurrentProfile(nextMods: ModState[]) {
    setMods(nextMods);
    setProfiles((current) => current.map((item) => item.id === activeProfile
      ? { ...item, modIds: nextMods.filter((mod) => mod.enabled).map((mod) => mod.id) }
      : item));
  }

  function toggleMod(id: string) {
    saveCurrentProfile(mods.map((mod) => mod.id === id ? { ...mod, enabled: !mod.enabled } : mod));
  }

  function moveMod(id: string, direction: -1 | 1) {
    const index = mods.findIndex((mod) => mod.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= mods.length) return;
    const next = [...mods];
    [next[index], next[target]] = [next[target], next[index]];
    saveCurrentProfile(next);
  }

  async function launch() {
    try {
      setWorking(true);
      await window.dayz.launch(enabledMods);
      setNotice('DayZ is starting with your active mod set.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'DayZ could not be started.');
    } finally {
      setWorking(false);
    }
  }

  function createProfile() {
    const name = window.prompt('Profile name');
    if (!name?.trim()) return;
    const created = { id: crypto.randomUUID(), name: name.trim(), modIds: [] };
    setProfiles((current) => [...current, created]);
    setActiveProfile(created.id);
    setMods((current) => current.map((mod) => ({ ...mod, enabled: false })));
  }

  const navItems: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'launch', label: 'Launchpad', icon: LayoutDashboard },
    { id: 'servers', label: 'Server browser', icon: Globe2 },
    { id: 'mods', label: 'Mod library', icon: Gamepad2 },
    { id: 'profiles', label: 'Profiles', icon: SlidersHorizontal },
  ];

  return (
    <main className="app-shell">
      <aside className="rail">
        <div className="brand-mark"><span> DZ </span></div>
        <div className="rail-label">FIELD KIT</div>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)} title={label}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-spacer" />
        <div className={`connection ${status.gameFound ? 'online' : ''}`}>
          <span className="connection-dot" />
          <div><strong>{status.gameFound ? 'GAME READY' : 'GAME NOT FOUND'}</strong><small>{status.gameFound ? 'Local install detected' : 'Set your install path'}</small></div>
        </div>
        <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')} title="Settings">
          <Settings2 size={19} strokeWidth={1.8} /><span>Settings</span>
        </button>
        <div className="rail-version">DZ LAUNCHPAD <span>0.1.0</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumbs"><span>DAYZ</span><i>/</i><strong>{page === 'launch' ? 'LAUNCHPAD' : page === 'mods' ? 'MOD LIBRARY' : page === 'servers' ? 'SERVER BROWSER' : page.toUpperCase()}</strong></div>
          <div className="top-actions">
            <button className="icon-button" title="Open Workshop" onClick={() => void window.dayz.openWorkshop()}><Download size={17} /></button>
            <button className="icon-button" title="Refresh mod library" onClick={() => void refresh()}><RefreshCw size={16} className={working ? 'spin' : ''} /></button>
            <div className="profile-chip"><span className="profile-avatar">{profile?.name.slice(0, 1).toUpperCase() ?? 'S'}</span><span>{profile?.name ?? 'Survivor'}</span><ChevronDown size={14} /></div>
          </div>
        </header>

        {page === 'launch' && <div className="page-content launch-page">
          <div className="launch-heading">
            <div><div className="eyebrow"><span className="live-pip" /> READY CHECK</div><h1>Good hunting<span>.</span></h1><p>Configure your kit. Get out there.</p></div>
            <div className="heading-date">CHERNARUS<br /><span>42° 16' N / 42° 25' E</span></div>
          </div>

          <div className="hero-panel">
            <div className="hero-surface" />
            <div className="hero-content">
              <div className="hero-overline"><span>OFFICIAL SURVIVAL</span><span className="divider" /><span>STANDALONE</span></div>
              <h2>DayZ</h2>
              <p>Nothing is guaranteed. Make your own luck.</p>
              <div className="hero-bottom">
                <button className="launch-button" onClick={() => void launch()} disabled={working || !status.gameFound}>
                  {working ? <LoaderCircle className="spin" size={18} /> : <Play size={17} fill="currentColor" />}
                  <span>{working ? 'WORKING' : 'LAUNCH GAME'}</span><span className="button-key">↵</span>
                </button>
                <div className="hero-state"><span className={`state-dot ${status.gameFound ? '' : 'offline'}`} />{status.gameFound ? 'INSTALL VERIFIED' : 'INSTALL REQUIRED'}</div>
              </div>
            </div>
            <div className="hero-coordinate">Chernarus · 225 km²</div>
          </div>

          <div className="section-head"><div><span className="section-index">01</span><h3>ACTIVE LOADOUT</h3></div><button className="text-button" onClick={() => setPage('mods')}>MANAGE MODS <span>↗</span></button></div>
          <div className="loadout-strip">
            <div className="loadout-count"><strong>{enabledMods.length.toString().padStart(2, '0')}</strong><span>MODS ENABLED</span></div>
            {enabledMods.length ? <div className="loadout-items">{enabledMods.slice(0, 4).map((mod, index) => <div className="loadout-item" key={mod.id}><span className="loadout-num">0{index + 1}</span><span>{mod.name}</span></div>)}{enabledMods.length > 4 && <span className="more-mods">+{enabledMods.length - 4} MORE</span>}</div> : <div className="empty-loadout"><Sparkles size={16} /><span>No mods in this loadout</span><button onClick={() => void window.dayz.openWorkshop()}>BROWSE WORKSHOP <span>↗</span></button></div>}
            <button className="profile-select" onClick={() => setPage('profiles')}><span>PROFILE</span><strong>{profile?.name ?? 'Survivor'}</strong><ChevronDown size={15} /></button>
          </div>

          <div className="lower-grid">
            <div className="status-panel">
              <div className="section-head compact"><div><span className="section-index">02</span><h3>INSTALL STATUS</h3></div><ShieldCheck size={18} /></div>
              <div className="install-row"><span className={`status-symbol ${status.gameFound ? 'good' : ''}`}>{status.gameFound ? <Check size={14} /> : <X size={14} />}</span><div><strong>DayZ client</strong><small>{status.gameFound ? status.gamePath : 'Installation path not set'}</small></div><button className="subtle-button" onClick={() => setPage('settings')}>{status.gameFound ? 'CHANGE' : 'SET UP'}</button></div>
              <div className="install-row"><span className={`status-symbol ${status.workshopPath ? 'good' : ''}`}>{status.workshopPath ? <Check size={14} /> : <CircleHelp size={14} />}</span><div><strong>Workshop content</strong><small>{status.mods.length} local items detected</small></div><button className="subtle-button" onClick={() => status.workshopPath && void window.dayz.openFolder(status.workshopPath)}>OPEN</button></div>
            </div>
            <div className="intel-panel"><div className="intel-top"><Wrench size={16} /><span>FIELD NOTE</span><span className="intel-line" /></div><p>Mod load order matters. Keep framework mods above the mods that depend on them.</p><button onClick={() => setPage('mods')}>REVIEW LOAD ORDER <span>↗</span></button></div>
          </div>
        </div>}

        {page === 'servers' && <div className="page-content server-browser-page">
          <div className="page-title-row server-title-row"><div><div className="eyebrow"><span className="live-pip" /> DAYZ SERVER DIRECTORY</div><h1>Server browser<span>.</span></h1><p>Official and community listings, server details and quick join.</p></div><button className="primary-action" onClick={() => setShowAddServer((current) => !current)}><Plus size={16} /> ADD SERVER</button></div>

          <div className="server-scope-tabs server-category-tabs" role="tablist" aria-label="Server type">
            <button role="tab" aria-selected={serverCategory === 'official'} className={serverCategory === 'official' ? 'selected' : ''} onClick={() => setServerCategory('official')}><ShieldCheck size={16} /> OFFICIAL <span>{officialServerCount.toLocaleString()}</span></button>
            <button role="tab" aria-selected={serverCategory === 'community'} className={serverCategory === 'community' ? 'selected' : ''} onClick={() => setServerCategory('community')}><Users size={16} /> COMMUNITY <span>{(serverResults.length - officialServerCount).toLocaleString()}</span></button>
          </div>

          <div className="server-metrics">
            <div><span>VISIBLE SERVERS</span><strong>{visibleServers.length.toLocaleString()}</strong><small>{serverLoading && serverProgress.total ? `SCANNING ${serverProgress.complete.toLocaleString()} / ${serverProgress.total.toLocaleString()}` : 'MATCHING CURRENT FILTERS'}</small></div>
            <div><span>SERVER RESULTS</span><strong>{serverResults.length.toLocaleString()}</strong><small>{serverScope === 'internet' ? 'STEAM SERVER LIST' : serverScope === 'favorites' ? 'SAVED FAVORITES' : 'RECENT CONNECTIONS'}</small></div>
            <div><span>MEDIAN PING</span><strong>{typicalPing !== null ? `${typicalPing} <i>MS</i>` : '--'}</strong><small>RESPONDING SERVERS</small></div>
            <div><span>FAVORITES</span><strong>{serverFavorites.length.toString().padStart(2, '0')}</strong><small>STORED ON THIS PC</small></div>
          </div>

          {showAddServer && <form className="server-add-form" onSubmit={(event) => { event.preventDefault(); void addServer(); }}><div><strong>ADD BY ADDRESS</strong><span>Enter a server address; common game/query port pairs are checked.</span></div><input aria-label="Server address" value={serverAddressInput} onChange={(event) => setServerAddressInput(event.target.value)} placeholder="play.example.net:2302" autoFocus /><button className="primary-action" type="submit" disabled={addingServer || !serverAddressInput.trim()}>{addingServer ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} SAVE & QUERY</button><button type="button" className="icon-button" aria-label="Close add server" onClick={() => setShowAddServer(false)}><X size={15} /></button></form>}

          <div className="server-toolbar">
            <div className="server-scope-tabs" role="tablist" aria-label="Server source">
              <button role="tab" aria-selected={serverScope === 'internet'} className={serverScope === 'internet' ? 'selected' : ''} onClick={() => setServerScope('internet')}><Globe2 size={15} /> INTERNET</button>
              <button role="tab" aria-selected={serverScope === 'favorites'} className={serverScope === 'favorites' ? 'selected' : ''} onClick={() => setServerScope('favorites')}><Heart size={14} /> FAVORITES <span>{serverFavorites.length}</span></button>
              <button role="tab" aria-selected={serverScope === 'history'} className={serverScope === 'history' ? 'selected' : ''} onClick={() => setServerScope('history')}><History size={15} /> RECENT</button>
            </div>
            <label className="server-search"><Search size={15} /><input aria-label="Search servers" value={serverSearch} onChange={(event) => setServerSearch(event.target.value)} placeholder="Name, map, address, tag" /><kbd>CTRL F</kbd></label>
            <button className="icon-button server-refresh" aria-label={serverLoading ? 'Stop server refresh' : 'Refresh server list'} title={serverLoading ? 'Stop server refresh' : 'Refresh server list'} onClick={() => { if (serverLoading) void window.dayz.cancelServerSearch(activeServerScan.current); else void scanServers(); }}>{serverLoading ? <X size={16} /> : <RefreshCw size={16} />}</button>
          </div>

          {serverError && <div className="server-error"><CircleHelp size={16} /><span>{serverError}</span><button onClick={() => void scanServers()}>RETRY</button></div>}

          <div className="server-filterbar">
            <label className="map-filter"><MapIcon size={15} /><select aria-label="Filter by map" value={serverMap} onChange={(event) => setServerMap(event.target.value)}><option value="all">All maps</option>{serverMaps.map((mapName) => <option key={mapName} value={mapName}>{mapName}</option>)}</select><ChevronDown size={13} /></label>
            <label className="server-check"><input type="checkbox" checked={hideFull} onChange={(event) => setHideFull(event.target.checked)} /><span />Hide full</label>
            <label className="server-check"><input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} /><span />Hide empty</label>
            <label className="server-check"><input type="checkbox" checked={hideLocked} onChange={(event) => setHideLocked(event.target.checked)} /><span />Hide locked</label>
            <label className="server-check"><input type="checkbox" checked={secureOnly} onChange={(event) => setSecureOnly(event.target.checked)} /><span />VAC secure</label>
            <label className="ping-filter"><Signal size={14} /><span>MAX PING <strong>{maxPing >= 2500 ? 'ANY' : `${maxPing} ms`}</strong></span><input type="range" min="50" max="2500" step="50" value={maxPing} onChange={(event) => setMaxPing(Number(event.target.value))} /></label>
            <label className="sort-filter"><Filter size={13} /><select aria-label="Sort servers" value={serverSort} onChange={(event) => setServerSort(event.target.value as typeof serverSort)}><option value="players">Players</option><option value="ping">Ping</option><option value="name">Name</option><option value="map">Map</option></select></label>
          </div>

          <div className="server-browser-layout">
            <section className="server-list-panel" aria-label="Server results">
              <div className="server-list-head"><span>SERVER <button onClick={() => setServerSort('name')}>NAME</button></span><button onClick={() => setServerSort('players')}>PLAYERS</button><button onClick={() => setServerSort('ping')}>PING</button><span>STAR</span></div>
              <div className="server-rows" ref={serverRowsRef} onScroll={(event) => setServerScrollTop(event.currentTarget.scrollTop)}>
                {!!visibleServers.length && <div aria-hidden="true" style={{ height: firstVisibleRow * 61 }} />}
                {renderedServers.map((server) => {
                  const favorite = serverFavorites.includes(server.address);
                  const selected = selectedServerAddress === server.address;
                  const fullness = server.maxPlayers ? Math.min(100, server.players / server.maxPlayers * 100) : 0;
                  return <div key={server.address} role="button" tabIndex={0} className={`server-row ${selected ? 'selected' : ''}`} onClick={() => setSelectedServerAddress(server.address)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedServerAddress(server.address); } }} onDoubleClick={() => void joinServer(server)}>
                    <div className="server-primary"><div className="server-name-line"><span className="server-online-dot" /><strong title={server.name}>{server.name}</strong>{server.password && <span title="Password protected"><LockKeyhole size={12} /></span>}</div><div className="server-subline"><span>{server.map || 'Unknown map'}</span><i>·</i><span>{server.address}</span>{server.category === 'official' && <b>OFFICIAL</b>}{server.category === 'unverified' && <b>UNVERIFIED</b>}{server.vac && <b>VAC</b>}</div></div>
                    <div className="server-player-cell"><strong>{server.players}<i> / {server.maxPlayers}</i></strong><span className="server-player-meter"><span style={{ width: `${fullness}%` }} /></span></div>
                    <span className={`server-ping ${server.ping === null ? '' : server.ping < 100 ? 'fast' : server.ping < 180 ? 'medium' : 'slow'}`}>{server.ping === null ? '—' : <>{server.ping}<i>ms</i></>}</span>
                    <button className={`server-row-fav ${favorite ? 'is-favorite' : ''}`} onClick={(event) => { event.stopPropagation(); void toggleFavorite(server); }} aria-label={favorite ? `Remove ${server.name} from favorites` : `Add ${server.name} to favorites`} title={favorite ? 'Remove favorite' : 'Add favorite'}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
                  </div>;
                })}
                {!!visibleServers.length && <div aria-hidden="true" style={{ height: Math.max(0, visibleServers.length - firstVisibleRow - renderedServers.length) * 61 }} />}
                {!visibleServers.length && <div className="server-empty-state">{serverLoading ? <><LoaderCircle size={24} className="spin" /><strong>{serverProgress.total ? 'Querying DayZ servers' : 'Querying Steam servers'}</strong><span>{serverProgress.total ? `${serverProgress.complete.toLocaleString()} of ${serverProgress.total.toLocaleString()} checked` : 'Building the live server list'}</span></> : <><ServerIcon size={25} /><strong>{serverScope === 'favorites' && !serverFavorites.length ? 'No favorites saved' : serverScope === 'history' ? 'No recent connections' : 'No servers match these filters'}</strong><span>{serverError ? 'Discovery is unavailable. You can still add a server by address.' : serverScope === 'favorites' && !serverFavorites.length ? 'Star any server or add one by address.' : serverResults.length ? 'Relax a filter or try another search.' : 'Check your connection or add a server by address.'}</span>{serverScope === 'internet' && !serverResults.length && <button onClick={() => setShowAddServer(true)}>ADD SERVER BY ADDRESS</button>}</>}</div>}
              </div>
              <div className="server-list-foot"><span>{serverLoading ? 'LIVE QUERY IN PROGRESS' : 'DOUBLE-CLICK A SERVER TO JOIN'}</span><span>DAYZ STANDALONE <i>·</i> {serverResults.length.toLocaleString()} LISTED</span></div>
            </section>

            <aside className="server-detail-panel">
              {selectedServer ? <>
                <div className="server-detail-cover"><span className="detail-map-mark"><MapIcon size={23} /></span><span>DAYZ / {selectedServer.map.toUpperCase() || 'UNKNOWN'}</span><button title={serverFavorites.includes(selectedServer.address) ? 'Remove favorite' : 'Add favorite'} onClick={() => void toggleFavorite(selectedServer)}><Star size={16} fill={serverFavorites.includes(selectedServer.address) ? 'currentColor' : 'none'} /></button></div>
                <div className="server-detail-body"><div className="server-detail-status"><span className="server-online-dot" /> {selectedServer.ping === null ? 'DIRECTORY LISTING' : 'RESPONDING'} <span>·</span> {selectedServer.ping === null ? 'PING NOT MEASURED' : selectedServer.ping + ' MS'}</div><h2>{selectedServer.name}</h2><div className="detail-address"><span>{selectedServer.address}</span><button title="Copy address" onClick={() => void copyServerAddress(selectedServer)}><Copy size={14} /></button></div>
                  <div className="detail-player-summary"><Users size={16} /><strong>{selectedServer.players}<i> / {selectedServer.maxPlayers}</i></strong><span>PLAYERS</span></div>
                  <div className="detail-facts"><div><span>SERVER TYPE</span><strong>{selectedServer.category === 'official' ? 'BOHEMIA VERIFIED' : selectedServer.category === 'community' ? 'COMMUNITY' : 'UNVERIFIED'}</strong></div><div><span>MAP</span><strong>{selectedServer.map || 'Unknown'}</strong></div><div><span>GAME PORT</span><strong>{selectedServer.gamePort}</strong></div><div><span>VERSION</span><strong>{selectedServer.version || 'Unknown'}</strong></div><div><span>ANTI-CHEAT</span><strong className={selectedServer.vac ? 'fact-good' : ''}>{selectedServer.vac ? 'VAC SECURE' : 'NOT ADVERTISED'}</strong></div><div><span>PASSWORD</span><strong>{selectedServer.password ? 'REQUIRED' : 'NONE'}</strong></div><div><span>QUERY PING</span><strong>{selectedServer.ping === null ? 'NOT MEASURED' : selectedServer.ping + ' MS'}</strong></div></div>
                  {selectedServer.tags.length > 0 && <div className="server-tags">{selectedServer.tags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                  <h3 className="server-mod-heading">SERVER MODS</h3>
                  <div className="join-mod-note" role="status"><Gamepad2 size={15} /><span>{serverModsLoading ? 'Checking required mods...' : serverModsError || (serverModList.length ? `${serverModList.filter((mod) => mod.installed).length}/${serverModList.length} required mods installed. Server loadout is applied automatically.` : 'No mods required. Joining with a vanilla loadout.')}</span></div>
                  <div className="server-required-mods">{serverModList.map((mod, index) => <div key={`${mod.id}-${index}`}><span>{mod.id === '0' ? 'Workshop ID unavailable: ' : mod.installed ? 'Installed: ' : 'Missing: '}{mod.name}</span><button className="text-button" disabled={mod.id === '0'} onClick={() => void window.dayz.openWorkshop(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.id}`)}>{mod.id === '0' ? 'UNRESOLVED' : mod.installed ? 'WORKSHOP' : 'GET MOD'}</button></div>)}</div>
                  <button className="text-button" disabled={serverModsLoading} onClick={() => setModCheckVersion((value) => value + 1)}>RECHECK MODS</button>
                  <button className="join-server-button" onClick={() => void joinServer(selectedServer)} disabled={!status.gameFound || serverLoading || serverModsLoading || Boolean(serverModsError) || serverModList.some((mod) => !mod.installed)}><Play size={16} fill="currentColor" /> JOIN SERVER <span>↗</span></button>
                  {!status.gameFound && <small className="join-blocked">Set the DayZ game path in Settings to enable joining.</small>}
                  {status.gameFound && <small className="join-blocked" role="status">{serverLoading ? 'Wait for the server scan to finish, or press Stop, to join.' : serverModsLoading ? 'Checking the server mod list before joining.' : serverModsError ? 'Joining is unavailable until the mod query succeeds. Use Recheck Mods to retry.' : serverModList.some((mod) => mod.id === '0') ? 'This server does not advertise Workshop IDs for all its mods. Automatic matching is unavailable.' : serverModList.some((mod) => !mod.installed) ? 'Subscribe to the missing mods using Get Mod, wait for Steam downloads, then Recheck Mods.' : 'Ready to join with the server loadout.'}</small>}
                </div>
              </> : <div className="server-detail-empty"><Signal size={25} /><strong>SELECT A SERVER</strong><span>Server details, security and quick join appear here.</span></div>}
            </aside>
          </div>
        </div>}

        {page === 'mods' && <div className="page-content mods-page">
          <div className="page-title-row"><div><div className="eyebrow">WORKSHOP CONTENT</div><h1>Mod library<span>.</span></h1><p>{mods.length} items found in your local Steam Workshop folder</p></div><button className="primary-action" onClick={() => void window.dayz.openWorkshop()}><Plus size={16} /> FIND MODS</button></div>
          <div className="mod-toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mods or IDs" /><kbd>Ctrl K</kbd></label><div className="filter-group"><ListFilter size={15} />{(['all', 'enabled', 'disabled'] as const).map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item.toUpperCase()}</button>)}</div><button className="icon-button toolbar-refresh" title="Refresh" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
          <div className="mod-table"><div className="table-head"><span>LOAD ORDER / NAME</span><span>WORKSHOP ID</span><span>FOLDER</span><span>ENABLED</span></div>
            {filteredMods.length ? filteredMods.map((mod, index) => <div className={`mod-row ${mod.enabled ? 'is-enabled' : ''}`} key={mod.id}>
              <div className="mod-name-cell"><div className="order-controls"><button aria-label="Move mod up" disabled={query.length > 0 || filter !== 'all' || index === 0} onClick={() => moveMod(mod.id, -1)}><ArrowUp size={13} /></button><span>{String(index + 1).padStart(2, '0')}</span><button aria-label="Move mod down" disabled={query.length > 0 || filter !== 'all' || index === filteredMods.length - 1} onClick={() => moveMod(mod.id, 1)}><ArrowDown size={13} /></button></div><div className="mod-emblem"><Gamepad2 size={17} /></div><div className="mod-title"><strong>{mod.name}</strong><small>{mod.enabled ? 'IN ACTIVE LOADOUT' : 'AVAILABLE LOCALLY'}</small></div></div>
              <button className="id-link" onClick={() => void window.dayz.openWorkshop(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.id}`)}>{mod.id}<span>↗</span></button>
              <button className="folder-button" title="Open mod folder" onClick={() => void window.dayz.openFolder(mod.path)}><FolderOpen size={15} /><span>OPEN FOLDER</span></button>
              <button role="switch" aria-checked={mod.enabled} aria-label={`Toggle ${mod.name}`} className={`toggle ${mod.enabled ? 'on' : ''}`} onClick={() => toggleMod(mod.id)}><span /></button>
            </div>) : <div className="empty-table"><Gamepad2 size={24} /><strong>{mods.length ? 'No mods match this filter' : 'No Workshop mods found'}</strong><span>{mods.length ? 'Try another search or filter.' : 'Subscribe to DayZ Workshop items in Steam, then refresh.'}</span>{!mods.length && <button onClick={() => void window.dayz.openWorkshop()}>OPEN STEAM WORKSHOP ↗</button>}</div>}
          </div>
          <div className="table-footer"><span>LOAD ORDER IS SAVED PER PROFILE</span><span>{enabledMods.length} ENABLED <i>·</i> {mods.length} TOTAL</span></div>
        </div>}

        {page === 'profiles' && <div className="page-content profiles-page">
          <div className="page-title-row"><div><div className="eyebrow">LOADOUT PRESETS</div><h1>Profiles<span>.</span></h1><p>Keep separate mod sets for different servers and play styles.</p></div><button className="primary-action" onClick={createProfile}><Plus size={16} /> NEW PROFILE</button></div>
          <div className="profiles-list">{profiles.map((item, index) => {
            const count = item.modIds.length;
            return <button className={`profile-row ${item.id === activeProfile ? 'current' : ''}`} key={item.id} onClick={() => setActiveProfile(item.id)}><div className="profile-letter">{item.name.slice(0, 1).toUpperCase()}</div><div className="profile-row-title"><strong>{item.name}</strong><small>{item.id === activeProfile ? 'CURRENT PROFILE' : `LOADOUT ${String(index + 1).padStart(2, '0')}`}</small></div><span className="profile-mod-count">{count.toString().padStart(2, '0')} MODS</span>{item.id === activeProfile ? <span className="current-tag"><Check size={13} /> ACTIVE</span> : <span className="select-tag">SELECT</span>}</button>;
          })}</div>
          <div className="profile-tip"><Sparkles size={17} /><div><strong>Profiles save your mod selection and order</strong><span>Switch profiles without changing your Steam Workshop subscriptions.</span></div></div>
        </div>}

        {page === 'settings' && <div className="page-content settings-page">
          <div className="page-title-row"><div><div className="eyebrow">LOCAL CONFIGURATION</div><h1>Settings<span>.</span></h1><p>Connect DZ Launchpad to your local DayZ install.</p></div></div>
          <div className="settings-section"><div className="settings-heading"><div className="settings-icon"><Settings2 size={18} /></div><div><strong>Game installation</strong><span>DayZ_x64.exe location</span></div></div><div className="path-box"><div className={`path-state ${status.gameFound ? 'good' : ''}`} /><span title={status.gamePath}>{status.gamePath || 'No DayZ installation selected'}</span><button onClick={async () => { try { await window.dayz.chooseGame(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Invalid game path.'); } }}>BROWSE <FolderOpen size={14} /></button></div><p className="setting-note">The launcher searches standard Steam library folders automatically. You can select your DayZ directory or its executable.</p></div>
          <div className="settings-section"><div className="settings-heading"><div className="settings-icon"><Download size={18} /></div><div><strong>Workshop library</strong><span>Steam-managed local content</span></div></div><div className="path-box"><div className={`path-state ${status.workshopPath ? 'good' : ''}`} /><span title={status.workshopPath}>{status.workshopPath || 'Workshop content folder not detected'}</span><button disabled={!status.workshopPath} onClick={() => void window.dayz.openFolder(status.workshopPath)}>OPEN <FolderOpen size={14} /></button></div><p className="setting-note">Subscriptions and downloads are managed by Steam. Subscribe to DayZ items in the Workshop, then refresh the library here.</p></div>
          <div className="settings-section"><div className="settings-heading"><div className="settings-icon"><Wrench size={18} /></div><div><strong>Runtime diagnostics</strong><span>Startup, server discovery, and launch events</span></div></div><div className="path-box"><div className="path-state good" /><span title={runtimeLogPath}>{runtimeLogPath || 'Log path is being initialized'}</span><button disabled={!runtimeLogPath} onClick={() => void window.dayz.openLog()}>OPEN LOG <FolderOpen size={14} /></button></div><p className="setting-note">The active log is capped at 2 MB; the previous log is kept as one backup. Server passwords are never written to the log.</p></div>
          <div className="settings-callout"><ShieldCheck size={17} /><span>Steam credentials stay with Steam. DZ Launchpad only reads downloaded Workshop folders and does not sign in to your account.</span></div>
        </div>}

        <footer className="footer-bar"><span><span className="footer-dot" /> SURVIVAL SYSTEMS ONLINE</span><span>DAYZ STANDALONE <i>·</i> WINDOWS</span></footer>
      </section>
      {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
    </main>
  );
}

export default App;
