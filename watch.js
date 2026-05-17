// Watchful — watch.js
// Toggles body.watchful-focus class; CSS does all the hiding

const FOCUS_ON_KEY = 'watchful_focus_on';
let focusOn = localStorage.getItem(FOCUS_ON_KEY) !== 'false';
let featureEnabled = false;
let btn = null;

function applyFocus() {
  document.body.classList.toggle('watchful-focus', featureEnabled && focusOn);
  if (!btn) return;
  btn.textContent = focusOn ? 'focus on' : 'focus off';
  btn.classList.toggle('focus-active', focusOn);
  btn.style.display = featureEnabled ? '' : 'none';
}

function injectButton() {
  if (document.getElementById('watchful-toggle')) {
    btn = document.getElementById('watchful-toggle'); return;
  }
  btn = document.createElement('button');
  btn.id = 'watchful-toggle';
  btn.style.display = featureEnabled ? '' : 'none';
  btn.addEventListener('click', () => {
    focusOn = !focusOn;
    localStorage.setItem(FOCUS_ON_KEY, focusOn);
    applyFocus();
  });
  document.body.appendChild(btn);
  applyFocus();
}

function setup() {
  chrome.storage.local.get(['watchful_focus_enabled'], d => {
    featureEnabled = d.watchful_focus_enabled === true;
    injectButton();
    applyFocus();
  });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'watchful_focus_enabled') return;
  featureEnabled = msg.enabled;
  applyFocus();
});

if (document.body) { setup(); }
else { document.addEventListener('DOMContentLoaded', setup); }

document.addEventListener('yt-navigate-finish', () => {
  if (window.location.pathname === '/watch') {
    btn = document.getElementById('watchful-toggle');
    if (!btn) injectButton();
    else applyFocus();
  }
});
