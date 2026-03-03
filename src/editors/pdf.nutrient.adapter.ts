import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";

// Lazy-load PDF libraries to keep the main bundle small
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

async function loadPdfLib() {
  return import("pdf-lib");
}

// ---------------------------------------------------------------------------
// Types for draft operations
// ---------------------------------------------------------------------------

type PdfOp =
  | { type: "rotate"; pageIndex: number; angleDeg: number }
  | { type: "delete"; pageIndex: number }
  | { type: "text"; pageIndex: number; x: number; y: number; text: string };

type PdfDraft = {
  ops: PdfOp[];
  currentPage: number;
  totalPages: number;
  scale: number;
  pdfBytes: Uint8Array | null;
};

function getDraft(ctx: AdapterRenderContext | AdapterSaveContext): PdfDraft {
  if (!ctx.draft._pdf) {
    ctx.draft._pdf = { ops: [], currentPage: 0, totalPages: 0, scale: 1.2, pdfBytes: null } as PdfDraft;
  }
  return ctx.draft._pdf as PdfDraft;
}

// ---------------------------------------------------------------------------
// Shared rendering helper
// ---------------------------------------------------------------------------

async function loadAndRenderPage(
  container: HTMLElement,
  pdfBytes: Uint8Array,
  pageIndex: number,
  scale: number,
): Promise<{ totalPages: number }> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() });
  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;

  if (pageIndex < 0 || pageIndex >= totalPages) return { totalPages };

  const page = await doc.getPage(pageIndex + 1); // PDF.js is 1-indexed
  const viewport = page.getViewport({ scale });

  // Clear previous render
  const existing = container.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
  if (existing) existing.remove();

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page-canvas";
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) return { totalPages };

  const renderTarget = container.querySelector(".pdf-canvas-wrap") || container;
  renderTarget.appendChild(canvas);

  // PDF.js v5 requires the canvas element in RenderParameters
  await page.render({ canvasContext: renderCtx, viewport, canvas }).promise;
  doc.destroy();

  return { totalPages };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const pdfNutrientAdapter: EditorAdapter = {
  kind: "pdf",
  canEdit: () => true,

  // --- Preview mode: read-only page viewer ---
  openPreview(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">No PDF preview URL available</div>`;
      return;
    }

    const draft = getDraft(ctx);

    ctx.bodyEl.innerHTML = `
      <div class="pdf-viewer">
        <div class="pdf-toolbar">
          <button type="button" class="ghost pdf-btn" id="pdf-prev">&#9664; Prev</button>
          <span id="pdf-page-info" class="pdf-page-info">Loading...</span>
          <button type="button" class="ghost pdf-btn" id="pdf-next">Next &#9654;</button>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-out">&minus;</button>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-in">&plus;</button>
        </div>
        <div class="pdf-canvas-wrap"></div>
      </div>
    `;

    const pageInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-page-info")!;
    const canvasWrap = ctx.bodyEl.querySelector<HTMLDivElement>(".pdf-canvas-wrap")!;

    async function renderCurrent() {
      if (!draft.pdfBytes) return;
      pageInfo.textContent = `Page ${draft.currentPage + 1} / ${draft.totalPages}`;
      await loadAndRenderPage(canvasWrap, draft.pdfBytes, draft.currentPage, draft.scale);
    }

    // Load PDF bytes
    (async () => {
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        draft.pdfBytes = new Uint8Array(await res.arrayBuffer());
        const { totalPages } = await loadAndRenderPage(canvasWrap, draft.pdfBytes, 0, draft.scale);
        draft.totalPages = totalPages;
        draft.currentPage = 0;
        pageInfo.textContent = `Page 1 / ${totalPages}`;
      } catch (err) {
        pageInfo.textContent = `Load failed: ${String(err)}`;
      }
    })();

    ctx.bodyEl.querySelector("#pdf-prev")!.addEventListener("click", () => {
      if (draft.currentPage > 0) { draft.currentPage--; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-next")!.addEventListener("click", () => {
      if (draft.currentPage < draft.totalPages - 1) { draft.currentPage++; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-zoom-in")!.addEventListener("click", () => {
      draft.scale = Math.min(draft.scale + 0.2, 3.0);
      void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-out")!.addEventListener("click", () => {
      draft.scale = Math.max(draft.scale - 0.2, 0.4);
      void renderCurrent();
    });
  },

  // --- Edit mode: viewer + editing controls ---
  openEditor(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">No PDF file URL available</div>`;
      return;
    }

    const draft = getDraft(ctx);

    ctx.bodyEl.innerHTML = `
      <div class="pdf-viewer pdf-editor">
        <div class="pdf-toolbar">
          <button type="button" class="ghost pdf-btn" id="pdf-prev">&#9664;</button>
          <span id="pdf-page-info" class="pdf-page-info">Loading...</span>
          <button type="button" class="ghost pdf-btn" id="pdf-next">&#9654;</button>
          <span class="pdf-toolbar-sep">|</span>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-out">&minus;</button>
          <button type="button" class="ghost pdf-btn" id="pdf-zoom-in">&plus;</button>
          <span class="pdf-toolbar-sep">|</span>
          <button type="button" class="ghost pdf-btn" id="pdf-rotate">Rotate Page</button>
          <button type="button" class="ghost pdf-btn pdf-btn-danger" id="pdf-delete">Delete Page</button>
          <button type="button" class="ghost pdf-btn" id="pdf-add-text">Add Text</button>
        </div>
        <div class="pdf-edit-text-bar" id="pdf-text-bar" style="display:none;">
          <input type="text" id="pdf-text-input" placeholder="Type annotation text..." class="pdf-text-input" />
          <span class="pdf-text-hint">Click on the page to place text, then press Add.</span>
          <button type="button" class="ghost pdf-btn" id="pdf-text-confirm">Add</button>
          <button type="button" class="ghost pdf-btn" id="pdf-text-cancel">Cancel</button>
        </div>
        <div class="pdf-ops-summary" id="pdf-ops-summary"></div>
        <div class="pdf-canvas-wrap" id="pdf-canvas-wrap"></div>
      </div>
    `;

    const pageInfo = ctx.bodyEl.querySelector<HTMLSpanElement>("#pdf-page-info")!;
    const canvasWrap = ctx.bodyEl.querySelector<HTMLDivElement>("#pdf-canvas-wrap")!;
    const textBar = ctx.bodyEl.querySelector<HTMLDivElement>("#pdf-text-bar")!;
    const textInput = ctx.bodyEl.querySelector<HTMLInputElement>("#pdf-text-input")!;
    const opsSummary = ctx.bodyEl.querySelector<HTMLDivElement>("#pdf-ops-summary")!;

    let textPlaceMode = false;
    let pendingTextX = 50;
    let pendingTextY = 50;

    function updateOpsSummary() {
      if (draft.ops.length === 0) {
        opsSummary.textContent = "";
        return;
      }
      const descriptions = draft.ops.map((op, i) => {
        if (op.type === "rotate") return `${i + 1}. Rotate page ${op.pageIndex + 1} by ${op.angleDeg}°`;
        if (op.type === "delete") return `${i + 1}. Delete page ${op.pageIndex + 1}`;
        if (op.type === "text") return `${i + 1}. Add text on page ${op.pageIndex + 1}`;
        return "";
      });
      opsSummary.innerHTML = `
        <span class="pdf-ops-label">Pending edits (${draft.ops.length}):</span>
        ${descriptions.join(" &middot; ")}
        <button type="button" class="ghost pdf-btn pdf-btn-sm" id="pdf-undo">Undo last</button>
      `;
      const undoBtn = opsSummary.querySelector<HTMLButtonElement>("#pdf-undo");
      if (undoBtn) {
        undoBtn.addEventListener("click", () => {
          draft.ops.pop();
          updateOpsSummary();
          ctx.setStatus(`Undo — ${draft.ops.length} edits pending`);
        });
      }
    }

    async function renderCurrent() {
      if (!draft.pdfBytes) return;
      pageInfo.textContent = `Page ${draft.currentPage + 1} / ${draft.totalPages}`;
      await loadAndRenderPage(canvasWrap, draft.pdfBytes, draft.currentPage, draft.scale);
    }

    // Load PDF
    (async () => {
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        draft.pdfBytes = new Uint8Array(await res.arrayBuffer());
        const { totalPages } = await loadAndRenderPage(canvasWrap, draft.pdfBytes, 0, draft.scale);
        draft.totalPages = totalPages;
        draft.currentPage = 0;
        pageInfo.textContent = `Page 1 / ${totalPages}`;
        updateOpsSummary();
      } catch (err) {
        pageInfo.textContent = `Load failed: ${String(err)}`;
      }
    })();

    // Navigation
    ctx.bodyEl.querySelector("#pdf-prev")!.addEventListener("click", () => {
      if (draft.currentPage > 0) { draft.currentPage--; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-next")!.addEventListener("click", () => {
      if (draft.currentPage < draft.totalPages - 1) { draft.currentPage++; void renderCurrent(); }
    });
    ctx.bodyEl.querySelector("#pdf-zoom-in")!.addEventListener("click", () => {
      draft.scale = Math.min(draft.scale + 0.2, 3.0); void renderCurrent();
    });
    ctx.bodyEl.querySelector("#pdf-zoom-out")!.addEventListener("click", () => {
      draft.scale = Math.max(draft.scale - 0.2, 0.4); void renderCurrent();
    });

    // Rotate current page
    ctx.bodyEl.querySelector("#pdf-rotate")!.addEventListener("click", () => {
      if (draft.totalPages === 0) return;
      draft.ops.push({ type: "rotate", pageIndex: draft.currentPage, angleDeg: 90 });
      updateOpsSummary();
      ctx.setStatus(`Rotate page ${draft.currentPage + 1} queued`);
    });

    // Delete current page
    ctx.bodyEl.querySelector("#pdf-delete")!.addEventListener("click", () => {
      if (draft.totalPages <= 1) {
        ctx.setStatus("Cannot delete the only page");
        return;
      }
      draft.ops.push({ type: "delete", pageIndex: draft.currentPage });
      updateOpsSummary();
      ctx.setStatus(`Delete page ${draft.currentPage + 1} queued`);
    });

    // Add text annotation
    ctx.bodyEl.querySelector("#pdf-add-text")!.addEventListener("click", () => {
      textPlaceMode = true;
      textBar.style.display = "flex";
      textInput.focus();
      ctx.setStatus("Click on the page to set position, then type text and click Add");
    });

    // Click on canvas to set text position
    canvasWrap.addEventListener("click", (e) => {
      if (!textPlaceMode) return;
      const canvas = canvasWrap.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Convert click position to PDF coordinates (relative to canvas, scaled back)
      pendingTextX = (e.clientX - rect.left) / draft.scale;
      pendingTextY = (e.clientY - rect.top) / draft.scale;
      ctx.setStatus(`Text position set at (${Math.round(pendingTextX)}, ${Math.round(pendingTextY)})`);
    });

    // Confirm text
    ctx.bodyEl.querySelector("#pdf-text-confirm")!.addEventListener("click", () => {
      const text = textInput.value.trim();
      if (!text) {
        ctx.setStatus("Enter text first");
        return;
      }
      draft.ops.push({
        type: "text",
        pageIndex: draft.currentPage,
        x: pendingTextX,
        y: pendingTextY,
        text,
      });
      textInput.value = "";
      textPlaceMode = false;
      textBar.style.display = "none";
      updateOpsSummary();
      ctx.setStatus(`Text annotation added on page ${draft.currentPage + 1}`);
    });

    // Cancel text
    ctx.bodyEl.querySelector("#pdf-text-cancel")!.addEventListener("click", () => {
      textInput.value = "";
      textPlaceMode = false;
      textBar.style.display = "none";
      ctx.setStatus("");
    });
  },

  // --- Save: apply operations with pdf-lib ---
  async save(ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    const draft = getDraft(ctx);
    if (draft.ops.length === 0) {
      return { ok: false, message: "No edits to save" };
    }

    if (!ctx.item.storedFileUrl) {
      return { ok: false, message: "Missing PDF file URL" };
    }

    const uploadToken = ctx.getUploadToken();
    if (!uploadToken) {
      return { ok: false, message: "Missing upload token" };
    }

    ctx.setStatus("Checking out file...");
    const checkout = await ctx.checkoutFile(ctx.item.id, uploadToken);

    ctx.setStatus("Downloading PDF...");
    const originalBytes = await ctx.downloadFile(checkout.download_url);

    ctx.setStatus("Applying edits...");
    const { PDFDocument, degrees, rgb, StandardFonts } = await loadPdfLib();
    const pdfDoc = await PDFDocument.load(originalBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Track page index shifts from deletions
    // Process ops in order, adjusting indices as pages are removed
    const deleteIndices: number[] = [];

    for (const op of draft.ops) {
      if (op.type === "rotate") {
        // Adjust index for previous deletions
        let adjustedIndex = op.pageIndex;
        for (const di of deleteIndices) { if (di <= adjustedIndex) adjustedIndex++; }
        const pages = pdfDoc.getPages();
        if (adjustedIndex >= 0 && adjustedIndex < pages.length) {
          const page = pages[adjustedIndex];
          const current = page.getRotation().angle;
          page.setRotation(degrees(current + op.angleDeg));
        }
      } else if (op.type === "delete") {
        let adjustedIndex = op.pageIndex;
        for (const di of deleteIndices) { if (di <= adjustedIndex) adjustedIndex++; }
        const pages = pdfDoc.getPages();
        if (adjustedIndex >= 0 && adjustedIndex < pages.length && pages.length > 1) {
          pdfDoc.removePage(adjustedIndex);
          deleteIndices.push(op.pageIndex);
          deleteIndices.sort((a, b) => a - b);
        }
      } else if (op.type === "text") {
        let adjustedIndex = op.pageIndex;
        for (const di of deleteIndices) { if (di <= adjustedIndex) adjustedIndex++; }
        const pages = pdfDoc.getPages();
        if (adjustedIndex >= 0 && adjustedIndex < pages.length) {
          const page = pages[adjustedIndex];
          const { height } = page.getSize();
          // PDF coordinate system has origin at bottom-left; screen coordinates have origin at top-left
          page.drawText(op.text, {
            x: op.x,
            y: height - op.y,
            size: 14,
            font,
            color: rgb(0, 0, 0),
          });
        }
      }
    }

    ctx.setStatus("Saving PDF...");
    const modifiedBytes = await pdfDoc.save();
    const outBytes = new Uint8Array(modifiedBytes);

    ctx.setStatus("Uploading...");
    const filename = ctx.item.title || `${ctx.item.id}.pdf`;
    const uploadedUrl = await ctx.uploadFileWithToken(uploadToken, filename, outBytes);
    const checksum = await ctx.sha256Hex(outBytes);

    ctx.setStatus("Creating version...");
    await ctx.createNewVersion(
      {
        fileId: ctx.item.id,
        filename,
        localPath: "",
        editSessionId: checkout.edit_session_id,
        authToken: ctx.getAuthToken() || uploadToken,
        extensionToken: uploadToken,
        lastModifiedMs: Date.now(),
        lastSize: outBytes.length,
        intervalId: null,
        debounceId: null,
        uploading: false,
        queued: false,
      },
      uploadedUrl,
      checksum,
    );

    const versions = await ctx.listVersions(ctx.getAuthToken() || uploadToken, ctx.item.id);
    const latest = versions[0] as Record<string, unknown> | undefined;
    const updatedAtIso = typeof latest?.created_date === "string" ? latest.created_date : new Date().toISOString();

    // Clear ops after successful save
    draft.ops = [];

    return { ok: true, message: `PDF saved with ${draft.ops.length} edits applied`, updatedAtIso };
  },
};
