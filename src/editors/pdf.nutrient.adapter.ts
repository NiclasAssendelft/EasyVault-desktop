import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";

export const pdfNutrientAdapter: EditorAdapter = {
  kind: "pdf",
  canEdit: () => true,
  openPreview(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    if (!source) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">No PDF preview URL available</div>`;
      return;
    }
    ctx.bodyEl.innerHTML = `<iframe class="preview-frame" src="${source}" title="PDF Preview"></iframe>`;
  },
  openEditor(ctx: AdapterRenderContext): void {
    const source = ctx.getPreviewUrl(ctx.item);
    const editorBtnState = ctx.featureFlags.nutrient ? "" : "disabled";
    ctx.bodyEl.innerHTML = `
      <div class="preview-placeholder">
        <p>Nutrient PDF editor integration path is wired.</p>
        <button id="launch-nutrient-btn" type="button" class="ghost" ${editorBtnState}>Edit PDF (Nutrient)</button>
        ${source ? `<p class="files-scope-label">Preview is available in read-only mode.</p>` : ""}
      </div>
    `;

    const nutrientBtn = ctx.bodyEl.querySelector<HTMLButtonElement>("#launch-nutrient-btn");
    if (!nutrientBtn) return;
    nutrientBtn.addEventListener("click", () => {
      if (!ctx.featureFlags.nutrient) {
        ctx.setStatus("Nutrient editor not configured yet");
        return;
      }
      const integrations = (window as unknown as { EasyVaultEditors?: { nutrientLaunch?: (fileId: string) => void } }).EasyVaultEditors;
      if (integrations?.nutrientLaunch) {
        integrations.nutrientLaunch(ctx.item.id);
        ctx.setStatus("Launching Nutrient editor...");
      } else {
        ctx.setStatus("Nutrient launch bridge missing");
      }
    });
  },
  async save(_ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    return {
      ok: false,
      message: "PDF save is routed to Nutrient integration path",
    };
  },
};
