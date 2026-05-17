// Runs on youtube.com/watch pages — hides clutter, keeps just the video

function clean() {
  const hide = [
    '#secondary', '#related', '#comments', 'ytd-comments',
    '#chat', 'ytd-live-chat-frame', '#masthead-ad',
    'ytd-banner-promo-renderer', 'ytd-ad-slot-renderer',
    '.ytp-ce-element', '.ytp-cards-button',
    'ytd-watch-next-secondary-results-renderer',
  ];
  for (const sel of hide) {
    document.querySelectorAll(sel).forEach(el => el.style.setProperty('display', 'none', 'important'));
  }
}

// Run immediately and again after YouTube's JS renders content
clean();
const observer = new MutationObserver(clean);
observer.observe(document.body, { childList: true, subtree: true });

// Stop observing after 10s to avoid performance hit
setTimeout(() => observer.disconnect(), 10000);
