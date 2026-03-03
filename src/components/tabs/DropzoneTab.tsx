import { useCallback, useRef, useState } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useQueueStore } from "../../stores/queueStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { IMPORT_MAX_RETRIES } from "../../config";
import { getWatchFolder } from "../../storage";
import { uploadSelectedFilesToFolder } from "../../services/fileOps";

export default function DropzoneTab() {
  const dropzoneItems = useRemoteDataStore((s) => s.dropzoneItems);
  const queueItems = useQueueStore((s) => s.items);
  const updateQueueItem = useQueueStore((s) => s.updateItem);
  const setStatus = useUiStore((s) => s.setStatus);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const watchFolder = getWatchFolder();

  const handleScanNow = useCallback(() => {
    setStatus("Scanning watch folder...");
    window.dispatchEvent(new CustomEvent("easyvault:scan-watch-folder"));
  }, [setStatus]);

  const handleRetryFailed = useCallback(() => {
    const failed = queueItems.filter((i) => i.status === "failed");
    for (const item of failed) {
      updateQueueItem(item.id, { status: "queued", attempts: 0, error: undefined });
    }
    if (failed.length > 0) {
      setStatus(`Retrying ${failed.length} failed item${failed.length !== 1 ? "s" : ""}`);
      window.dispatchEvent(new CustomEvent("easyvault:scan-watch-folder"));
    } else {
      setStatus("No failed items to retry");
    }
  }, [queueItems, updateQueueItem, setStatus]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      // Upload to vault root (no specific folder)
      await uploadSelectedFilesToFolder("", files);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    void uploadFiles(files);
  }, [uploadFiles]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) void uploadFiles(files);
    e.target.value = "";
  }, [uploadFiles]);

  return (
    <section className="tab-panel">
      <div className="center-panel dropzone-head">
        <div className="hero-icon">&#x2934;</div>
        <h2>Quick Upload</h2>
        <p>Drag files here or click to upload directly to your vault</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <div
        className={`dropzone-box${isDragOver ? " dropzone-box--active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      >
        <div className="dropzone-title">
          {isUploading ? "Uploading..." : "Drop files here or click to upload"}
        </div>
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
                      {createdDate ? new Date(createdDate).toLocaleString() : ""}
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
                  <p>Attempts: {item.attempts}/{IMPORT_MAX_RETRIES}</p>
                  <p>Progress: {item.progress}%</p>
                  {item.error && <p className="files-scope-label">{item.error}</p>}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
