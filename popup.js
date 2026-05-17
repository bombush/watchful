chrome.storage.sync.get(['tags', 'clientId'], d => {
  document.getElementById('tags').value = d.tags || '';
  document.getElementById('clientId').value = d.clientId || '';
});

document.getElementById('save').addEventListener('click', () => {
  const tags = document.getElementById('tags').value.trim();
  const clientId = document.getElementById('clientId').value.trim();
  chrome.storage.sync.set({ tags, clientId }, () => {
    chrome.storage.local.remove(['watchful_feed_cache', 'watchful_token']);
    document.getElementById('saved').style.display = 'block';
  });
});
