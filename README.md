# 🛑 Doomscroll Blocker

**A Chrome extension that interrupts mindless scrolling on social media before the algorithm wins.**

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## What It Does

Doomscroll Blocker monitors how far you scroll on social media feeds and how many short videos you watch. When you hit a self-set limit, a full-screen friction card interrupts you and forces you to make an intentional choice before continuing.

---

## Features

- **Scroll pixel counter** — set a threshold for feed-based sites
- **Short-video swipe counter** — set a swipe limit for Shorts/Reels/TikTok
- **Soft Mode** — press and hold for 3 seconds to dismiss the interruption
- **Hard Mode** — a timed break is the only way out
- **Break timer** — 5, 10, 15, 30, 60 min or custom duration
- **Draggable mini-pill** — shows your remaining break time on any page
- **Customizable site list** — add any website, choose Feed, Shorts, or both
- **Per-session stats** — scroll distance and video count shown in the popup
- **Quick pause** — pause for 5 minutes without setting a full break

### Monitored by Default

YouTube Shorts · TikTok · Instagram (Feed + Reels) · Facebook · X (Twitter) · Reddit · LinkedIn · Threads

---

## Installation

### From the Chrome Web Store *(coming soon)*
Search for **"Doomscroll Blocker"** in the Chrome Web Store.

### Manual / Dev Install
1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top right toggle)
4. Click **"Load unpacked"** and select the project folder
5. The extension icon will appear in your toolbar

---

## How to Use

1. Click the extension icon to open the popup
2. Set your scroll limit (pixels) and swipe limit using the sliders
3. Browse normally — the extension runs in the background
4. When you hit your limit, a card will appear:
   - **Soft Mode:** press and hold the button for 3 seconds to continue
   - **Hard Mode:** take a break — choose a duration and wait it out
5. A green mini-pill shows your remaining break time as you browse

---

## Privacy

All data stays in your browser. No tracking, no analytics, no external servers.

- Scroll counts and video counts are **session-only** (reset on page reload)
- Settings are stored locally via Chrome's built-in `storage.sync`
- No page content is ever read, stored, or transmitted

→ [Full Privacy Policy](./privacy_policy.md)

---

## Project Structure

```
doomscroll-extension/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker — alarm handling
├── content.js          # Core scroll/swipe detection + UI injection
├── content.css         # Styles for the injected overlay and pill
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic — settings, stats, site list
├── icons/              # Extension icons (16, 32, 48, 128px)
└── privacy_policy.md   # Privacy policy
```

---

## License

MIT — free to use, modify, and distribute.

---

Made by [@madmatzz](https://github.com/madmatzz)
