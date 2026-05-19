// Watchful — feed.js
// Categories are a tree: [{name, channelIds, children:[...]}]

import {
  escRegex, findCatByPath, getCatPath, findCatParent,
  getAllChannelIds, allAssignedIds, flattenCats, getChannelCategoryPath,
  updateCollapsedPathPrefix, removeCollapsedPath,
  addCategoryToTree, removeCategoryFromTree, renameCategoryInTree,
  moveChannelInTree, moveCategoryInTree,
} from './categories.js';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const CACHE_KEY = 'watchful_feed_cache';
const SEEN_KEY = 'watchful_seen';
const TOKEN_KEY = 'watchful_token';
const CAT_KEY = 'watchful_categories';
const PL_KEY = 'watchful_playlists';
const VPC_KEY = 'watchful_vids_per_channel';
const FOCUS_KEY = 'watchful_focus_enabled';
const COLLAPSED_KEY = 'watchful_collapsed_paths';
const CACHE_TTL = 15 * 60 * 1000;

let allVideos = [], allChannels = [];
let activeChannel = null, activeCategory = 'all', activePlaylist = null, searchQuery = '';
let authToken = null, settings = {};
let categories = []; // tree: [{name, channelIds, children:[...]}]
let playlists = []; // [{id, name, itemCount}]
let collapsedPaths = new Set(); // set of category path strings that are collapsed
let vidsPerChannel = 5;
let focusEnabled = true; // whether watch page focus mode is active

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  settings = await getSettings();
  categories = await loadCategories();
  collapsedPaths = await loadCollapsedPaths();
  playlists = await loadPlaylists();
  vidsPerChannel = await loadVidsPerChannel();
  focusEnabled = await loadFocusEnabled();
  renderFilterPills();
  renderSkeletons();
  await loadFeed();
}

async function getSettings() {
  return new Promise(r => chrome.storage.sync.get(['tags','clientId'], d => r({tags:d.tags||'', clientId:d.clientId||''})));
}
async function loadPlaylists() {
  return new Promise(r => chrome.storage.local.get([PL_KEY], d => r(d[PL_KEY] || [])));
}
async function savePlaylists() {
  await new Promise(r => chrome.storage.local.set({[PL_KEY]:playlists}, r));
}
async function loadVidsPerChannel() {
  return new Promise(r => chrome.storage.local.get([VPC_KEY], d => r(d[VPC_KEY] || 5)));
}
async function saveVidsPerChannel() {
  await new Promise(r => chrome.storage.local.set({[VPC_KEY]:vidsPerChannel}, r));
}
async function loadFocusEnabled() {
  return new Promise(r => chrome.storage.local.get([FOCUS_KEY], d => r(d[FOCUS_KEY] === true)));
}
async function saveFocusEnabled() {
  await new Promise(r => chrome.storage.local.set({[FOCUS_KEY]:focusEnabled}, r));
  // Notify open YouTube watch tabs (only works if running in extension page context)
  try {
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({url:'https://www.youtube.com/watch*'}, tabs => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {type:'watchful_focus_enabled', enabled:focusEnabled}).catch(()=>{});
        }
      });
    }
  } catch(_) {}
}
async function loadCategories() {
  return new Promise(r => chrome.storage.local.get([CAT_KEY], d => {
    const cats = d[CAT_KEY] || [];
    // Migrate flat -> tree: ensure children array exists
    function migrate(list) {
      for (const c of list) { if (!c.children) c.children = []; migrate(c.children); }
      return list;
    }
    r(migrate(cats));
  }));
}
async function saveCategories() {
  await new Promise(r => chrome.storage.local.set({[CAT_KEY]:categories}, r));
}
async function loadCollapsedPaths() {
  return new Promise(r => chrome.storage.local.get([COLLAPSED_KEY], d => {
    if (d[COLLAPSED_KEY]) {
      r(new Set(d[COLLAPSED_KEY]));
    } else {
      // One-time migration: collect paths where cat.collapsed was true in old data
      const migrated = new Set();
      function collect(tree, prefix) {
        for (const c of tree) {
          const path = prefix ? `${prefix}/${c.name}` : c.name;
          if (c.collapsed) migrated.add(path);
          collect(c.children || [], path);
        }
      }
      collect(categories, '');
      r(migrated);
    }
  }));
}
async function saveCollapsedPaths() {
  await new Promise(r => chrome.storage.local.set({[COLLAPSED_KEY]: [...collapsedPaths]}, r));
}

// ── Category action wrappers (call pure functions then persist + re-render) ──

function getCategoryChannelIds(path) {
  if (path === 'all') return allChannels.map(c => c.id);
  if (path === '__uncategorized') {
    const assigned = new Set(allAssignedIds(categories));
    return allChannels.filter(c => !assigned.has(c.id)).map(c => c.id);
  }
  const cat = findCatByPath(path, categories);
  return cat ? getAllChannelIds(cat) : [];
}

function addCategory(name, parentPath = null) {
  if (!name) return;
  if (addCategoryToTree(name, parentPath, categories))
    { saveCategories(); renderSidebar(); renderFilterPills(); }
}

function removeCategory(path) {
  const result = removeCategoryFromTree(path, categories, collapsedPaths);
  if (!result.removed) return;
  collapsedPaths = result.collapsedPaths;
  saveCollapsedPaths();
  saveCategories(); renderSidebar(); renderFilterPills();
  if (activeCategory === path || activeCategory.startsWith(path + '/')) { activeCategory = 'all'; renderFeed(); }
}

function renameCategory(path, newName) {
  if (!newName || !newName.trim()) return;
  const result = renameCategoryInTree(path, newName, categories, collapsedPaths);
  if (!result) return;
  if (activeCategory === path) activeCategory = result.newPath;
  collapsedPaths = result.collapsedPaths;
  saveCollapsedPaths();
  saveCategories(); renderSidebar(); renderFilterPills();
}

function toggleCategory(path) {
  if (collapsedPaths.has(path)) {
    collapsedPaths.delete(path);
  } else {
    collapsedPaths.add(path);
  }
  saveCollapsedPaths();
  renderSidebar();
}

function moveChannelToCategory(channelId, categoryPath) {
  moveChannelInTree(channelId, categoryPath, categories);
  saveCategories(); renderSidebar(); renderFilterPills();
}

function moveCategoryTo(sourcePath, targetPath, insertIndex) {
  const result = moveCategoryInTree(sourcePath, targetPath, categories, collapsedPaths, insertIndex);
  if (!result) return;
  collapsedPaths = result.collapsedPaths;
  saveCollapsedPaths();
  saveCategories(); renderSidebar(); renderFilterPills();
}

// ── Playlist functions ───────────────────────────────────────────────────────

async function searchUserPlaylists(name) {
  // Fetch all user playlists and find by name (case-insensitive)
  const allPl = []; let pageToken = '';
  do {
    const params = {part:'snippet', mine:true, maxResults:50};
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet('playlists', params);
    for (const item of data.items||[]) allPl.push({id:item.id, name:item.snippet.title});
    pageToken = data.nextPageToken||'';
  } while(pageToken);
  return allPl.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
}

async function fetchPlaylistVideos(playlistId) {
  // Fetch ALL videos in a playlist (no limit)
  const videos = []; let pageToken = '';
  // Build a map of videoId -> playlistItemId for deletion later
  const itemIdMap = {};
  do {
    const params = {part:'snippet,contentDetails', playlistId, maxResults:50};
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet('playlistItems', params);
    const items = data.items || [];
    // Store playlistItemId for each video
    for (const item of items) {
      itemIdMap[item.contentDetails.videoId] = item.id;
    }
    const videoIds = items.map(i=>i.contentDetails.videoId).filter(Boolean);
    if (videoIds.length) {
      const vidData = await apiGet('videos', {part:'snippet,contentDetails', id:videoIds.join(',')});
      for (const v of (vidData.items||[])) {
        videos.push({
          id:v.id, channelId:v.snippet.channelId, title:v.snippet.title,
          description:v.snippet.description?.slice(0,200)||'',
          thumbnail:v.snippet.thumbnails?.medium?.url||v.snippet.thumbnails?.default?.url||'',
          publishedAt:v.snippet.publishedAt,
          duration:parseDuration(v.contentDetails?.duration||''),
          url:`https://www.youtube.com/watch?v=${v.id}`,
          playlistId,
          playlistItemId: itemIdMap[v.id] || null,
        });
      }
    }
    pageToken = data.nextPageToken||'';
  } while(pageToken);
  return videos;
}

async function removeFromPlaylist(playlistItemId) {
  if (!authToken) throw new Error('Not authenticated');
  const url = new URL(`${YT_API}/playlistItems`);
  url.searchParams.set('id', playlistItemId);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

async function getAuthToken(interactive=true) {
  return new Promise((resolve,reject) => {
    chrome.identity.getAuthToken({interactive}, token => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}
async function doOAuthFlow() {
  return new Promise((resolve,reject) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      chrome.identity.getAuthToken({interactive:true}, token => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(token);
      });
    });
  });
}

// ── API ─────────────────────────────────────────────────────────────────────

async function apiGet(endpoint, params, retry=true) {
  if (!authToken) throw new Error('Not authenticated');
  const url = new URL(`${YT_API}/${endpoint}`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  const res = await fetch(url.toString(), { headers: {Authorization:`Bearer ${authToken}`} });
  if (res.status===401 && retry) {
    await new Promise(r => chrome.identity.removeCachedAuthToken({token:authToken}, r));
    authToken = await getAuthToken(true);
    return apiGet(endpoint, params, false);
  }
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err?.error?.message||`API error ${res.status}`); }
  return res.json();
}

async function fetchSubscriptions() {
  const channels = []; let pageToken = '';
  do {
    const params = {part:'snippet', mine:true, maxResults:50};
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet('subscriptions', params);
    for (const item of data.items||[]) channels.push({id:item.snippet.resourceId.channelId, name:item.snippet.title, avatar:item.snippet.thumbnails?.default?.url||''});
    pageToken = data.nextPageToken||'';
  } while(pageToken);
  return channels;
}

async function fetchChannelUploads(channelId, maxResults=5) {
  const chData = await apiGet('channels', {part:'contentDetails', id:channelId});
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];
  const plData = await apiGet('playlistItems', {part:'snippet,contentDetails', playlistId:uploadsId, maxResults});
  const videoIds = (plData.items||[]).map(i=>i.contentDetails.videoId);
  if (!videoIds.length) return [];
  const vidData = await apiGet('videos', {part:'snippet,contentDetails', id:videoIds.join(',')});
  return (vidData.items||[]).map(v => ({
    id:v.id, channelId, title:v.snippet.title,
    description:v.snippet.description?.slice(0,200)||'',
    thumbnail:v.snippet.thumbnails?.medium?.url||v.snippet.thumbnails?.default?.url||'',
    publishedAt:v.snippet.publishedAt,
    duration:parseDuration(v.contentDetails?.duration||''),
    url:`https://www.youtube.com/watch?v=${v.id}`,
  }));
}

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h=parseInt(m[1]||0), min=parseInt(m[2]||0), s=parseInt(m[3]||0);
  if (h>0) return `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${min}:${String(s).padStart(2,'0')}`;
}

// ── Feed loading ────────────────────────────────────────────────────────────

async function loadFeed() {
  try {
    const cached = await getCache();
    if (cached) { allVideos=cached.videos; allChannels=cached.channels; renderSidebar(); renderFeed(); refreshFeed(); return; }
    await refreshFeed();
  } catch(e) { showError(e.message); }
}

async function refreshFeed() {
  try {
    setFeedStatus('signing in…');
    authToken = await getAuthToken(true);
    setFeedStatus('fetching subscriptions…');
    allChannels = await fetchSubscriptions();
    if (!allChannels.length) { showError('No subscriptions found.'); return; }
    renderSidebar();
    setFeedStatus(`fetching videos from ${allChannels.length} channels…`);
    const BATCH=5; allVideos=[];
    for (let i=0; i<allChannels.length; i+=BATCH) {
      const results = await Promise.allSettled(allChannels.slice(i,i+BATCH).map(ch=>fetchChannelUploads(ch.id, vidsPerChannel)));
      for (const r of results) if (r.status==='fulfilled') allVideos.push(...r.value);
      setFeedStatus(`loaded ${Math.min(i+BATCH,allChannels.length)} / ${allChannels.length} channels…`);
    }

    // Fetch playlist videos (all items, no limit)
    if (playlists.length) {
      setFeedStatus('fetching playlists…');
      for (const pl of playlists) {
        try {
          const vids = await fetchPlaylistVideos(pl.id);
          allVideos.push(...vids);
        } catch(_) {}
      }
    }

    allVideos.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
    // Deduplicate (a video might be in a playlist AND a channel upload)
    const seen = new Set(); allVideos = allVideos.filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });

    await setCache({videos:allVideos, channels:allChannels});
    setFeedStatus(''); renderFeed();
  } catch(e) { showError(e.message); }
}

async function getCache() {
  return new Promise(r=>chrome.storage.local.get([CACHE_KEY],d=>{const c=d[CACHE_KEY]; r(c&&Date.now()-c.ts<CACHE_TTL?c:null);}));
}
async function setCache(data) { return new Promise(r=>chrome.storage.local.set({[CACHE_KEY]:{...data,ts:Date.now()}},r)); }
async function getSeenIds() { return new Promise(r=>chrome.storage.local.get([SEEN_KEY],d=>r(new Set(d[SEEN_KEY]||[])))); }
async function markSeen(id) { const seen=await getSeenIds(); seen.add(id); chrome.storage.local.set({[SEEN_KEY]:[...seen]}); }

// ── Sidebar rendering ───────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('channel-list');
  list.innerHTML = '';

  // "All channels"
  list.appendChild(makeChannelItem(null, 'all channels', '', activeChannel===null && activeCategory==='all'));

  // Render tree
  renderCatTree(categories, list, '');

  // Uncategorized
  const assigned = new Set(allAssignedIds(categories));
  const uncategorized = allChannels.filter(c=>!assigned.has(c.id));

  if (uncategorized.length) {
    const uncatGroup = document.createElement('li');
    uncatGroup.className = 'cat-group';
    const uh = document.createElement('div');
    uh.className = 'cat-header cat-header-uncat';
    uh.innerHTML = '<span class="cat-label" style="color:var(--text3)">uncategorized</span>';
    uh.dataset.catPath = '__uncategorized';
    makeDropZone(uh, null); // drop here = uncategorize
    uncatGroup.appendChild(uh);
    list.appendChild(uncatGroup);

    for (const ch of uncategorized) {
      const item = makeDraggableChannel(ch);
      list.appendChild(item);
    }
  }

  // "+ new category" button
  const addBtn = document.createElement('li');
  addBtn.className = 'cat-add-btn';
  addBtn.innerHTML = '<span class="cat-add-icon">+</span> new category';
  addBtn.addEventListener('click', () => {
    const name = prompt('Category name:');
    if (name && name.trim()) addCategory(name.trim().toLowerCase());
  });
  list.appendChild(addBtn);

  // Playlists section
  if (playlists.length) {
    const plHeader = document.createElement('li');
    plHeader.className = 'cat-group';
    const ph = document.createElement('div');
    ph.className = 'cat-header cat-header-uncat';
    ph.innerHTML = '<span class="cat-label" style="color:var(--text3)">playlists</span>';
    plHeader.appendChild(ph);
    list.appendChild(plHeader);

    for (const pl of playlists) {
      const li = document.createElement('li');
      li.className = 'channel-item' + (activePlaylist===pl.id ? ' active' : '');
      const av = document.createElement('div');
      av.className = 'ch-avatar ch-avatar-playlist';
      av.textContent = '▶';
      const nm = document.createElement('span');
      nm.className = 'ch-name';
      nm.textContent = pl.name;
      li.appendChild(av); li.appendChild(nm);
      li.addEventListener('click', () => {
        activePlaylist = pl.id; activeChannel = null; activeCategory = null;
        document.querySelectorAll('.channel-item,.cat-header').forEach(el=>el.classList.remove('active'));
        li.classList.add('active');
        renderFeed();
      });
      list.appendChild(li);
    }
  }
}

function renderCatTree(tree, container, parentPath, depth = 0) {
  tree.forEach((cat, idx) => {
    // Insert a gap drop zone before each root-level category so items can be
    // reordered and nested categories can be promoted back to root.
    if (depth === 0) container.appendChild(makeGapDropZone(idx));

    const path = parentPath ? `${parentPath}/${cat.name}` : cat.name;
    const group = document.createElement('li');
    group.className = 'cat-group';
    if (depth > 0) group.style.paddingLeft = '14px';

    // Header
    const header = document.createElement('div');
    header.className = 'cat-header';
    header.dataset.catPath = path;
    if (activeCategory === path && !activeChannel) header.classList.add('active');

    const toggle = document.createElement('span');
    toggle.className = 'cat-toggle';
    const hasContent = (cat.channelIds.length > 0 || cat.children.length > 0);
    const isCollapsed = collapsedPaths.has(path);
    toggle.textContent = hasContent ? (isCollapsed ? '▸' : '▾') : ' ';
    toggle.addEventListener('click', e => { e.stopPropagation(); toggleCategory(path); });

    const label = document.createElement('span');
    label.className = 'cat-label';
    label.textContent = cat.name;

    // Double-click to rename
    label.addEventListener('dblclick', e => {
      e.stopPropagation();
      startRename(label, path);
    });

    const totalCount = getAllChannelIds(cat).length;
    const count = document.createElement('span');
    count.className = 'cat-count';
    count.textContent = totalCount;

    // "+ sub" button
    const addSub = document.createElement('button');
    addSub.className = 'cat-sub-add';
    addSub.textContent = '+';
    addSub.title = 'Add subcategory';
    addSub.addEventListener('click', e => {
      e.stopPropagation();
      const name = prompt('Subcategory name:');
      if (name && name.trim()) addCategory(name.trim().toLowerCase(), path);
    });

    const remove = document.createElement('button');
    remove.className = 'cat-remove';
    remove.textContent = '✕';
    remove.title = 'Remove category';
    remove.addEventListener('click', e => { e.stopPropagation(); removeCategory(path); });

    header.appendChild(toggle);
    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(addSub);
    header.appendChild(remove);

    // Click = filter
    header.addEventListener('click', () => {
      activeChannel = null; activePlaylist = null; activeCategory = path;
      document.querySelectorAll('.channel-item,.cat-header').forEach(el=>el.classList.remove('active'));
      header.classList.add('active');
      renderFeed();
    });

    // Drop zone for channels AND categories
    makeDropZone(header, path);

    // Make category itself draggable
    header.draggable = true;
    header.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/x-watchful-cat', path);
      e.dataTransfer.effectAllowed = 'move';
      header.classList.add('dragging');
    });
    header.addEventListener('dragend', () => header.classList.remove('dragging'));

    group.appendChild(header);

    // Children (channels + subcategories)
    if (!isCollapsed) {
      // Subcategories first
      if (cat.children.length) renderCatTree(cat.children, group, path, depth + 1);
      // Then channels
      const channels = (cat.channelIds||[]).map(id=>allChannels.find(c=>c.id===id)).filter(Boolean);
      for (const ch of channels) {
        const item = makeDraggableChannel(ch, depth + 1);
        group.appendChild(item);
      }
    }

    container.appendChild(group);
  });

  // Trailing gap after the last root-level category (allows drop at end)
  if (depth === 0 && tree.length > 0) container.appendChild(makeGapDropZone(tree.length));
}

function makeDraggableChannel(ch, depth = 0) {
  const item = makeChannelItem(ch.id, ch.name, ch.avatar, activeChannel===ch.id);
  if (depth > 0) item.style.paddingLeft = `${14 + depth * 14}px`;
  item.draggable = true;
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', ch.id);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => item.classList.remove('dragging'));
  return item;
}

function makeGapDropZone(insertIndex) {
  const gap = document.createElement('li');
  gap.className = 'drop-gap';
  gap.addEventListener('dragover', e => {
    const isCat = e.dataTransfer.types.includes('application/x-watchful-cat');
    const isCh  = e.dataTransfer.types.includes('text/plain');
    if (!isCat && !isCh) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    gap.classList.add('drag-over');
  });
  gap.addEventListener('dragleave', () => gap.classList.remove('drag-over'));
  gap.addEventListener('drop', e => {
    e.preventDefault();
    gap.classList.remove('drag-over');
    const catPath = e.dataTransfer.getData('application/x-watchful-cat');
    const chId   = e.dataTransfer.getData('text/plain');
    if (catPath) moveCategoryTo(catPath, null, insertIndex);
    else if (chId) moveChannelToCategory(chId, null); // null = uncategorized
  });
  return gap;
}

function makeDropZone(el, categoryPath) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drag-over');
    const chId = e.dataTransfer.getData('text/plain');
    const catPath = e.dataTransfer.getData('application/x-watchful-cat');
    if (catPath) {
      // Dropping a category onto another category -> nest it
      moveCategoryTo(catPath, categoryPath);
    } else if (chId) {
      moveChannelToCategory(chId, categoryPath);
    }
  });
}

function startRename(labelEl, path) {
  const oldName = labelEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'cat-rename-input';

  function commit() {
    const newName = input.value.trim().toLowerCase();
    if (newName && newName !== oldName) renameCategory(path, newName);
    else { renderSidebar(); } // revert
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });

  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

function makeChannelItem(id, name, avatar, isActive) {
  const li = document.createElement('li');
  li.className = 'channel-item' + (isActive ? ' active' : '');
  li.dataset.channelId = id || 'all';
  const av = document.createElement('div'); av.className = 'ch-avatar';
  if (avatar) { const img = document.createElement('img'); img.src = avatar; img.alt=''; av.appendChild(img); }
  else av.textContent = name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const nm = document.createElement('span'); nm.className = 'ch-name'; nm.textContent = name;
  li.appendChild(av); li.appendChild(nm);
  li.addEventListener('click', () => {
    activeChannel = id;
    activePlaylist = null;
    activeCategory = id ? (getChannelCategoryPath(id, categories) || 'all') : 'all';
    document.querySelectorAll('.channel-item,.cat-header').forEach(el=>el.classList.remove('active'));
    li.classList.add('active'); renderFeed();
  });
  return li;
}

// ── Feed rendering ──────────────────────────────────────────────────────────

async function renderFeed() {
  const feed = document.getElementById('feed');
  const seenIds = await getSeenIds();
  const unseenOnly = document.getElementById('unseen-only').checked;
  const channelMap = new Map(allChannels.map(c=>[c.id,c]));
  let videos = allVideos;

  if (activePlaylist) {
    videos = videos.filter(v=>v.playlistId===activePlaylist);
  } else if (activeChannel) {
    videos = videos.filter(v=>v.channelId===activeChannel);
  } else if (activeCategory && activeCategory !== 'all') {
    const ids = new Set(getCategoryChannelIds(activeCategory));
    videos = videos.filter(v=>ids.has(v.channelId));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    videos = videos.filter(v => v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q) || (channelMap.get(v.channelId)?.name||'').toLowerCase().includes(q));
  }
  if (unseenOnly) videos = videos.filter(v=>!seenIds.has(v.id));

  const unseenCount = videos.filter(v=>!seenIds.has(v.id)).length;
  document.getElementById('feed-label').textContent = unseenCount>0 ? `latest — ${unseenCount} unseen` : 'latest';

  feed.innerHTML = '';
  if (!videos.length) { feed.innerHTML = '<p style="font-family:var(--font-mono);font-size:12px;color:var(--text3);padding:2rem 0;">no videos found</p>'; return; }
  for (const v of videos) feed.appendChild(makeVideoRow(v, channelMap.get(v.channelId)?.name||'', seenIds.has(v.id)));
}

function makeVideoRow(video, channelName, isSeen) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-row-wrap';

  const a = document.createElement('a');
  a.className = 'video-row'; a.href = '#';
  a.addEventListener('click', e => { e.preventDefault(); markSeen(video.id); openPlayer(video, channelName); });
  const thumb = document.createElement('div'); thumb.className = 'thumb';
  if (video.thumbnail) { const img = document.createElement('img'); img.src = video.thumbnail; img.alt=''; img.loading='lazy'; thumb.appendChild(img); }
  const po = document.createElement('div'); po.className = 'thumb-play';
  po.innerHTML = '<div class="play-circle"><svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M3 2l7 4-7 4V2z"/></svg></div>';
  thumb.appendChild(po);
  if (video.duration) { const dur = document.createElement('span'); dur.className = 'thumb-duration'; dur.textContent = video.duration; thumb.appendChild(dur); }
  const meta = document.createElement('div'); meta.className = 'video-meta';
  meta.innerHTML = `
    <p class="video-channel">${escHtml(channelName)}</p>
    <p class="video-title">${escHtml(video.title)}</p>
    ${video.description ? `<p class="video-desc">${escHtml(video.description)}</p>` : ''}
    <div class="video-footer">
      <span class="video-age">${timeAgo(video.publishedAt)}</span>
      ${!isSeen ? '<div class="video-unseen" title="unseen"></div>' : ''}
    </div>`;
  a.appendChild(thumb); a.appendChild(meta);
  wrapper.appendChild(a);

  // Remove from playlist button — only shown when viewing a playlist
  if (video.playlistItemId && activePlaylist) {
    const rmBtn = document.createElement('button');
    rmBtn.className = 'pl-remove-btn';
    rmBtn.title = 'Remove from playlist';
    rmBtn.textContent = '✕';
    rmBtn.addEventListener('click', async e => {
      e.stopPropagation();
      rmBtn.disabled = true;
      rmBtn.textContent = '…';
      try {
        await removeFromPlaylist(video.playlistItemId);
        // Remove from local cache too
        allVideos = allVideos.filter(v => v.playlistItemId !== video.playlistItemId);
        wrapper.remove();
      } catch(err) {
        rmBtn.textContent = '✕';
        rmBtn.disabled = false;
        rmBtn.title = `Error: ${err.message}`;
      }
    });
    wrapper.appendChild(rmBtn);
  }

  return wrapper;
}

function renderFilterPills() {
  const container = document.getElementById('filter-pills');
  container.innerHTML = '';
  // "all" pill
  const allBtn = document.createElement('button');
  allBtn.className = 'pill' + (activeCategory==='all' ? ' active' : '');
  allBtn.textContent = 'all';
  allBtn.addEventListener('click', () => { activeCategory='all'; activeChannel=null; renderPillsAndFeed(); });
  container.appendChild(allBtn);

  // Top-level categories only as pills; nested shown as parent/child
  const flat = flattenCats(categories);
  for (const {path} of flat) {
    const btn = document.createElement('button');
    btn.className = 'pill' + (path===activeCategory ? ' active' : '');
    btn.textContent = path;
    btn.addEventListener('click', () => {
      activeCategory=path; activeChannel=null; renderPillsAndFeed();
    });
    container.appendChild(btn);
  }
}

function renderPillsAndFeed() {
  document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  renderFilterPills(); renderSidebar(); renderFeed();
}

function renderSkeletons() {
  document.getElementById('feed').innerHTML = Array(6).fill(0).map(()=>`
    <div class="video-skeleton"><div class="skel-thumb"></div><div class="skel-lines">
      <div class="skel-line short"></div><div class="skel-line long"></div><div class="skel-line med"></div>
    </div></div>`).join('');
}
function setFeedStatus(msg) { document.getElementById('feed-status').textContent = msg; }
function showError(msg) { document.getElementById('feed').innerHTML = ''; document.getElementById('feed-status').textContent = `error: ${msg}`; }

// ── Settings ────────────────────────────────────────────────────────────────

async function showCurrentAccount() {
  if (!authToken) return;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers:{Authorization:`Bearer ${authToken}`}});
    if (res.ok) { const info = await res.json(); const el = document.getElementById('account-email'); if (el&&info.email) el.textContent = info.email; }
  } catch(_) {}
}

function openSettings() {
  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('vids-per-channel').value = vidsPerChannel;
  document.getElementById('focus-mode-enabled').checked = focusEnabled;
  renderPlaylistList();
  showCurrentAccount();
}
function closeSettings() { document.getElementById('settings-overlay').classList.add('hidden'); }

function renderPlaylistList() {
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';
  for (const pl of playlists) {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `<span class="playlist-item-name">${escHtml(pl.name)}</span>`;
    const rm = document.createElement('button');
    rm.className = 'playlist-item-remove';
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      playlists = playlists.filter(p=>p.id!==pl.id);
      savePlaylists(); renderPlaylistList(); renderSidebar();
    });
    li.appendChild(rm);
    list.appendChild(li);
  }
}

document.getElementById('open-settings').addEventListener('click', openSettings);
document.getElementById('close-settings').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', e => { if (e.target===document.getElementById('settings-overlay')) closeSettings(); });

document.getElementById('save-settings').addEventListener('click', async () => {
  const btn = document.getElementById('save-settings');
  btn.textContent = 'saving…';
  btn.disabled = true;

  try {
    const vpc = parseInt(document.getElementById('vids-per-channel').value) || 5;
    vidsPerChannel = Math.max(1, Math.min(50, vpc));
    await saveVidsPerChannel();

    focusEnabled = document.getElementById('focus-mode-enabled').checked;
    await saveFocusEnabled();

    btn.textContent = '✓ saved';
    setTimeout(() => { btn.textContent = 'save settings'; btn.disabled = false; }, 1200);

    closeSettings();
    await new Promise(r => chrome.storage.local.remove([CACHE_KEY], r));
    renderSkeletons();
    await loadFeed();
  } catch(e) {
    btn.textContent = 'error — try again';
    btn.disabled = false;
    console.error('Watchful save error:', e);
  }
});

document.getElementById('add-playlist-btn').addEventListener('click', async () => {
  const input = document.getElementById('playlist-name-input');
  const errEl = document.getElementById('playlist-error');
  const name = input.value.trim();
  errEl.classList.add('hidden');

  if (!name) { errEl.textContent = 'Enter a playlist name.'; errEl.classList.remove('hidden'); return; }
  if (playlists.some(p=>p.name.toLowerCase()===name.toLowerCase())) {
    errEl.textContent = 'Playlist already added.'; errEl.classList.remove('hidden'); return;
  }

  if (!authToken) {
    try { authToken = await getAuthToken(true); } catch(_) {
      errEl.textContent = 'Not signed in.'; errEl.classList.remove('hidden'); return;
    }
  }

  try {
    errEl.textContent = ''; errEl.classList.add('hidden');
    input.disabled = true;
    const found = await searchUserPlaylists(name);
    input.disabled = false;
    if (!found) {
      errEl.textContent = `No playlist named "${name}" found in your account.`;
      errEl.classList.remove('hidden');
      return;
    }
    playlists.push({id:found.id, name:found.name});
    await savePlaylists();
    input.value = '';
    renderPlaylistList();
    renderSidebar();
    // Clear cache so playlist videos get fetched on next refresh
    await new Promise(r=>chrome.storage.local.remove([CACHE_KEY],r));
  } catch(e) {
    input.disabled = false;
    errEl.textContent = `Error: ${e.message}`; errEl.classList.remove('hidden');
  }
});

document.getElementById('switch-account').addEventListener('click', async () => {
  closeSettings(); renderSkeletons(); setFeedStatus('signing out…');
  try {
    if (authToken) {
      try { await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${authToken}`); } catch(_) {}
      await new Promise(r=>chrome.identity.removeCachedAuthToken({token:authToken},r));
    }
    await new Promise(r=>chrome.identity.clearAllCachedAuthTokens(r));
    await new Promise(r=>chrome.storage.local.remove([CACHE_KEY],r));
    authToken=null; allVideos=[]; allChannels=[];
    authToken = await getAuthToken(true);
    await refreshFeed(); showCurrentAccount();
  } catch(e) { showError(e.message); }
});

// ── Search ──────────────────────────────────────────────────────────────────

let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ searchQuery=e.target.value.trim(); renderFeed(); }, 250);
});
document.getElementById('unseen-only').addEventListener('change', ()=>renderFeed());

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const diff=Date.now()-new Date(iso).getTime(); const mins=Math.floor(diff/60000);
  if (mins<60) return `${mins}m ago`; const hrs=Math.floor(mins/60);
  if (hrs<24) return `${hrs}h ago`; const days=Math.floor(hrs/24);
  if (days<7) return `${days}d ago`; const weeks=Math.floor(days/7);
  if (weeks<5) return `${weeks}w ago`; return `${Math.floor(days/30)}mo ago`;
}
function escHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function openPlayer(video) { window.open(video.url, '_blank'); }

// ── Export / Import ──────────────────────────────────────────────────────────

document.getElementById('export-settings-btn').addEventListener('click', () => {
  const data = {
    _watchful_version: 1,
    exported_at: new Date().toISOString(),
    categories,
    playlists,
    vids_per_channel: vidsPerChannel,
    focus_enabled: focusEnabled,
    collapsed_paths: [...collapsedPaths],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchful-settings-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-settings-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  const errEl = document.getElementById('import-error');
  const okEl = document.getElementById('import-success');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  e.target.value = ''; // reset so same file can be picked again

  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data._watchful_version) throw new Error('Not a valid Watchful settings file.');

    // Validate structure loosely
    if (data.categories && !Array.isArray(data.categories)) throw new Error('Invalid categories format.');
    if (data.playlists && !Array.isArray(data.playlists)) throw new Error('Invalid playlists format.');

    // Migrate imported categories to ensure children arrays exist
    function migrate(list) {
      for (const c of list) { if (!c.children) c.children = []; migrate(c.children); }
      return list;
    }

    if (data.categories) { categories = migrate(data.categories); await saveCategories(); }
    if (data.collapsed_paths && Array.isArray(data.collapsed_paths)) {
      collapsedPaths = new Set(data.collapsed_paths);
    } else if (data.categories) {
      // Old export format: migrate from cat.collapsed fields
      collapsedPaths = new Set();
      function collectCollapsed(tree, prefix) {
        for (const c of tree) {
          const path = prefix ? `${prefix}/${c.name}` : c.name;
          if (c.collapsed) collapsedPaths.add(path);
          collectCollapsed(c.children || [], path);
        }
      }
      collectCollapsed(categories, '');
    }
    if (data.categories || data.collapsed_paths) await saveCollapsedPaths();
    if (data.playlists) { playlists = data.playlists; await savePlaylists(); }
    if (data.vids_per_channel) {
      vidsPerChannel = Math.max(1, Math.min(50, parseInt(data.vids_per_channel) || 5));
      await saveVidsPerChannel();
      document.getElementById('vids-per-channel').value = vidsPerChannel;
    }
    if (data.focus_enabled !== undefined) {
      focusEnabled = !!data.focus_enabled;
      await saveFocusEnabled();
      document.getElementById('focus-mode-enabled').checked = focusEnabled;
    }

    renderFilterPills();
    renderSidebar();
    renderPlaylistList();

    okEl.textContent = `✓ imported ${categories.length} categories, ${playlists.length} playlists.`;
    okEl.classList.remove('hidden');
  } catch (err) {
    errEl.textContent = `Import failed: ${err.message}`;
    errEl.classList.remove('hidden');
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

init();
