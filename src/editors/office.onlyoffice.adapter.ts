import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";

export const officeOnlyofficeAdapter: EditorAdapter = {
  kind: "office",
  canEdit: () => true,
  openPreview(ctx: AdapterRenderContext): void {
    ctx.bodyEl.innerHTML = `
      <div class="preview-placeholder">
        <p>Office files open in the in-app ONLYOFFICE editor.</p>
        <p class="files-scope-label">Switch to Edit to launch editor.</p>
      </div>
    `;
  },
  openEditor(ctx: AdapterRenderContext): void {
    const enabled = ctx.featureFlags.onlyoffice;
    if (!enabled) {
      ctx.bodyEl.innerHTML = `
        <div class="preview-placeholder">
          <p>ONLYOFFICE is disabled for this build.</p>
        </div>
      `;
      ctx.setStatus("ONLYOFFICE integration not enabled");
      return;
    }

    ctx.bodyEl.innerHTML = `
      <div class="preview-placeholder">
        <p>Opening ONLYOFFICE...</p>
      </div>
    `;

    const launch = () => {
      const integrations = (window as unknown as { EasyVaultEditors?: { onlyofficeLaunch?: (fileId: string) => void } }).EasyVaultEditors;
      if (!integrations?.onlyofficeLaunch) {
        ctx.setStatus("ONLYOFFICE launch bridge missing");
        return;
      }
      integrations.onlyofficeLaunch(ctx.item.id);
      ctx.setStatus("Launching ONLYOFFICE...");
    };
    launch();
  },
  async save(_ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    return {
      ok: false,
      message: "Use in-editor save in ONLYOFFICE",
    };
  },
};
