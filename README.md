# Watchful — intentional YouTube

Replaces the YouTube homepage with a calm, chronological feed from your subscriptions. No recommendations. No algorithm.

---

## Installation

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select this `watchful-extension` folder
5. Done — the extension is installed

---

### 2. Get a YouTube Data API key

The extension uses the YouTube Data API v3 (free, 10,000 units/day — plenty for personal use).

#### a) Create a Google Cloud project

1. Go to https://console.cloud.google.com/
2. Click the project dropdown (top left) → **New Project**
3. Name it anything (e.g. `watchful`) → **Create**

#### b) Enable the YouTube Data API

1. In the left menu: **APIs & Services** → **Library**
2. Search for **YouTube Data API v3**
3. Click it → **Enable**

#### c) Create an API key

1. **APIs & Services** → **Credentials**
2. **Create Credentials** → **API key**
3. Copy the key (starts with `AIza…`)
4. Optionally: click **Restrict key** → restrict to YouTube Data API v3 for safety

#### d) Add the key to Watchful

1. Click the Watchful icon in your Chrome toolbar
2. Paste the API key
3. Optionally add topic tags (e.g. `science, cooking, lectures`)
4. Click **Save**

Now open a new tab and go to **youtube.com** — you'll see your feed.

---

## How it works

- Fetches your subscriptions list via the API
- Grabs the 5 most recent uploads from each channel
- Sorts everything newest-first — pure chronological, no ranking
- Caches for 15 minutes so you're not burning API quota on every reload
- Tracks which videos you've clicked as "seen"

## Features

- **Search** your subscriptions by title, description, or channel name
- **Filter pills** — define topics in settings, filter your feed by them
- **Channel sidebar** — click any channel to see only their videos
- **Unseen only** toggle — hide videos you've already clicked

## API quota

The free YouTube Data API v3 quota is 10,000 units/day. Fetching subscriptions + videos costs roughly 1–3 units per channel. With 50 subscriptions that's ~150 units per full refresh — well within the free limit.

---

## Note on OAuth vs API key

This extension uses a plain API key, which works for **public** channel data. If your subscriptions list is **private** (default for most accounts), the API will return an empty list.

**Fix:** In YouTube Settings → Privacy → uncheck "Keep all my subscriptions private" — OR — upgrade the extension to use OAuth 2.0 (requires registering an OAuth client in Google Cloud Console and adding `identity` permission — happy to help with that if needed).
