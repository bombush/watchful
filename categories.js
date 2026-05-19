// Pure category tree operations — no Chrome API, no DOM, no globals.
// All functions take their data as parameters and return results;
// mutation functions operate on the passed-in tree in place (matching the
// original design) and return any new derived state (e.g. updated collapsedPaths).

export function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Tree queries ─────────────────────────────────────────────────────────────

export function findCatByPath(path, categories) {
  const parts = path.split('/');
  let list = categories;
  let node = null;
  for (const p of parts) {
    node = list.find(c => c.name === p);
    if (!node) return null;
    list = node.children;
  }
  return node;
}

export function getCatPath(node, tree, prefix = '') {
  for (const c of tree) {
    const path = prefix ? `${prefix}/${c.name}` : c.name;
    if (c === node) return path;
    const found = getCatPath(node, c.children, path);
    if (found) return found;
  }
  return null;
}

export function findCatParent(path, categories) {
  const parts = path.split('/');
  const name = parts.pop();
  let list = categories;
  for (const p of parts) {
    const parent = list.find(c => c.name === p);
    if (!parent) return null;
    list = parent.children;
  }
  const idx = list.findIndex(c => c.name === name);
  return idx >= 0 ? { list, idx, name } : null;
}

export function getAllChannelIds(cat) {
  let ids = [...(cat.channelIds || [])];
  for (const child of (cat.children || [])) ids.push(...getAllChannelIds(child));
  return ids;
}

export function allAssignedIds(tree) {
  let ids = [];
  for (const c of tree) {
    ids.push(...(c.channelIds || []));
    ids.push(...allAssignedIds(c.children));
  }
  return ids;
}

export function flattenCats(tree, prefix = '') {
  let result = [];
  for (const c of tree) {
    const path = prefix ? `${prefix}/${c.name}` : c.name;
    result.push({ path, cat: c });
    result.push(...flattenCats(c.children, path));
  }
  return result;
}

export function getChannelCategoryPath(channelId, tree, prefix = '') {
  for (const c of tree) {
    const path = prefix ? `${prefix}/${c.name}` : c.name;
    if ((c.channelIds || []).includes(channelId)) return path;
    const found = getChannelCategoryPath(channelId, c.children, path);
    if (found) return found;
  }
  return null;
}

// ── Collapsed-path helpers ───────────────────────────────────────────────────

// Returns a new Set with all paths under oldPrefix remapped to newPrefix.
export function updateCollapsedPathPrefix(oldPrefix, newPrefix, collapsedPaths) {
  const next = new Set(collapsedPaths);
  const affected = [...next].filter(p => p === oldPrefix || p.startsWith(oldPrefix + '/'));
  for (const p of affected) {
    next.delete(p);
    next.add(newPrefix + p.slice(oldPrefix.length));
  }
  return next;
}

// Returns a new Set with the given path and all its descendants removed.
export function removeCollapsedPath(path, collapsedPaths) {
  const next = new Set(collapsedPaths);
  [...next].filter(p => p === path || p.startsWith(path + '/')).forEach(p => next.delete(p));
  return next;
}

// ── Tree mutations ───────────────────────────────────────────────────────────
// These mutate the passed-in categories array in place (same semantics as
// the original code) and return derived state that changed (collapsedPaths).

// Returns true if added, false if name already exists in that parent.
export function addCategoryToTree(name, parentPath, categories) {
  let list = categories;
  if (parentPath) {
    const parent = findCatByPath(parentPath, categories);
    if (!parent) return false;
    list = parent.children;
  }
  if (list.some(c => c.name === name)) return false;
  list.push({ name, channelIds: [], children: [] });
  return true;
}

// Removes the category at path. Returns { removed: bool, collapsedPaths: Set }.
export function removeCategoryFromTree(path, categories, collapsedPaths) {
  const info = findCatParent(path, categories);
  if (!info) return { removed: false, collapsedPaths };
  info.list.splice(info.idx, 1);
  return { removed: true, collapsedPaths: removeCollapsedPath(path, collapsedPaths) };
}

// Renames category at path. Returns { newPath, collapsedPaths } or null on failure.
export function renameCategoryInTree(path, newName, categories, collapsedPaths) {
  newName = newName.trim().toLowerCase();
  if (!newName) return null;
  const info = findCatParent(path, categories);
  if (!info) return null;
  if (info.list.some(c => c.name === newName && c !== info.list[info.idx])) return null;
  const oldName = info.list[info.idx].name;
  info.list[info.idx].name = newName;
  const newPath = path.replace(new RegExp('(^|/)' + escRegex(oldName) + '$'), '$1' + newName);
  return { newPath, collapsedPaths: updateCollapsedPathPrefix(path, newPath, collapsedPaths) };
}

// Moves channelId out of any category and into categoryPath (or uncategorized if null).
export function moveChannelInTree(channelId, categoryPath, categories) {
  function removeFrom(list) {
    for (const c of list) {
      c.channelIds = c.channelIds.filter(id => id !== channelId);
      removeFrom(c.children);
    }
  }
  removeFrom(categories);
  if (categoryPath) {
    const cat = findCatByPath(categoryPath, categories);
    if (cat && !cat.channelIds.includes(channelId)) cat.channelIds.push(channelId);
  }
}

// Moves a category to be a child of targetPath (or to root if targetPath is null).
// Returns { newPath, collapsedPaths } on success, null on failure/no-op.
export function moveCategoryInTree(sourcePath, targetPath, categories, collapsedPaths, insertIndex) {
  if (sourcePath === targetPath) return null;
  if (targetPath && targetPath.startsWith(sourcePath + '/')) return null;

  const srcInfo = findCatParent(sourcePath, categories);
  if (!srcInfo) return null;
  const catNode = srcInfo.list.splice(srcInfo.idx, 1)[0];

  if (targetPath) {
    const parent = findCatByPath(targetPath, categories);
    if (!parent) { srcInfo.list.splice(srcInfo.idx, 0, catNode); return null; }
    if (parent.children.some(c => c.name === catNode.name)) { srcInfo.list.splice(srcInfo.idx, 0, catNode); return null; }
    parent.children.push(catNode);
  } else {
    if (categories.some(c => c.name === catNode.name)) { srcInfo.list.splice(srcInfo.idx, 0, catNode); return null; }
    let idx = (insertIndex !== undefined) ? insertIndex : categories.length;
    if (srcInfo.list === categories && srcInfo.idx < idx) idx--;
    idx = Math.max(0, Math.min(idx, categories.length));
    categories.splice(idx, 0, catNode);
  }

  const newPath = targetPath ? `${targetPath}/${catNode.name}` : catNode.name;
  return { newPath, collapsedPaths: updateCollapsedPathPrefix(sourcePath, newPath, collapsedPaths) };
}
