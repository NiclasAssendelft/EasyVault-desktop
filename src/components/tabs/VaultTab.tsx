import { useState, useCallback, useRef } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { useSyncStore } from "../../stores/syncStore";
import { asString, normalizeFolder } from "../../services/helpers";
import { invokeEdgeFunction, entityFilter } from "../../api";
import { safeEntityCreate } from "../../services/entityService";
import { getPreferredUploadToken, getAuthToken } from "../../storage";
import { useT, t } from "../../i18n";

function RowMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  return (
    <div className="row-menu">
      <button className="row-menu-btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>&#x22EE;</button>
      {open && (
        <div className="row-menu-dropdown open">
          <button onClick={() => { onAction("delete"); setOpen(false); }}>{tr("menu.delete")}</button>
        </div>
      )}
    </div>
  );
}

type GatherItems = {
  vault?: { item_id: string; title: string; reason: string; confidence: number }[];
  emails?: { item_id: string; title: string; reason: string; confidence: number }[];
  events?: { item_id: string; title: string; reason: string; confidence: number }[];
};

type PackDetailItem = {
  item_id: string;
  item_type: string;
  title: string;
  reason: string;
  confidence: number;
};

function flattenGatherItems(items: GatherItems): PackDetailItem[] {
  const flat: PackDetailItem[] = [];
  for (const it of items.vault ?? []) flat.push({ ...it, item_type: "vault" });
  for (const it of items.emails ?? []) flat.push({ ...it, item_type: "email" });
  for (const it of items.events ?? []) flat.push({ ...it, item_type: "calendar" });
  flat.sort((a, b) => b.confidence - a.confidence);
  return flat;
}

type PendingGatherResult = {
  topic: string;
  packTitle: string;
  summary: string;
  flatItems: PackDetailItem[];
  itemCount: number;
  vaultCount: number;
  emailCount: number;
  eventCount: number;
};

export default function VaultTab() {
  const packs = useRemoteDataStore((s) => s.packs);
  const setStatus = useUiStore((s) => s.setStatus);
  const [topic, setTopic] = useState("");
  const [gathering, setGathering] = useState(false);
  const [pendingResult, setPendingResult] = useState<PendingGatherResult | null>(null);
  const [packName, setPackName] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [packItems, setPackItems] = useState<PackDetailItem[]>([]);
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);
  const localPackItemsRef = useRef<Record<string, PackDetailItem[]>>({});
  const tr = useT();

  const handleGather = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;
    setGathering(true);
    setPendingResult(null);
    try {
      setStatus(t("vault.searching"));
      const result = await invokeEdgeFunction<Record<string, unknown>>("gatherRelated", { topic: trimmed });

      const items = (result?.items ?? {}) as GatherItems;
      const vaultCount = Array.isArray(items.vault) ? items.vault.length : 0;
      const emailCount = Array.isArray(items.emails) ? items.emails.length : 0;
      const eventCount = Array.isArray(items.events) ? items.events.length : 0;
      const itemCount = vaultCount + emailCount + eventCount;

      const packTitle = asString(result?.pack_title) || trimmed;
      const summary = asString(result?.summary) || "";

      if (itemCount === 0) {
        setStatus(t("vault.noResults", { topic: trimmed }));
        return;
      }

      const flatItems = flattenGatherItems(items);
      setSelectedIds(new Set(flatItems.map((it) => it.item_id)));
      setPendingResult({ topic: trimmed, packTitle, summary, flatItems, itemCount, vaultCount, emailCount, eventCount });
      setPackName(packTitle);
      setStatus(t("vault.found", { count: itemCount }));
      setTopic("");
    } catch (err) {
      setStatus(t("vault.gatherFailed", { error: String(err) }));
    } finally {
      setGathering(false);
    }
  }, [topic, setStatus]);

  const handleSavePack = useCallback(async () => {
    if (!pendingResult) return;
    const selectedItems = pendingResult.flatItems.filter((it) => selectedIds.has(it.item_id));
    if (selectedItems.length === 0) { setStatus(t("vault.selectAtLeastOne")); return; }
    setSaving(true);
    try {
      const title = packName.trim() || pendingResult.packTitle;
      const created = await safeEntityCreate("GatherPack", {
        title, topic: pendingResult.topic, summary: pendingResult.summary, item_count: selectedItems.length,
      });
      const record = created as Record<string, unknown>;
      const createdId = asString(record?.id);
      if (createdId) localPackItemsRef.current[createdId] = selectedItems;
      const newPack = { id: createdId, title, topic: pendingResult.topic, summary: pendingResult.summary, item_count: selectedItems.length, ...record };
      useRemoteDataStore.getState().setPacks([newPack, ...packs]);
      setStatus(t("vault.packSaved", { title, count: selectedItems.length }));
      setPendingResult(null);
      setPackName("");
      setSelectedIds(new Set());
    } catch (err) {
      setStatus(t("vault.saveFailed", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [pendingResult, packName, packs, setStatus, selectedIds]);

  const handleDiscardPending = useCallback(() => {
    setPendingResult(null);
    setPackName("");
    setStatus("");
  }, [setStatus]);

  const handlePackClick = useCallback(async (packId: string) => {
    if (expandedPackId === packId) { setExpandedPackId(null); setPackItems([]); return; }
    setExpandedPackId(packId);
    const cached = localPackItemsRef.current[packId];
    if (cached) { setPackItems(cached); return; }
    setLoadingPackId(packId);
    setPackItems([]);
    try {
      const token = getPreferredUploadToken() || getAuthToken() || undefined;
      const items = await entityFilter<Record<string, unknown>>("GatherPackItem", { pack_id: packId }, "rank", 100, token);
      const mapped: PackDetailItem[] = items.map((it) => ({
        item_id: asString(it.item_id), item_type: asString(it.item_type, "vault"),
        title: asString(it.title, asString(it.item_id, "Untitled")), reason: asString(it.reason),
        confidence: typeof it.confidence === "number" ? it.confidence : 0,
      }));
      setPackItems(mapped);
      localPackItemsRef.current[packId] = mapped;
    } catch (err) {
      setStatus(t("vault.loadFailed", { error: String(err) }));
    } finally {
      setLoadingPackId(null);
    }
  }, [expandedPackId, setStatus]);

  const handlePackItemClick = useCallback((item: PackDetailItem) => {
    if (item.item_type === "vault") {
      const found = useFilesStore.getState().items.find((i) => i.id === item.item_id);
      if (found) {
        useUiStore.getState().setFileActionTargetId(item.item_id);
      } else {
        setStatus(t("vault.itemNotFound", { title: item.title }));
      }
    } else if (item.item_type === "email") {
      const found = useRemoteDataStore.getState().emails.find((e) => asString(e.id) === item.item_id);
      if (found) {
        useUiStore.getState().openManageModal({ kind: "item", id: item.item_id, entity: "EmailItem" }, "");
      } else {
        setStatus(t("vault.emailNotFound", { title: item.title }));
      }
    } else if (item.item_type === "calendar") {
      const found = useRemoteDataStore.getState().events.find((e) => asString(e.id) === item.item_id);
      if (found) {
        useUiStore.getState().openManageModal({ kind: "item", id: item.item_id, entity: "CalendarEvent" }, "");
      } else {
        setStatus(t("vault.eventNotFound", { title: item.title }));
      }
    }
  }, [setStatus]);

  const handleSaveAsFolder = useCallback(async (folderName: string, items: PackDetailItem[]) => {
    const vaultItems = items.filter((it) => it.item_type === "vault");
    if (vaultItems.length === 0) { setStatus(t("vault.noVaultFiles")); return; }
    try {
      const { personalSpaceId } = useAuthStore.getState();
      const result = await safeEntityCreate<Record<string, unknown>>("Folder", {
        name: folderName, space_id: personalSpaceId, parent_folder_id: "",
      });
      const record = result as Record<string, unknown>;
      const folderId = asString(record?.id);
      if (!folderId) { setStatus(t("vault.folderCreateFailed", { error: "missing id" })); return; }
      const updatedAt = asString(record?.updated_date) || new Date().toISOString();
      const newFolder = normalizeFolder({ id: folderId, name: folderName, createdAtIso: new Date().toISOString(), spaceId: personalSpaceId });
      useSyncStore.getState().setEntityUpdatedAt("Folder", folderId, updatedAt);
      useFilesStore.getState().addFolder(newFolder);
      for (const vi of vaultItems) {
        useFilesStore.getState().updateItem(vi.item_id, { folderId });
      }
      useFilesStore.getState().persist();
      setStatus(t("vault.folderCreated", { name: folderName, count: vaultItems.length }));
    } catch (err) {
      setStatus(t("vault.folderCreateFailed", { error: String(err) }));
    }
  }, [setStatus]);

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{tr("vault.title")}</h2>
          <p className="page-subtitle">{tr("vault.subtitle")}</p>
        </div>
      </div>

      <div className="gather-box">
        <div className="gather-row">
          <input
            type="text"
            placeholder={tr("vault.placeholder")}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleGather(); }}
          />
          <button type="button" onClick={handleGather} disabled={gathering || !topic.trim()}>
            {gathering ? tr("vault.gathering") : tr("vault.gather")}
          </button>
        </div>
        <p>{tr("vault.gatherDesc")}</p>
      </div>

      {pendingResult && (
        <div className="gather-result">
          <div className="gather-result-header">
            <span className="gather-result-counts">
              {pendingResult.vaultCount > 0 && <span className="gather-badge">📄 {tr("vault.files", { count: pendingResult.vaultCount })}</span>}
              {pendingResult.emailCount > 0 && <span className="gather-badge">✉ {tr("vault.emails", { count: pendingResult.emailCount })}</span>}
              {pendingResult.eventCount > 0 && <span className="gather-badge">📅 {tr("vault.events", { count: pendingResult.eventCount })}</span>}
            </span>
          </div>
          {pendingResult.summary && <p className="gather-result-summary">{pendingResult.summary}</p>}
          <div className="gather-select-bar">
            <label className="gather-select-all">
              <input
                type="checkbox"
                checked={selectedIds.size === pendingResult.flatItems.length}
                onChange={() => {
                  if (selectedIds.size === pendingResult.flatItems.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(pendingResult.flatItems.map((it) => it.item_id)));
                  }
                }}
              />
              {t("vault.selected", { selected: selectedIds.size, total: pendingResult.flatItems.length })}
            </label>
          </div>
          <div className="gather-result-items">
            {pendingResult.flatItems.map((item, i) => (
              <div
                key={`${item.item_id}-${i}`}
                className={`pack-item-row selectable${selectedIds.has(item.item_id) ? "" : " deselected"}`}
                onClick={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.item_id)) next.delete(item.item_id); else next.add(item.item_id);
                    return next;
                  });
                }}
              >
                <input
                  type="checkbox"
                  className="pack-item-check"
                  checked={selectedIds.has(item.item_id)}
                  onChange={() => {}}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="pack-item-type">{item.item_type === "vault" ? "📄" : item.item_type === "email" ? "✉" : "📅"}</span>
                <div className="pack-item-body">
                  <p className="pack-item-title">{item.title}</p>
                  {item.reason && <p className="pack-item-reason files-scope-label">{item.reason}</p>}
                </div>
                {item.confidence > 0 && <span className="pack-item-confidence">{Math.round(item.confidence * 100)}%</span>}
              </div>
            ))}
          </div>
          <label className="gather-result-label">{tr("vault.saveAs")}</label>
          <div className="gather-result-actions">
            <input type="text" value={packName} onChange={(e) => setPackName(e.target.value)} placeholder={tr("vault.packNamePlaceholder")} onKeyDown={(e) => { if (e.key === "Enter") void handleSavePack(); }} />
            <button type="button" onClick={handleSavePack} disabled={saving}>{saving ? tr("vault.saving") : tr("vault.savePack")}</button>
            <button type="button" className="ghost" onClick={handleDiscardPending}>{tr("vault.discard")}</button>
          </div>
        </div>
      )}

      <h4 className="section-label">{tr("vault.savedPacks")}</h4>
      <div className="files-items">
        {packs.length === 0 ? (
          <div className="dash-card"><p>{tr("vault.noPacks")}</p></div>
        ) : (
          packs.map((pack) => {
            const id = asString(pack.id);
            const title = asString(pack.title, tr("vault.untitledPack"));
            const packTopic = asString(pack.topic);
            const summary = asString(pack.summary);
            const itemCount = typeof pack.item_count === "number" ? pack.item_count : 0;
            const isExpanded = expandedPackId === id;
            const isLoading = loadingPackId === id;

            return (
              <div key={id}>
                <article className="file-row group" style={{ cursor: "pointer" }} onClick={() => void handlePackClick(id)} data-entity="GatherPack">
                  <div className="file-row-icon">{isExpanded ? "▾" : "✧"}</div>
                  <div className="file-row-body">
                    <p className="file-row-title">{title}</p>
                    <p className="file-row-sub">
                      {packTopic ? `${packTopic} • ` : ""}
                      {tr("vault.items", { count: itemCount })}
                    </p>
                  </div>
                  <RowMenu onAction={(action) => {
                    if (action === "delete") useUiStore.getState().openDeleteModal({ kind: "item", id, entity: "GatherPack" });
                  }} />
                </article>

                {isExpanded && (
                  <div className="pack-detail">
                    {summary && <p className="pack-summary">{summary}</p>}
                    {isLoading ? (
                      <p className="files-scope-label">{tr("vault.loadingItems")}</p>
                    ) : packItems.length === 0 ? (
                      <p className="files-scope-label">{tr("vault.noPackItems")}</p>
                    ) : (
                      <>
                        {packItems.map((item, i) => (
                          <div
                            key={`${item.item_id}-${i}`}
                            className="pack-item-row clickable"
                            onClick={() => handlePackItemClick(item)}
                          >
                            <span className="pack-item-type">{item.item_type === "vault" ? "📄" : item.item_type === "email" ? "✉" : "📅"}</span>
                            <div className="pack-item-body">
                              <p className="pack-item-title">{item.title}</p>
                              {item.reason && <p className="pack-item-reason files-scope-label">{item.reason}</p>}
                            </div>
                            {item.confidence > 0 && <span className="pack-item-confidence">{Math.round(item.confidence * 100)}%</span>}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="pack-to-folder-btn"
                          onClick={(e) => { e.stopPropagation(); void handleSaveAsFolder(title, packItems); }}
                        >
                          {tr("vault.saveAsFolder")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
