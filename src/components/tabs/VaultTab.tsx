import { useState, useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { invokeBase44Function } from "../../api";
import { safeEntityCreate } from "../../services/entityService";
import { refreshVaultFromRemote } from "../../services/deltaSyncService";

export default function VaultTab() {
  const packs = useRemoteDataStore((s) => s.packs);
  const setStatus = useUiStore((s) => s.setStatus);
  const [topic, setTopic] = useState("");
  const [gathering, setGathering] = useState(false);

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
      const itemCount =
        Array.isArray(result?.items) ? result.items.length : 0;
      await safeEntityCreate("GatherPack", {
        title: trimmed,
        topic: trimmed,
        item_count: itemCount,
        items: result?.items ?? [],
      });
      await refreshVaultFromRemote();
      setStatus(`Gather pack created: "${trimmed}"`);
      setTopic("");
    } catch (err) {
      setStatus(`Gather failed: ${String(err)}`);
    } finally {
      setGathering(false);
    }
  }, [topic, setStatus]);

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
            const itemCount = typeof pack.item_count === "number"
              ? pack.item_count
              : Array.isArray(pack.items)
                ? pack.items.length
                : 0;
            return (
              <article key={id} className="file-row group" data-entity="GatherPack">
                <div className="file-row-icon">{"\u2727"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{title}</p>
                  <p className="file-row-sub">
                    {packTopic ? `${packTopic} \u2022 ` : ""}
                    {itemCount} item{itemCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
