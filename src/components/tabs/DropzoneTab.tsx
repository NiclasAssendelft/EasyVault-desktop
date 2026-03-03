import { useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useQueueStore } from "../../stores/queueStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { IMPORT_MAX_RETRIES } from "../../config";
import { getWatchFolder } from "../../storage";

export default function DropzoneTab() {
  const dropzoneItems = useRemoteDataStore((s) => s.dropzoneItems);
  const queueItems = useQueueStore((s) => s.items);
  const updateQueueItem = useQueueStore((s) => s.updateItem);
  const setStatus = useUiStore((s) => s.setStatus);

  const watchFolder = getWatchFolder();

  const handleScanNow = useCallback(() => {
    setStatus("Scanning watch folder...");
    // Trigger a manual scan by firing a custom event that the watcher can pick up
    window.dispatchEvent(new CustomEvent("easyvault:scan-watch-folder"));
  }, [setStatus]);

  const handleRetryFailed = useCallback(() => {
    const failed = queueItems.filter((i) => i.status === "failed");
    for (const item of failed) {
      updateQueueItem(item.id, { status: "queued", attempts: 0, error: undefined });
    }
    if (failed.length > 0) {
      setStatus(`Retrying ${failed.length} failed item${failed.length !== 1 ? "s" : ""}`);
    } else {
      setStatus("No failed items to retry");
    }
  }, [queueItems, updateQueueItem, setStatus]);

  return (
    <section className="tab-panel">
      <div className="center-panel dropzone-head">
        <div className="hero-icon">&#x2934;</div>
        <h2>Quick Upload</h2>
        <p>Drag files here or click to upload directly to your vault</p>
      </div>

      <div className="dropzone-box">
        <div className="dropzone-title">Drop files here or click to upload</div>
        <div className="dropzone-subtitle">Any file type supported</div>
      </div>

      <div className="dash-card">
        <h4>Recent Uploads</h4>
        <div className="files-items">
          {dropzoneItems.length === 0 ? (
            <p>No recent uploads</p>
          ) : (
            dropzoneItems.map((item) => {
              const id = asString(item.id);
              const title = asString(item.title, "Untitled");
              const createdDate = asString(item.created_date);
              return (
                <article key={id} className="file-row group">
                  <div className="file-row-icon">{"\u2934"}</div>
                  <div className="file-row-body">
                    <p className="file-row-title">{title}</p>
                    <p className="file-row-sub">
                      {createdDate
                        ? new Date(createdDate).toLocaleString()
                        : ""}
                    </p>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="dash-card">
        <h4>Import Queue</h4>
        <p>Watch folder: {watchFolder || "-"}</p>
        <div className="actions-row">
          <button type="button" onClick={handleScanNow}>
            Scan Now
          </button>
          <button type="button" onClick={handleRetryFailed}>
            Retry Failed
          </button>
        </div>
        <div className="queue-list">
          {queueItems.length === 0 ? (
            <p>Queue is empty</p>
          ) : (
            queueItems.map((item) => (
              <article key={item.id} className="queue-item">
                <div>
                  <strong>{item.filename}</strong>
                  <p>{item.sourcePath}</p>
                </div>
                <div>
                  <p>Status: {item.status}</p>
                  <p>
                    Attempts: {item.attempts}/{IMPORT_MAX_RETRIES}
                  </p>
                  <p>Progress: {item.progress}%</p>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
