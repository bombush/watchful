const params = new URLSearchParams(window.location.search);
const id = params.get('v');
const title = params.get('title') || '';
const channel = params.get('channel') || '';
document.getElementById('title').textContent = title;
document.getElementById('channel').textContent = channel;
document.title = title || 'Watchful Player';
if (id) {
  document.getElementById('player').src =
    `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
}
document.getElementById('close-btn').addEventListener('click', () => window.close());
