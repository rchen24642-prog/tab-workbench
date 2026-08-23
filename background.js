const META_PREFIX = "tabMeta:";
const metaKey = (tabId, url) => `${META_PREFIX}${tabId}:${encodeURIComponent(url || "")}`;

function originPattern(url) {
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? `${parsed.origin}/*` : null; } catch { return null; }
}

async function applyCustomTitle(tabId, url) {
  const pattern = originPattern(url);
  if (!pattern || !(await chrome.permissions.contains({ origins: [pattern] }))) return;
  const key = metaKey(tabId, url);
  const stored = await chrome.storage.local.get(key);
  const meta = stored[key];
  if (!meta) return;
  const title = meta.syncTitle && meta.customTitle ? meta.customTitle : "";
  await chrome.scripting.executeScript({ target: { tabId }, func: (customTitle, savedOriginal) => {
    const root = document.documentElement;
    if (!root.dataset.tabWorkbenchOriginalTitle) root.dataset.tabWorkbenchOriginalTitle = savedOriginal || document.title;
    window.__tabWorkbenchTitleObserver?.disconnect();
    if (!customTitle) { document.title = root.dataset.tabWorkbenchOriginalTitle || savedOriginal || document.title; delete root.dataset.tabWorkbenchOriginalTitle; return; }
    document.title = customTitle;
    window.__tabWorkbenchTitleObserver = new MutationObserver(() => { if (document.title !== customTitle) document.title = customTitle; });
    window.__tabWorkbenchTitleObserver.observe(document.head || root, { childList: true, subtree: true, characterData: true });
  }, args: [title, meta.originalTitle || ""] }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

function broadcast(type = "tabs-changed") {
  chrome.runtime.sendMessage({ type }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "apply-title") applyCustomTitle(message.tabId, message.url);
});

async function deleteTabMetadata(tabId) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(`${META_PREFIX}${tabId}:`));
  if (keys.length) await chrome.storage.local.remove(keys);
}

chrome.tabs.onCreated.addListener(() => broadcast());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (changeInfo.status === "complete") applyCustomTitle(tabId, tab.url); broadcast(); });
chrome.tabs.onMoved.addListener(() => broadcast());
chrome.tabs.onAttached.addListener(() => broadcast());
chrome.tabs.onDetached.addListener(() => broadcast());
chrome.tabs.onActivated.addListener(() => broadcast("active-tab-changed"));
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) deleteTabMetadata(tabId).finally(broadcast);
  else broadcast();
});
chrome.windows.onCreated.addListener(() => broadcast());
chrome.windows.onRemoved.addListener(() => broadcast());
chrome.windows.onFocusChanged.addListener(() => broadcast("focused-window-changed"));
chrome.tabGroups.onCreated.addListener(() => broadcast());
chrome.tabGroups.onUpdated.addListener(() => broadcast());
chrome.tabGroups.onMoved.addListener(() => broadcast());
chrome.tabGroups.onRemoved.addListener(() => broadcast());

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-active-for-later") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || tab.url.startsWith("chrome://")) return;
  const key = metaKey(tab.id, tab.url);
  const stored = await chrome.storage.local.get({ laterRecords: [], [key]: null });
  const meta = stored[key] || {};
  const group = tab.groupId >= 0 ? await chrome.tabGroups.get(tab.groupId).catch(() => null) : null;
  stored.laterRecords.push({ id: crypto.randomUUID(), batchId: null, url: tab.url, title: tab.title, customTitle: meta.customTitle || "", note: meta.note || "", groupTitle: group?.title || "", groupColor: group?.color || "grey", savedAt: Date.now() });
  await chrome.storage.local.set({ laterRecords: stored.laterRecords });
  await chrome.tabs.remove(tab.id);
});
