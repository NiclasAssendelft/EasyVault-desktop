import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";

// Lazy-load PDF.js to keep the main bundle small
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

// ---------------------------------------------------------------------------
// Preview state
// ---------------------------------------------------------------------------

type PdfPreviewState = {
  currentPage: number;
  totalPages: number;
  zoomLevel: number; // 0 = fit-width, positive = zoom steps above fit
  pdfBytes: Uint8Array | null;
  pdfDoc: ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]> extends { promise: Promise<infer D> } ? D : unknown;
};

function getPreviewState(ctx: AdapterRenderContext): PdfPreviewState {
  if (!ctx.draft._pdf) {
    ctx.draft._pdf = { currentPage: 0, totalPages: 0, zoomLevel: 0, pdfBytes: null, pdfDoc: null } as unknown as PdfPreviewState;
  }
  return ctx.draft._pdf as PdfPreviewState;
}

// ---------------------------------------------------------------------------
// Shared rendering helper
// ---------------------------------------------------------------------------

async function renderPage(
  canvasWrap: HTMLElement,
  state: PdfPreviewState,
): Promise<void> {
  if (!state.pdfBytes) return;
  const pdfjs = await loadPdfJs();

  // Reuse cached document or load fresh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc = state.pdfDoc as any;
  if (!doc) {
    const loadingTask = pdfjs.getDocument({ data: state.pdfBytes.slice() });
    doc = await loadingTask.promise;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state as any).pdfDoc = doc;
    state.totalPages = doc.numPages;
  }

  const pageIndex = state.currentPage;
  if (pageIndex < 0 || pageIndex >= state.totalPages) return;

  const page = await doc.getPage(pageIndex + 1); // PDF.js is 1-indexed

  // Calculate scale: fit page width to container, then apply zoom
  const containerWidth = canvasWrap.clientWidth - 32; // subtract padding
  const baseViewport = page.getViewport({ scale: 1.0 });
  const fitScale = containerWidth / baseViewport.width;
  const scale = fitScale * (1 + state.zoomLevel * 0.25);

  const viewport = page.getViewport({ scale });

  // HiDPI: render at device pixel ratio for crisp text
  const dpr = window.devicePixelRatio || 1;

  const existing = canvasWrap.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
  if (existing) existing.remove();

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page-canvas";
  // Set the actual pixel dimensions (high-res)
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  // Set the CSS display dimensions
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) return;

  // Scale the context to match device pixel ratio
  renderCtx.scale(dpr, dpr);

  canvasWrap.appendChild(canvas);

  await page.render({ canvasContext: renderCtx, viewport, canvas }).promise;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const pdfNutrientAdapter: EditorAdapter = {
  kind: "pdf",
  canEdit: () => true,

  // --- Preview mode: in-app PDF.js viewer ---
  openPreview(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">No PDF preview URL available</div>`;
      return;
    }

    const state = getPreviewState(ctx);

    ctx.bodyEl.innerHTML = `
      <div class="pdf-viewer">
        <div class="pdf-toolbar">
          <button type="button" class="ghost pdf-btn" id="pdf-prev" title="Previous page">&#9664;</button>
          <span id="pdf-page-info" class="pdf-page-info">Loading...</span>
          <button type="button" class="ghost pdf-btn" id="pdf-next" title="Next page">&#9654;</button>
          <span class="pdf-toolbar-sep">|</span>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-out" title="Zoom out">&minus;</button>
          <span id="pdf-zoom-info" class="pdf-page-info">Fit</span>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-in" title="Zoom in">&plus;</button>
          <button type="button" class="ghost pdf-btn pdf-btn-sm" id="pdf-zoom-reset" title="Reset zoom">Fit width</button>
        </div>
        <div class="pdf-canvas-wrap" id="pdf-canvas-wrap"></div>
      </div>
    `;

    const pageInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-page-info")!;
    const zoomInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-zoom-info")!;
    const canvasWrap = ctx.bodyEl.querySelector<HTMLDivElement>("#pdf-canvas-wrap")!;

    function updateInfo() {
      pageInfo.textContent = `${state.currentPage + 1} / ${state.totalPages}`;
      zoomInfo.textContent = state.zoomLevel === 0 ? "Fit" : `${Math.round((1 + state.zoomLevel * 0.25) * 100)}%`;
    }

    async function renderCurrent() {
      if (!state.pdfBytes) return;
      updateInfo();
      await renderPage(canvasWrap, state);
    }

    // Load PDF bytes
    (async () => {
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        state.pdfBytes = new Uint8Array(await res.arrayBuffer());
        state.currentPage = 0;
        await renderPage(canvasWrap, state);
        updateInfo();
      } catch (err) {
        pageInfo.textContent = `Load failed: ${String(err)}`;
      }
    })();

    ctx.bodyEl.querySelector("#pdf-prev")!.addEventListener("click", () => {
      if (state.currentPage > 0) { state.currentPage--; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-next")!.addEventListener("click", () => {
      if (state.currentPage < state.totalPages - 1) { state.currentPage++; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-zoom-in")!.addEventListener("click", () => {
      state.zoomLevel = Math.min(state.zoomLevel + 1, 8);
      void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-out")!.addEventListener("click", () => {
      state.zoomLevel = Math.max(state.zoomLevel - 1, -2);
      void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-reset")!.addEventListener("click", () => {
      state.zoomLevel = 0;
      void renderCurrent();
    });
  },

  // --- Edit mode: checkout → open in native PDF editor → auto-sync ---
  openEditor(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">No PDF file URL available</div>`;
      return;
    }

    ctx.bodyEl.innerHTML = `
      <div class="pdf-native-editor">
        <div class="pdf-native-status">
          <p class="pdf-native-title">Edit with your PDF editor</p>
          <p class="pdf-native-desc">
            The PDF will be downloaded to your workspace and opened in your
            default PDF editor (Adobe Acrobat, Preview, etc.). Changes are
            automatically synced back to EasyVault when you save in the editor.
          </p>
          <button type="button" id="pdf-launch-native" class="pdf-launch-btn">Open in PDF Editor</button>
          <p id="pdf-native-info" class="pdf-native-info"></p>
        </div>
      </div>
    `;

    const launchBtn = ctx.bodyEl.querySelector<HTMLButtonElement>("#pdf-launch-native")!;
    const infoEl = ctx.bodyEl.querySelector<HTMLParagraphElement>("#pdf-native-info")!;

    launchBtn.addEventListener("click", () => {
      launchBtn.disabled = true;
      infoEl.textContent = "Checking out file...";

      (async () => {
        try {
          const { tryCheckout, downloadFile, startAutoSync } = await import("./pdf.native.bridge");

          // 1. Try checkout (acquire lock + get edit session)
          infoEl.textContent = "Checking out file...";
          const checkout = await tryCheckout(ctx.item.id);

          // 2. Download the file — use checkout URL if available, otherwise the stored URL
          infoEl.textContent = "Downloading...";
          const downloadUrl = checkout?.download_url || ctx.getPreviewUrl(ctx.item);
          if (!downloadUrl) throw new Error("No file URL available");
          const bytes = await downloadFile(downloadUrl);

          // 3. Save to workspace
          infoEl.textContent = "Saving to workspace...";
          const savedPath = await invoke<string>("save_file_to_workspace", {
            fileId: ctx.item.id,
            filename: ctx.item.title,
            bytes: Array.from(bytes),
          });

          // 4. Open in native editor
          infoEl.textContent = "Opening in your PDF editor...";
          await openPath(savedPath);

          // 5. Start auto-sync if checkout succeeded (we have an edit session)
          if (checkout) {
            await startAutoSync({
              fileId: ctx.item.id,
              filename: ctx.item.title,
              localPath: savedPath,
              editSessionId: checkout.edit_session_id,
            }, ctx.setStatus);

            infoEl.textContent = `Editing: ${ctx.item.title} — changes auto-sync when you save in your editor`;
            ctx.setStatus("PDF opened in native editor — auto-sync active");
          } else {
            // Checkout failed (e.g. 403 for service-owned files) — open read-only
            infoEl.textContent = `Opened: ${ctx.item.title} — read-only (file lock unavailable)`;
            ctx.setStatus("PDF opened in native editor — read-only mode (checkout unavailable)");
            launchBtn.disabled = false;
          }
        } catch (err) {
          infoEl.textContent = `Failed: ${String(err)}`;
          ctx.setStatus(`Open failed: ${String(err)}`);
          launchBtn.disabled = false;
        }
      })();
    });
  },

  // Save is handled by the syncEngine auto-watcher, not the adapter
  async save(_ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    return {
      ok: false,
      message: "Changes are auto-synced from your native PDF editor. Save in your editor to sync.",
    };
  },
};
