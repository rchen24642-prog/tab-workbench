const META_PREFIX = "tabMeta:";
const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const state = { windows: [], groups: new Map(), meta: new Map(), later: [], selectedLater: new Set(), currentWindowId: null, view: "open", editingTab: null, editingGroup: null };

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const metaKey = (tabId, url) => `${META_PREFIX}${tabId}:${encodeURIComponent(url || "")}`;
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "新标签页"; } };
const originPattern = (url) => { try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? `${parsed.origin}/*` : null; } catch { return null; } };
const colorMap = { grey: "#94a3b8", blue: "#3559d6", red: "#c24141", yellow: "#ca8a04", green: "#168467", pink: "#c44e72", purple: "#6d5dfc", cyan: "#0891b2", orange: "#d1662f" };

let refreshTimer;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(load, 120); }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 1600); }

async function claimMetadata(tabs) {
  const stored = await chrome.storage.local.get(null);
  const activeIds = new Set(tabs.map((tab) => tab.id));
  const claimed = new Set();
  const changes = {};
  const removals = [];
  state.meta.clear();

  for (const tab of tabs) {
    const key = metaKey(tab.id, tab.url);
    let meta = stored[key];
    if (!meta && tab.url) {
      const orphanKey = Object.keys(stored).find((candidate) => {
        if (!candidate.startsWith(META_PREFIX) || claimed.has(candidate)) return false;
        const oldId = Number(candidate.slice(META_PREFIX.length).split(":", 1)[0]);
        return !activeIds.has(oldId) && stored[candidate]?.url === tab.url;
      });
      if (orphanKey) {
        meta = stored[orphanKey];
        claimed.add(orphanKey);
        changes[key] = { ...meta, tabId: tab.id };
        removals.push(orphanKey);
      }
    }
    if (meta) state.meta.set(key, meta);
  }
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  if (removals.length) await chrome.storage.local.remove(removals);
}

async function load() {
  const [windows, groups, focused, stored] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null),
    chrome.storage.local.get({ laterRecords: [] })
  ]);
  state.windows = windows;
  state.groups = new Map(groups.map((group) => [group.id, group]));
  state.currentWindowId = focused?.id ?? windows[0]?.id ?? null;
  state.later = stored.laterRecords || [];
  await claimMetadata(windows.flatMap((window) => window.tabs || []));
  render();
}

function tabMeta(tab) { return state.meta.get(metaKey(tab.id, tab.url)) || { customTitle: "", note: "", url: tab.url }; }
function displayTitle(tab) { return tabMeta(tab).customTitle || tab.title || "新标签页"; }
function matches(query, values) { return !query || values.some((value) => String(value || "").toLocaleLowerCase().includes(query)); }

function render() {
  const allTabs = state.windows.flatMap((window) => window.tabs || []);
  $("#open-count").textContent = allTabs.length;
  $("#later-count").textContent = state.later.length;
  $("#scope-label").textContent = $("#window-filter").value === "all" ? `${state.windows.length} 个窗口` : "当前窗口";
  renderWindows();
  renderLater();
}

function renderWindows() {
  const container = $("#windows");
  const query = $("#search").value.trim().toLocaleLowerCase();
  const chosen = $("#window-filter").value === "all" ? state.windows : state.windows.filter((window) => window.id === state.currentWindowId);
  let visibleTabs = 0;
  container.innerHTML = chosen.map((window, windowIndex) => {
    const grouped = new Map();
    for (const tab of window.tabs || []) {
      const key = tab.groupId ?? NONE;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(tab);
    }
    const groupHtml = [...grouped.entries()].map(([groupId, tabs]) => {
      const group = groupId === NONE ? { id: NONE, title: "未分组", color: "grey", collapsed: false } : state.groups.get(groupId);
      if (!group) return "";
      const filtered = tabs.filter((tab) => {
        const meta = tabMeta(tab);
        return matches(query, [displayTitle(tab), tab.title, tab.url, meta.note, group.title]);
      });
      if (!filtered.length) return "";
      visibleTabs += filtered.length;
      return `<section class="group ${group.collapsed ? "collapsed" : ""}" data-group-id="${groupId}" data-window-id="${window.id}">
        <div class="group-header">
          <button class="chevron" data-action="toggle-group" aria-label="展开或折叠">${group.collapsed ? "▶" : "▼"}</button>
          <span class="group-dot" style="background:${colorMap[group.color] || colorMap.grey}"></span>
          <span class="group-name">${escapeHtml(group.title || "未命名分组")}</span><span class="group-count">${tabs.length}</span>
          ${groupId === NONE ? "" : '<button class="icon-button" data-action="edit-group" aria-label="修改分组">···</button>'}
        </div>
        <div class="tab-list">${filtered.map(renderTab).join("")}</div>
      </section>`;
    }).join("");
    if (!groupHtml) return "";
    const label = window.id === state.currentWindowId ? `窗口 ${windowIndex + 1} · 正在使用` : `窗口 ${windowIndex + 1}`;
    return `<section class="window" data-window-id="${window.id}"><div class="window-title"><span>${label}</span><span>${window.tabs?.length || 0} 个标签页</span></div>${groupHtml}</section>`;
  }).join("");
  if (!visibleTabs) container.innerHTML = `<div class="empty">${query ? "没有匹配的标签页" : "当前没有可管理的标签页"}</div>`;
}

function renderTab(tab) {
  const meta = tabMeta(tab);
  const title = displayTitle(tab);
  const favicon = tab.favIconUrl ? `<img class="favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">` : `<span class="favicon favicon-fallback">${escapeHtml(title.slice(0, 1).toUpperCase())}</span>`;
  return `<article class="tab-item ${tab.active ? "active" : ""}" draggable="true" data-tab-id="${tab.id}">
    ${favicon}<div class="tab-copy" data-action="activate-tab"><div class="tab-title">${escapeHtml(title)} ${meta.note ? '<span class="note-dot">●</span>' : ""}</div><div class="tab-meta">${escapeHtml(hostOf(tab.url))}${meta.note ? ` · ${escapeHtml(meta.note)}` : ""}</div></div>
    <div class="tab-actions"><button class="icon-button" data-action="copy" aria-label="复制 URL">⧉</button><button class="icon-button" data-action="edit-tab" aria-label="修改名称和备注">✎</button><button class="icon-button" data-action="later" aria-label="稍后再看">◷</button></div>
  </article>`;
}

function renderLater() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const filter = $("#later-filter").value;
  const records = [...state.later].sort((a, b) => b.savedAt - a.savedAt).filter((record) => matches(query, [record.customTitle, record.title, record.url, record.note, record.groupTitle])).filter((record) => filter === "all" || (filter === "notes" && record.note) || (filter === "grouped" && record.groupTitle));
  $("#later-list").innerHTML = records.length ? records.map((record) => `<article class="later-item" data-record-id="${record.id}">
    <input class="later-select" type="checkbox" aria-label="选择记录" ${state.selectedLater.has(record.id) ? "checked" : ""}>
    <span class="favicon favicon-fallback">${escapeHtml((record.customTitle || record.title || "?").slice(0, 1).toUpperCase())}</span>
    <div class="tab-copy"><div class="tab-title">${escapeHtml(record.customTitle || record.title || "新标签页")}</div><div class="tab-meta">${escapeHtml(new Date(record.savedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}${record.groupTitle ? ` · ${escapeHtml(record.groupTitle)}` : ""}</div></div>
    <div class="later-actions"><button data-action="restore">恢复</button><button class="delete" data-action="delete-record">删除</button></div>
  </article>`).join("") : `<div class="empty">${query ? "没有匹配的稍后再看记录" : "还没有稍后再看的标签页"}</div>`;
}

async function saveLaterRecords() { await chrome.storage.local.set({ laterRecords: state.later }); render(); }
function recordFromTab(tab, batchId = null) { const meta = tabMeta(tab); const group = state.groups.get(tab.groupId); return { id: crypto.randomUUID(), batchId, url: tab.url, title: tab.title, customTitle: meta.customTitle || "", note: meta.note || "", groupTitle: group?.title || "", groupColor: group?.color || "grey", savedAt: Date.now() }; }

async function putAside(tabIds, batchId = null) {
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
  state.later.push(...tabs.filter((tab) => tab.url && !tab.url.startsWith("chrome://")).map((tab) => recordFromTab(tab, batchId)));
  await chrome.storage.local.set({ laterRecords: state.later });
  await chrome.tabs.remove(tabs.map((tab) => tab.id));
  toast(`✓ ${tabs.length} 个标签页已放入稍后再看`);
  await load();
}

async function restoreRecords(records) {
  const created = [];
  for (const record of records) {
    const tab = await chrome.tabs.create({ url: record.url, active: false });
    created.push({ tab, record });
    const key = metaKey(tab.id, record.url);
    await chrome.storage.local.set({ [key]: { tabId: tab.id, url: record.url, customTitle: record.customTitle, note: record.note, originalTitle: record.title } });
  }
  const batches = new Map();
  for (const item of created.filter((item) => item.record.batchId)) {
    if (!batches.has(item.record.batchId)) batches.set(item.record.batchId, []);
    batches.get(item.record.batchId).push(item);
  }
  for (const items of batches.values()) {
    const groupId = await chrome.tabs.group({ tabIds: items.map((item) => item.tab.id) });
    await chrome.tabGroups.update(groupId, { title: items[0].record.groupTitle, color: items[0].record.groupColor });
  }
  const ids = new Set(records.map((record) => record.id));
  state.later = state.later.filter((record) => !ids.has(record.id));
  ids.forEach((id) => state.selectedLater.delete(id));
  await chrome.storage.local.set({ laterRecords: state.later });
  if (created[0]) await chrome.tabs.update(created[0].tab.id, { active: true });
  toast(`✓ 已恢复 ${created.length} 个标签页`);
  await load();
}

document.addEventListener("click", async (event) => {
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const tabNode = actionNode.closest(".tab-item");
  const tabId = Number(tabNode?.dataset.tabId);
  if (action === "activate-tab") { const tab = await chrome.tabs.get(tabId); await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tabId, { active: true }); }
  if (action === "copy") { const tab = await chrome.tabs.get(tabId); await navigator.clipboard.writeText(tab.url); toast("✓ URL 已复制到剪贴板"); }
  if (action === "edit-tab") {
    const tab = await chrome.tabs.get(tabId); const meta = tabMeta(tab); state.editingTab = tab;
    $("#custom-title").value = meta.customTitle || ""; $("#note").value = meta.note || ""; $("#sync-title").checked = Boolean(meta.syncTitle); $("#original-title").textContent = meta.originalTitle || tab.title || ""; $("#current-url").textContent = tab.url || ""; $("#tab-dialog").showModal();
  }
  if (action === "later") await putAside([tabId]);
  if (action === "toggle-group") {
    const groupId = Number(actionNode.closest(".group").dataset.groupId);
    if (groupId === NONE) actionNode.closest(".group").classList.toggle("collapsed"); else { const group = state.groups.get(groupId); await chrome.tabGroups.update(groupId, { collapsed: !group.collapsed }); }
  }
  if (action === "edit-group") {
    const groupId = Number(actionNode.closest(".group").dataset.groupId); state.editingGroup = state.groups.get(groupId);
    $("#group-title").value = state.editingGroup.title || ""; $("#group-color").value = state.editingGroup.color; $("#group-dialog").showModal();
  }
  if (action === "restore") { const record = state.later.find((item) => item.id === actionNode.closest(".later-item").dataset.recordId); await restoreRecords([record]); }
  if (action === "delete-record") { state.later = state.later.filter((item) => item.id !== actionNode.closest(".later-item").dataset.recordId); await saveLaterRecords(); toast("记录已删除"); }
});
document.addEventListener("change", (event) => { if (!event.target.classList.contains("later-select")) return; const id = event.target.closest(".later-item").dataset.recordId; if (event.target.checked) state.selectedLater.add(id); else state.selectedLater.delete(id); });

$("#save-tab").addEventListener("click", async (event) => {
  event.preventDefault(); const tab = state.editingTab; if (!tab) return;
  const syncTitle = $("#sync-title").checked; const pattern = originPattern(tab.url); let syncGranted = false;
  if (syncTitle && pattern) syncGranted = await chrome.permissions.request({ origins: [pattern] });
  if (syncTitle && !syncGranted) toast("未获得当前网站权限，顶部标题不会修改");
  const data = { tabId: tab.id, url: tab.url, customTitle: $("#custom-title").value.trim(), note: $("#note").value.trim(), originalTitle: tabMeta(tab).originalTitle || tab.title || "", syncTitle: syncGranted };
  await chrome.storage.local.set({ [metaKey(tab.id, tab.url)]: data }); $("#tab-dialog").close(); toast("✓ 名称和备注已保存"); await load();
  chrome.runtime.sendMessage({ type: "apply-title", tabId: tab.id, url: tab.url });
});
$("#save-group").addEventListener("click", async (event) => { event.preventDefault(); if (!state.editingGroup) return; await chrome.tabGroups.update(state.editingGroup.id, { title: $("#group-title").value.trim(), color: $("#group-color").value }); $("#group-dialog").close(); toast("✓ 分组已更新"); });
$("#later-group").addEventListener("click", async () => { if (!state.editingGroup) return; const tabs = await chrome.tabs.query({ groupId: state.editingGroup.id }); $("#group-dialog").close(); await putAside(tabs.map((tab) => tab.id), crypto.randomUUID()); });
$("#ungroup").addEventListener("click", async () => { if (!state.editingGroup) return; const tabs = await chrome.tabs.query({ groupId: state.editingGroup.id }); await chrome.tabs.ungroup(tabs.map((tab) => tab.id)); $("#group-dialog").close(); toast("✓ 已取消分组"); });

$("#new-group").addEventListener("click", async () => { const [active] = await chrome.tabs.query({ active: true, windowId: state.currentWindowId }); if (!active) return; const title = prompt("新分组名称", "新分组"); if (title === null) return; const groupId = await chrome.tabs.group({ tabIds: [active.id] }); await chrome.tabGroups.update(groupId, { title: title.trim(), color: "purple" }); });
$("#later-filter").addEventListener("change", renderLater);
$("#restore-selected").addEventListener("click", () => { const selected = state.later.filter((record) => state.selectedLater.has(record.id)); if (!selected.length) return toast("请先选择记录"); restoreRecords(selected); });
$("#delete-selected").addEventListener("click", async () => { if (!state.selectedLater.size) return toast("请先选择记录"); state.later = state.later.filter((record) => !state.selectedLater.has(record.id)); state.selectedLater.clear(); await saveLaterRecords(); toast("✓ 已删除所选记录"); });
$("#search").addEventListener("input", render);
$("#window-filter").addEventListener("change", render);
$("#export-data").addEventListener("click", async () => { const data = await chrome.storage.local.get(null); const blob = new Blob([JSON.stringify({ format: "tab-workbench", version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tab-workbench-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); toast("✓ 数据已导出"); });
$("#import-data").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()); if (parsed.format !== "tab-workbench" || !parsed.data || typeof parsed.data !== "object") throw new Error("文件格式不正确"); if (!confirm("导入会合并数据，并用同名记录覆盖现有内容。继续吗？")) return; const existing = await chrome.storage.local.get({ laterRecords: [] }); const importedLater = parsed.data.laterRecords || []; const laterMap = new Map([...existing.laterRecords, ...importedLater].map((record) => [record.id, record])); await chrome.storage.local.set({ ...parsed.data, laterRecords: [...laterMap.values()] }); toast("✓ 数据导入完成"); await load(); } catch (error) { toast(`导入失败：${error.message}`); } finally { event.target.value = ""; } });
document.querySelectorAll(".view-tabs button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".view-tabs button").forEach((node) => node.classList.toggle("active", node === button)); state.view = button.dataset.view; $("#open-view").hidden = state.view !== "open"; $("#later-view").hidden = state.view !== "later"; }));

let draggedTabId = null;
document.addEventListener("dragstart", (event) => { const item = event.target.closest(".tab-item"); if (!item) return; draggedTabId = Number(item.dataset.tabId); item.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; });
document.addEventListener("dragend", (event) => { event.target.closest(".tab-item")?.classList.remove("dragging"); document.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target")); draggedTabId = null; });
document.addEventListener("dragover", (event) => { const group = event.target.closest(".group"); if (!group || !draggedTabId) return; event.preventDefault(); document.querySelectorAll(".group").forEach((node) => node.classList.toggle("drop-target", node === group)); document.querySelectorAll(".tab-item").forEach((node) => node.classList.remove("drop-before", "drop-after")); const target = event.target.closest(".tab-item"); if (target && Number(target.dataset.tabId) !== draggedTabId) target.classList.add(event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2 ? "drop-before" : "drop-after"); });
document.addEventListener("drop", async (event) => { const group = event.target.closest(".group"); if (!group || !draggedTabId) return; event.preventDefault(); const targetNode = event.target.closest(".tab-item"); const targetTab = targetNode ? await chrome.tabs.get(Number(targetNode.dataset.tabId)) : null; const groupId = Number(group.dataset.groupId); if (groupId === NONE) await chrome.tabs.ungroup([draggedTabId]); else await chrome.tabs.group({ groupId, tabIds: [draggedTabId] }); if (targetTab && targetTab.id !== draggedTabId) { const after = targetNode.classList.contains("drop-after"); await chrome.tabs.move(draggedTabId, { index: targetTab.index + (after ? 1 : 0) }); } toast(`✓ 已移动到「${group.querySelector(".group-name").textContent}」`); draggedTabId = null; scheduleRefresh(); });

chrome.runtime.onMessage.addListener(() => scheduleRefresh());
load().catch((error) => { console.error(error); $("#windows").innerHTML = `<div class="empty">加载失败：${escapeHtml(error.message)}</div>`; });
