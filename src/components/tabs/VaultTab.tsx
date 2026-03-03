import { useState, useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { invokeBase44Function, entityFilter } from "../../api";
import { safeEntityCreate } from "../../services/entityService";
import { refreshVaultFromRemote } from "../../services/deltaSyncService";
import { getPreferredUploadToken, getAuthToken } from "../../storage";

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
  rank: number;
};

export default function VaultTab() {
  const packs = useRemoteDataStore((s) => s.packs);
  const setStatus = useUiStore((s) => s.setStatus);
  const [topic, setTopic] = useState("");
  const [gathering, setGathering] = useState(false);
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [packItems, setPackItems] = useState<PackDetailItem[]>([]);
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);

  const handleGather = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed) return;
    setGathering(true);
    try {
      setStatus(`Gathering: "${trimmed}"...`);
      const result = await invokeBase44Function<Record<string, unknown>>(
        "gatherRelated",
        { topic: trimmed },
      );

      const items = (result?.items ?? {}) as GatherItems;
      const vaultCount = Array.isArray(items.vault) ? items.vault.length : 0;
      const emailCount = Array.isArray(items.emails) ? items.emails.length : 0;
      const eventCount = Array.isArray(items.events) ? items.events.length : 0;
      const itemCount = vaultCount + emailCount + eventCount;

      const packTitle = asString(result?.pack_title) || trimmed;
      const summary = asString(result?.summary) || "";

      await safeEntityCreate("GatherPack", {
        title: packTitle,
        topic: trimmed,
        summary,
        item_count: itemCount,
      });
      await refreshVaultFromRemote();
      setStatus(`Gather pack created: "${packTitle}" (${itemCount} items)`);
      setTopic("");
    } catch (err) {
      setStatus(`Gather failed: ${String(err)}`);
    } finally {
      setGathering(false);
    }
  }, [topic, setStatus]);

  const handlePackClick = useCallback(async (packId: string) => {
    if (expandedPackId === packId) {
      setExpandedPackId(null);
      setPackItems([]);
      return;
    }

    setLoadingPackId(packId);
    setExpandedPackId(packId);
    setPackItems([]);

    try {
      const token = getPreferredUploadToken() || getAuthToken() || undefined;
      const items = await entityFilter<Record<string, unknown>>(
        "GatherPackItem",
        { pack_id: packId },
        "rank",
        100,
        token,
      );

      const mapped: PackDetailItem[] = items.map((it) => ({
        item_id: asString(it.item_id),
        item_type: asString(it.item_type, "vault"),
        title: asString(it.title, asString(it.item_id, "Untitled")),
        reason: asString(it.reason),
        confidence: typeof it.confidence === "number" ? it.confidence : 0,
        rank: typeof it.rank === "number" ? it.rank : 0,
      }));

      setPackItems(mapped);
    } catch (err) {
      setStatus(`Failed to load pack items: ${String(err)}`);
    } finally {
      setLoadingPackId(null);
    }
  }, [expandedPackId, setStatus]);

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">Vault</h2>
          <p className="page-subtitle">Gather and organize everything</p>
        </div>
      </div>

      <div className="gather-box">
        <div className="gather-row">
          <input
            type="text"
            placeholder='Try: "Q4 planning", "John Smith", "budget review"...'
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleGather();
            }}
          />
          <button
            type="button"
            onClick={handleGather}
            disabled={gathering || !topic.trim()}
          >
            {gathering ? "Gathering..." : "Gather"}
          </button>
        </div>
        <p>
          AI will search across files, links, emails, and calendar events to
          find everything related
        </p>
      </div>

      <h4 className="section-label">Saved Packs</h4>
      <div className="files-items">
        {packs.length === 0 ? (
          <div className="dash-card">
            <p>No packs yet. Use Gather above to create one.</p>
          </div>
        ) : (
          packs.map((pack) => {
            const id = asString(pack.id);
            const title = asString(pack.title, "Untitled pack");
            const packTopic = asString(pack.topic);
            const summary = asString(pack.summary);
            const itemCount = typeof pack.item_count === "number"
              ? pack.item_count
              : 0;
            const isExpanded = expandedPackId === id;
            const isLoading = loadingPackId === id;

            return (
              <div key={id}>
                <article
                  className="file-row group"
                  style={{ cursor: "pointer" }}
                  onClick={() => void handlePackClick(id)}
                  data-entity="GatherPack"
                >
                  <div className="file-row-icon">{isExpanded ? "▾" : "✧"}</div>
                  <div className="file-row-body">
                    <p className="file-row-title">{title}</p>
                    <p className="file-row-sub">
                      {packTopic ? `${packTopic} • ` : ""}
                      {itemCount} item{itemCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </article>

                {isExpanded && (
                  <div className="pack-detail">
                    {summary && (
                      <p className="pack-summary">{summary}</p>
                    )}
                    {isLoading ? (
                      <p className="files-scope-label">Loading items...</p>
                    ) : packItems.length === 0 ? (
                      <p className="files-scope-label">No items found in this pack.</p>
                    ) : (
                      packItems.map((item, i) => (
                        <div key={`${item.item_id}-${i}`} className="pack-item-row">
                          <span className="pack-item-type">
                            {item.item_type === "vault" ? "📄" : item.item_type === "email" ? "✉" : "📅"}
                          </span>
                          <div className="pack-item-body">
                            <p className="pack-item-title">{item.title}</p>
                            {item.reason && (
                              <p className="pack-item-reason files-scope-label">{item.reason}</p>
                            )}
                          </div>
                          {item.confidence > 0 && (
                            <span className="pack-item-confidence">
                              {Math.round(item.confidence * 100)}%
                            </span>
                          )}
                        </div>
                      ))
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
