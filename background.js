const META_PREFIX = "tabMeta:";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

function broadcast(type = "tabs-changed") {
  chrome.runtime.sendMessage({ type }).catch(() => {});
}

async function deleteTabMetadata(tabId) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(`${META_PREFIX}${tabId}:`));
  if (keys.length) await chrome.storage.local.remove(keys);
}

chrome.tabs.onCreated.addListener(() => broadcast());
chrome.tabs.onUpdated.addListener(() => broadcast());
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
