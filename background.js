// background.js — DoomScroll Blocker Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    paused: false,
    pauseUntil: null,
    breakUntil: null,
    scrollThreshold: 10000,
    shortsThreshold: 5,
    strictMode: false,
    lockdownSeconds: 30,
    trackedSites: [
      { host: 'youtube.com',   types: ['shorts']         },
      { host: 'facebook.com',  types: ['feed']           },
      { host: 'instagram.com', types: ['feed', 'shorts'] },
      { host: 'tiktok.com',    types: ['shorts']         },
      { host: 'x.com',         types: ['feed']           },
      { host: 'reddit.com',    types: ['feed']           },
      { host: 'linkedin.com',  types: ['feed']           },
      { host: 'threads.net',   types: ['feed']           },
    ],
  });
});

// Listen for alarm (break/pause timer expiry)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'breakOver') {
    chrome.storage.sync.set({ breakUntil: null, paused: false });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'BREAK_OVER' }).catch(() => { });
      });
    });
  }
  if (alarm.name === 'pauseOver') {
    chrome.storage.sync.set({ pauseUntil: null, paused: false });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_OVER' }).catch(() => { });
      });
    });
  }
});

// Fix 4: Single unified message listener (was duplicated — caused silent OPEN_POPUP conflict)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_BREAK') {
    const until = Date.now() + msg.minutes * 60 * 1000;
    chrome.storage.sync.set({ breakUntil: until, paused: true });
    chrome.alarms.create('breakOver', { delayInMinutes: msg.minutes });
    sendResponse({ ok: true, until });
  }
  if (msg.type === 'SET_PAUSE') {
    const until = msg.minutes ? Date.now() + msg.minutes * 60 * 1000 : null;
    chrome.storage.sync.set({ pauseUntil: until, paused: true });
    if (msg.minutes) {
      chrome.alarms.create('pauseOver', { delayInMinutes: msg.minutes });
    }
    sendResponse({ ok: true });
  }
  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {
      // Fallback: open popup.html as a small window if openPopup() isn't available
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 340,
        height: 560,
      });
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'RESUME') {
    chrome.alarms.clear('breakOver');
    chrome.alarms.clear('pauseOver');
    chrome.storage.sync.set({ paused: false, pauseUntil: null, breakUntil: null });
    sendResponse({ ok: true });
  }
  if (msg.type === 'RESET_SCROLL') {
    sendResponse({ ok: true });
  }
  return true;
});
