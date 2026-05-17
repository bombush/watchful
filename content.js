// Runs at document_start on youtube.com homepage
// Immediately hide the page, then replace with our feed once DOM is ready

const style = document.createElement('style');
style.textContent = 'body { visibility: hidden !important; }';
document.documentElement.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
  // Only replace the homepage, not video pages, search, etc.
  const path = window.location.pathname;
  const isHomepage = path === '/' || path === '';
  if (!isHomepage) {
    style.remove();
    return;
  }

  // Replace the entire body with an iframe pointing to our feed
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;';
  document.head.innerHTML = '<title>Watchful</title>';

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('feed.html');
  iframe.style.cssText = 'width:100vw;height:100vh;border:none;display:block;';
  document.body.appendChild(iframe);

  style.remove();
  document.body.style.visibility = 'visible';
});
