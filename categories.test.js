import { describe, it, expect, beforeEach } from 'vitest';
import {
  findCatByPath, findCatParent, getCatPath,
  getAllChannelIds, allAssignedIds, flattenCats, getChannelCategoryPath,
  updateCollapsedPathPrefix, removeCollapsedPath,
  addCategoryToTree, removeCategoryFromTree, renameCategoryInTree,
  moveChannelInTree, moveCategoryInTree,
  escRegex,
} from './categories.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTree() {
  return [
    {
      name: 'music',
      channelIds: ['ch1', 'ch2'],
      children: [
        { name: 'jazz', channelIds: ['ch3'], children: [] },
      ],
    },
    {
      name: 'science',
      channelIds: ['ch4'],
      children: [],
    },
  ];
}

// ── Tree queries ──────────────────────────────────────────────────────────────

describe('findCatByPath', () => {
  it('finds a top-level category', () => {
    const tree = makeTree();
    expect(findCatByPath('music', tree).name).toBe('music');
  });

  it('finds a nested category', () => {
    const tree = makeTree();
    expect(findCatByPath('music/jazz', tree).name).toBe('jazz');
  });

  it('returns null for a missing path', () => {
    expect(findCatByPath('nope', makeTree())).toBeNull();
  });

  it('returns null for a missing nested path', () => {
    expect(findCatByPath('music/classical', makeTree())).toBeNull();
  });
});

describe('findCatParent', () => {
  it('finds the parent list and index of a top-level category', () => {
    const tree = makeTree();
    const info = findCatParent('science', tree);
    expect(info.name).toBe('science');
    expect(info.idx).toBe(1);
    expect(info.list).toBe(tree);
  });

  it('finds the parent list of a nested category', () => {
    const tree = makeTree();
    const info = findCatParent('music/jazz', tree);
    expect(info.name).toBe('jazz');
    expect(info.idx).toBe(0);
    expect(info.list).toBe(tree[0].children);
  });

  it('returns null for a missing path', () => {
    expect(findCatParent('missing', makeTree())).toBeNull();
  });
});

describe('getCatPath', () => {
  it('returns the path of a top-level node', () => {
    const tree = makeTree();
    expect(getCatPath(tree[1], tree)).toBe('science');
  });

  it('returns the path of a nested node', () => {
    const tree = makeTree();
    expect(getCatPath(tree[0].children[0], tree)).toBe('music/jazz');
  });

  it('returns null when the node is not in the tree', () => {
    const tree = makeTree();
    expect(getCatPath({ name: 'ghost', channelIds: [], children: [] }, tree)).toBeNull();
  });
});

describe('getAllChannelIds', () => {
  it('returns direct channel IDs', () => {
    const tree = makeTree();
    expect(getAllChannelIds(tree[1])).toEqual(['ch4']);
  });

  it('includes channel IDs from children', () => {
    const tree = makeTree();
    expect(getAllChannelIds(tree[0]).sort()).toEqual(['ch1', 'ch2', 'ch3']);
  });

  it('returns empty array for a category with no channels', () => {
    expect(getAllChannelIds({ channelIds: [], children: [] })).toEqual([]);
  });
});

describe('allAssignedIds', () => {
  it('collects all channel IDs across the whole tree', () => {
    expect(allAssignedIds(makeTree()).sort()).toEqual(['ch1', 'ch2', 'ch3', 'ch4']);
  });

  it('returns an empty array for an empty tree', () => {
    expect(allAssignedIds([])).toEqual([]);
  });
});

describe('flattenCats', () => {
  it('includes top-level categories with correct paths', () => {
    const flat = flattenCats(makeTree());
    expect(flat.map(e => e.path)).toContain('music');
    expect(flat.map(e => e.path)).toContain('science');
  });

  it('includes nested categories with slash-separated paths', () => {
    const flat = flattenCats(makeTree());
    expect(flat.map(e => e.path)).toContain('music/jazz');
  });

  it('returns entries in depth-first order', () => {
    const paths = flattenCats(makeTree()).map(e => e.path);
    expect(paths).toEqual(['music', 'music/jazz', 'science']);
  });
});

describe('getChannelCategoryPath', () => {
  it('finds a channel in a top-level category', () => {
    expect(getChannelCategoryPath('ch4', makeTree())).toBe('science');
  });

  it('finds a channel in a nested category', () => {
    expect(getChannelCategoryPath('ch3', makeTree())).toBe('music/jazz');
  });

  it('returns null for an unassigned channel', () => {
    expect(getChannelCategoryPath('ch99', makeTree())).toBeNull();
  });
});

// ── Collapsed-path helpers ────────────────────────────────────────────────────

describe('updateCollapsedPathPrefix', () => {
  it('remaps an exact path match', () => {
    const result = updateCollapsedPathPrefix('music', 'audio', new Set(['music', 'science']));
    expect(result.has('audio')).toBe(true);
    expect(result.has('music')).toBe(false);
    expect(result.has('science')).toBe(true);
  });

  it('remaps descendant paths', () => {
    const result = updateCollapsedPathPrefix('music', 'audio', new Set(['music/jazz', 'music/classical']));
    expect(result.has('audio/jazz')).toBe(true);
    expect(result.has('audio/classical')).toBe(true);
    expect(result.has('music/jazz')).toBe(false);
  });

  it('does not remap paths that only share a prefix string (not a path segment)', () => {
    // 'musician' should NOT be affected when renaming 'music'
    const result = updateCollapsedPathPrefix('music', 'audio', new Set(['musician']));
    expect(result.has('musician')).toBe(true);
    expect(result.has('audioan')).toBe(false);
  });

  it('returns a new Set without mutating the original', () => {
    const original = new Set(['music']);
    const result = updateCollapsedPathPrefix('music', 'audio', original);
    expect(original.has('music')).toBe(true);
    expect(result).not.toBe(original);
  });
});

describe('removeCollapsedPath', () => {
  it('removes the exact path', () => {
    const result = removeCollapsedPath('music', new Set(['music', 'science']));
    expect(result.has('music')).toBe(false);
    expect(result.has('science')).toBe(true);
  });

  it('removes descendant paths', () => {
    const result = removeCollapsedPath('music', new Set(['music', 'music/jazz', 'science']));
    expect(result.has('music')).toBe(false);
    expect(result.has('music/jazz')).toBe(false);
    expect(result.has('science')).toBe(true);
  });

  it('does not remove paths that merely share a string prefix', () => {
    const result = removeCollapsedPath('music', new Set(['musician']));
    expect(result.has('musician')).toBe(true);
  });

  it('returns a new Set without mutating the original', () => {
    const original = new Set(['music']);
    const result = removeCollapsedPath('music', original);
    expect(original.has('music')).toBe(true);
    expect(result).not.toBe(original);
  });
});

// ── Tree mutations ────────────────────────────────────────────────────────────

describe('addCategoryToTree', () => {
  it('adds a top-level category', () => {
    const tree = makeTree();
    const ok = addCategoryToTree('comedy', null, tree);
    expect(ok).toBe(true);
    expect(tree.find(c => c.name === 'comedy')).toBeTruthy();
  });

  it('adds a subcategory under an existing parent', () => {
    const tree = makeTree();
    addCategoryToTree('classical', 'music', tree);
    expect(findCatByPath('music/classical', tree)).toBeTruthy();
  });

  it('returns false and does not duplicate an existing name', () => {
    const tree = makeTree();
    const ok = addCategoryToTree('music', null, tree);
    expect(ok).toBe(false);
    expect(tree.filter(c => c.name === 'music').length).toBe(1);
  });

  it('returns false when the parent path does not exist', () => {
    const tree = makeTree();
    const ok = addCategoryToTree('sub', 'ghost', tree);
    expect(ok).toBe(false);
  });
});

describe('removeCategoryFromTree', () => {
  it('removes a top-level category', () => {
    const tree = makeTree();
    const { removed } = removeCategoryFromTree('science', tree, new Set());
    expect(removed).toBe(true);
    expect(findCatByPath('science', tree)).toBeNull();
  });

  it('removes a nested category', () => {
    const tree = makeTree();
    const { removed } = removeCategoryFromTree('music/jazz', tree, new Set());
    expect(removed).toBe(true);
    expect(findCatByPath('music/jazz', tree)).toBeNull();
  });

  it('cleans up collapsed state for the removed path', () => {
    const tree = makeTree();
    const { collapsedPaths } = removeCategoryFromTree('music', tree, new Set(['music', 'music/jazz', 'science']));
    expect(collapsedPaths.has('music')).toBe(false);
    expect(collapsedPaths.has('music/jazz')).toBe(false);
    expect(collapsedPaths.has('science')).toBe(true);
  });

  it('returns removed: false for a missing path', () => {
    const tree = makeTree();
    const { removed } = removeCategoryFromTree('ghost', tree, new Set());
    expect(removed).toBe(false);
  });
});

describe('renameCategoryInTree', () => {
  it('renames a top-level category and returns the new path', () => {
    const tree = makeTree();
    const result = renameCategoryInTree('science', 'biology', tree, new Set());
    expect(result.newPath).toBe('biology');
    expect(findCatByPath('biology', tree)).toBeTruthy();
    expect(findCatByPath('science', tree)).toBeNull();
  });

  it('renames a nested category', () => {
    const tree = makeTree();
    const result = renameCategoryInTree('music/jazz', 'blues', tree, new Set());
    expect(result.newPath).toBe('music/blues');
    expect(findCatByPath('music/blues', tree)).toBeTruthy();
  });

  it('updates collapsed paths to use the new path', () => {
    const tree = makeTree();
    const result = renameCategoryInTree('music', 'audio', tree, new Set(['music', 'music/jazz']));
    expect(result.collapsedPaths.has('audio')).toBe(true);
    expect(result.collapsedPaths.has('audio/jazz')).toBe(true);
    expect(result.collapsedPaths.has('music')).toBe(false);
  });

  it('returns null when the name conflicts with a sibling', () => {
    const tree = makeTree();
    const result = renameCategoryInTree('science', 'music', tree, new Set());
    expect(result).toBeNull();
    expect(findCatByPath('science', tree)).toBeTruthy();
  });

  it('returns null for a missing path', () => {
    expect(renameCategoryInTree('ghost', 'name', makeTree(), new Set())).toBeNull();
  });
});

describe('moveChannelInTree', () => {
  it('moves a channel from one category to another', () => {
    const tree = makeTree();
    moveChannelInTree('ch1', 'science', tree);
    expect(findCatByPath('music', tree).channelIds).not.toContain('ch1');
    expect(findCatByPath('science', tree).channelIds).toContain('ch1');
  });

  it('uncategorizes a channel when categoryPath is null', () => {
    const tree = makeTree();
    moveChannelInTree('ch1', null, tree);
    expect(findCatByPath('music', tree).channelIds).not.toContain('ch1');
  });

  it('does not duplicate a channel already in the target', () => {
    const tree = makeTree();
    moveChannelInTree('ch4', 'science', tree); // already there
    expect(findCatByPath('science', tree).channelIds.filter(id => id === 'ch4').length).toBe(1);
  });
});

describe('moveCategoryInTree', () => {
  it('moves a top-level category under another', () => {
    const tree = makeTree();
    const result = moveCategoryInTree('science', 'music', tree, new Set());
    expect(result).not.toBeNull();
    expect(findCatByPath('music/science', tree)).toBeTruthy();
    expect(tree.find(c => c.name === 'science')).toBeUndefined();
  });

  it('moves a nested category to root', () => {
    const tree = makeTree();
    const result = moveCategoryInTree('music/jazz', null, tree, new Set());
    expect(result).not.toBeNull();
    expect(findCatByPath('jazz', tree)).toBeTruthy();
    expect(findCatByPath('music/jazz', tree)).toBeNull();
  });

  it('updates collapsed paths after the move', () => {
    const tree = makeTree();
    const result = moveCategoryInTree('science', 'music', tree, new Set(['science']));
    expect(result.collapsedPaths.has('music/science')).toBe(true);
    expect(result.collapsedPaths.has('science')).toBe(false);
  });

  it('returns null and leaves tree unchanged when moving into own descendant', () => {
    const tree = makeTree();
    const result = moveCategoryInTree('music', 'music/jazz', tree, new Set());
    expect(result).toBeNull();
    expect(findCatByPath('music', tree)).toBeTruthy();
  });

  it('returns null when source path does not exist', () => {
    expect(moveCategoryInTree('ghost', null, makeTree(), new Set())).toBeNull();
  });

  it('returns null when a category with the same name already exists at the target', () => {
    const tree = [
      { name: 'a', channelIds: [], children: [{ name: 'dup', channelIds: [], children: [] }] },
      { name: 'dup', channelIds: [], children: [] },
    ];
    const result = moveCategoryInTree('dup', 'a', tree, new Set());
    expect(result).toBeNull();
    expect(findCatByPath('dup', tree)).toBeTruthy(); // still at root
  });
});
