# Watchful

A calm, intentional YouTube frontend. Replaces the YouTube homepage with a chronological feed from your subscriptions — no algorithm, no recommendations, no rabbit holes.

---

## Features

- Subscription feed in chronological order
- Organize channels into collapsible, nested categories via drag & drop
- Add your YouTube playlists to the sidebar (with remove-from-playlist support)
- Search across your subscriptions
- Filter by category
- "Unseen only" toggle
- Focus mode on watch pages — hides sidebar, comments, and end cards
- Export/import your settings (categories, playlists, preferences)

---

## Installation

### 1. Download or clone this repository

```bash
git clone https://github.com/yourusername/watchful.git
```

Or download the ZIP from GitHub and unzip it.

### 2. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `watchful-extension` folder
5. Note the **Extension ID** shown beneath the extension name — you'll need it shortly

---

## Google API Setup

Watchful uses the YouTube Data API to fetch your subscriptions and manage playlists. This requires a Google Cloud project and OAuth credentials. It takes about 10 minutes.

### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown (top left) → **New Project**
3. Name it `watchful` → **Create**
4. Make sure your new project is selected in the dropdown

### Step 2 — Enable the YouTube Data API

1. In the left menu: **APIs & Services** → **Library**
2. Search for **YouTube Data API v3**
3. Click it → **Enable**

### Step 3 — Configure the OAuth consent screen

1. In the left menu: **APIs & Services** → **OAuth consent screen** (or search "OAuth consent screen")
2. Click **Get started**
3. Fill in:
   - **App name:** Watchful
   - **User support email:** your Gmail address
4. Click **Next** through the remaining steps until you reach **Data Access**
5. Click **Add or remove scopes**
6. In the search box type `youtube` and select:
   - `https://www.googleapis.com/auth/youtube` — **Manage your YouTube account**
     *(This covers both reading subscriptions and managing playlists)*
7. Click **Update** → **Save**
8. Go to **Audience** in the left sidebar
9. Under **Test users**, click **Add users**
10. Add your own Gmail address → **Save**

> **Note:** Your app stays in "Testing" mode — this is fine for personal use. You never need to publish or verify it.

### Step 4 — Create OAuth credentials

1. In the left menu: **Clients** (under OAuth consent screen) → **Create OAuth client**
   *(Or go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**)*
2. Application type: **Chrome Extension**
3. Name: `Watchful`
4. **Item ID:** paste your Extension ID from Step 1 above
5. Click **Create**
6. Copy the **Client ID** shown (it ends in `.apps.googleusercontent.com`)

### Step 5 — Add the Client ID to the extension

1. Open the `watchful-extension` folder
2. Open `manifest.json` in any text editor
3. Find the `oauth2` block and replace the placeholder:

```json
"oauth2": {
  "client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/youtube"]
}
```

4. Save `manifest.json`
5. Go to `chrome://extensions` → click the **refresh icon** on Watchful
6. Open [youtube.com](https://youtube.com) — you'll be prompted to sign in with Google

---

## Usage

### Organizing channels

- Drag any channel from the sidebar into a category header to assign it
- Double-click a category name to rename it
- Click **+** on a category header to add a subcategory
- Drag a category header onto another category to nest it
- Category filter pills appear in the top bar

### Adding playlists

1. Click the ⚙️ settings gear on the YouTube page (top right)
2. Under **Add playlist**, type the exact name of one of your YouTube playlists
3. Click **Add** — Watchful will verify it exists and add it to the sidebar
4. Hover a playlist video to reveal the ✕ button to remove it from the playlist

### Focus mode

Enable in settings → hides the YouTube sidebar, comments, and end cards on watch pages. A small "focus on/off" button appears in the bottom-right corner of watch pages to toggle it per video.

### Export / Import

Settings → Export JSON saves all your categories, playlists, and preferences to a file. Import JSON restores them — useful for migrating to a new machine.

---

## Testing

The category tree logic lives in `categories.js` as a pure ES module with no Chrome API or DOM dependencies. Tests use [Vitest](https://vitest.dev/) and require Node.js.

```bash
npm install
npm test          # run once
npm run test:watch  # re-run on file changes
```

The test file is `categories.test.js`. It covers tree queries, collapsed-path remapping, and all mutation operations (add, remove, rename, move channel, move category).

---

## API quota

The YouTube Data API v3 free quota is **10,000 units/day**. Fetching subscriptions + recent videos costs roughly 2–4 units per channel. With 50 subscriptions and 5 videos per channel, a full refresh costs ~250 units — well within the free limit. The feed caches for 15 minutes to minimize API calls.

---

## Privacy

Watchful runs entirely in your browser. Your API credentials and channel data are stored locally in `chrome.storage.local`. Nothing is sent to any server other than Google's YouTube API.

