# Privacy Policy — DoomScroll Guard

**Last updated:** March 2026

## Overview

DoomScroll Guard ("the Extension") is a Chrome browser extension designed to help users become aware of and limit mindless scrolling and short-video consumption on social media sites. **The Extension does not collect, transmit, or share any personal data.**

---

## What Data the Extension Accesses

To function, the Extension accesses the following information **locally in your browser only**:

| Data | Purpose | Stored? |
|---|---|---|
| Current page URL / hostname | Checks if the site is on your monitored list | No — checked in memory only |
| Scroll distance (pixels) | Counts how far you've scrolled to detect doomscrolling | Session only — reset on page reload |
| Short-video URL changes | Counts how many Shorts/Reels/TikToks you've watched | Session only — reset on page reload |
| Your settings (thresholds, tracked sites, break timers) | Saves your preferences | Yes — `chrome.storage.sync` (your own browser account) |

---

## What We Do NOT Do

- ❌ We do **not** collect your browsing history
- ❌ We do **not** send any data to external servers
- ❌ We do **not** use analytics, trackers, or third-party SDKs
- ❌ We do **not** store or transmit page content, usernames, or personal information
- ❌ We do **not** sell data of any kind

---

## What We Do

- ✅ We **count** pixels you scroll on sites you choose to monitor (session only, in-memory)
- ✅ We **count** short videos you watch on sites you choose to monitor (session only, in-memory)
- ✅ We **save your settings** (thresholds, site list, break timers) locally via `chrome.storage.sync`
- ✅ We **show you an interruption** when you hit your own self-set limits
- ✅ We give you tools to **take a break** and resume on your own terms

---

## Data Storage

Your settings (scroll threshold, tracked site list, break timer state) are saved using Chrome's built-in `chrome.storage.sync` API. This stores data locally in your browser and, if you are signed into Chrome, syncs it across your own devices via your Google account. **We have no access to this data.**

---

## Permissions Explained

| Permission | Reason |
|---|---|
| `storage` | Save and restore your settings (thresholds, site list, break state) |
| `alarms` | Wake the extension's service worker when a break timer expires |
| `tabs` | Send messages between the popup and the active page |
| Access to all URLs | The monitored site list is user-configurable — the extension must run on any site the user chooses to monitor |

---

## Changes to This Policy

If the Extension's data practices change, this policy will be updated. Continued use of the Extension constitutes acceptance of any changes.

---

## Contact

For questions or concerns, open an issue on the extension's GitHub repository or contact the developer directly.
