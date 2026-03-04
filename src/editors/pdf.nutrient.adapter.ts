import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";
import { t } from "../i18n";

// Lazy-load PDF.js to keep the main bundle small
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

type PdfPreviewState = {
  currentPage: number;
  totalPages: number;
  zoomLevel: number;
  pdfBytes: Uint8Array | null;
  pdfDoc: ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]> extends { promise: Promise<infer D> } ? D : unknown;
};

function getPreviewState(ctx: AdapterRenderContext): PdfPreviewState {
  if (!ctx.draft._pdf) {
    ctx.draft._pdf = { currentPage: 0, totalPages: 0, zoomLevel: 0, pdfBytes: null, pdfDoc: null } as unknown as PdfPreviewState;
  }
  return ctx.draft._pdf as PdfPreviewState;
}

async function renderPage(canvasWrap: HTMLElement, state: PdfPreviewState): Promise<void> {
  if (!state.pdfBytes) return;
  const pdfjs = await loadPdfJs();
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
  const page = await doc.getPage(pageIndex + 1);
  const containerWidth = canvasWrap.clientWidth - 32;
  const baseViewport = page.getViewport({ scale: 1.0 });
  const fitScale = containerWidth / baseViewport.width;
  const scale = fitScale * (1 + state.zoomLevel * 0.25);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const existing = canvasWrap.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
  if (existing) existing.remove();
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page-canvas";
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) return;
  renderCtx.scale(dpr, dpr);
  canvasWrap.appendChild(canvas);
  await page.render({ canvasContext: renderCtx, viewport, canvas }).promise;
}

export const pdfNutrientAdapter: EditorAdapter = {
  kind: "pdf",
  canEdit: () => true,

  openPreview(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">${t("pdf.noPreviewUrl")}</div>`;
      return;
    }
    const state = getPreviewState(ctx);
    ctx.bodyEl.innerHTML = `
      <div class="pdf-viewer">
        <div class="pdf-toolbar">
          <button type="button" class="ghost pdf-btn" id="pdf-prev" title="${t("pdf.prevPage")}">&#9664;</button>
          <span id="pdf-page-info" class="pdf-page-info">${t("pdf.loading")}</span>
          <button type="button" class="ghost pdf-btn" id="pdf-next" title="${t("pdf.nextPage")}">&#9654;</button>
          <span class="pdf-toolbar-sep">|</span>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-out" title="${t("pdf.zoomOut")}">&minus;</button>
          <span id="pdf-zoom-info" class="pdf-page-info">${t("pdf.fit")}</span>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-in" title="${t("pdf.zoomIn")}">&plus;</button>
          <button type="button" class="ghost pdf-btn pdf-btn-sm" id="pdf-zoom-reset" title="${t("pdf.resetZoom")}">${t("pdf.fitWidth")}</button>
        </div>
        <div class="pdf-canvas-wrap" id="pdf-canvas-wrap"></div>
      </div>
    `;

    const pageInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-page-info")!;
    const zoomInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-zoom-info")!;
    const canvasWrap = ctx.bodyEl.querySelector<HTMLDivElement>("#pdf-canvas-wrap")!;

    function updateInfo() {
      pageInfo.textContent = `${state.currentPage + 1} / ${state.totalPages}`;
      zoomInfo.textContent = state.zoomLevel === 0 ? t("pdf.fit") : `${Math.round((1 + state.zoomLevel * 0.25) * 100)}%`;
    }

    async function renderCurrent() {
      if (!state.pdfBytes) return;
      updateInfo();
      await renderPage(canvasWrap, state);
    }

    (async () => {
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        state.pdfBytes = new Uint8Array(await res.arrayBuffer());
        state.currentPage = 0;
        await renderPage(canvasWrap, state);
        updateInfo();
      } catch (err) {
        pageInfo.textContent = t("pdf.loadFailed", { error: String(err) });
      }
    })();

    ctx.bodyEl.querySelector("#pdf-prev")!.addEventListener("click", () => {
      if (state.currentPage > 0) { state.currentPage--; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-next")!.addEventListener("click", () => {
      if (state.currentPage < state.totalPages - 1) { state.currentPage++; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-zoom-in")!.addEventListener("click", () => {
      state.zoomLevel = Math.min(state.zoomLevel + 1, 8); void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-out")!.addEventListener("click", () => {
      state.zoomLevel = Math.max(state.zoomLevel - 1, -2); void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-reset")!.addEventListener("click", () => {
      state.zoomLevel = 0; void renderCurrent();
    });
  },

  openEditor(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">${t("pdf.noFileUrl")}</div>`;
      return;
    }

    ctx.bodyEl.innerHTML = `
      <div class="pdf-native-editor">
        <div class="pdf-native-status">
          <p class="pdf-native-title">${t("pdf.editTitle")}</p>
          <p class="pdf-native-desc">${t("pdf.editDesc")}</p>
          <button type="button" id="pdf-launch-native" class="pdf-launch-btn">${t("pdf.openButton")}</button>
          <p id="pdf-native-info" class="pdf-native-info"></p>
        </div>
      </div>
    `;

    const launchBtn = ctx.bodyEl.querySelector<HTMLButtonElement>("#pdf-launch-native")!;
    const infoEl = ctx.bodyEl.querySelector<HTMLParagraphElement>("#pdf-native-info")!;

    launchBtn.addEventListener("click", () => {
      launchBtn.disabled = true;
      infoEl.textContent = t("pdf.checkingOut");

      (async () => {
        try {
          const { tryCheckout, startAutoSync } = await import("./pdf.native.bridge");

          infoEl.textContent = t("pdf.checkingOut");
          const checkout = await tryCheckout(ctx.item.id);

          infoEl.textContent = t("pdf.downloading");
          const downloadUrl = checkout?.download_url || ctx.getPreviewUrl(ctx.item);
          if (!downloadUrl) throw new Error("No file URL available");

          infoEl.textContent = t("pdf.savingWorkspace");
          const savedPath = await invoke<string>("download_and_save_to_workspace", {
            url: downloadUrl, fileId: ctx.item.id, filename: ctx.item.title,
          });

          infoEl.textContent = t("pdf.openingEditor");
          await openPath(savedPath);

          if (checkout) {
            await startAutoSync({
              fileId: ctx.item.id, filename: ctx.item.title, localPath: savedPath,
              editSessionId: checkout.edit_session_id,
            }, ctx.setStatus);
            infoEl.textContent = t("pdf.editing", { title: ctx.item.title });
            ctx.setStatus(t("pdf.autoSyncActive"));
          } else {
            infoEl.textContent = t("pdf.readOnly", { title: ctx.item.title });
            ctx.setStatus(t("pdf.readOnlyMode"));
            launchBtn.disabled = false;
          }
        } catch (err) {
          infoEl.textContent = t("pdf.failedGeneric", { error: String(err) });
          ctx.setStatus(t("pdf.openFailed", { error: String(err) }));
          launchBtn.disabled = false;
        }
      })();
    });
  },

  async save(_ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    return {
      ok: false,
      message: t("pdf.autoSyncMessage"),
    };
  },
};
