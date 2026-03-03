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

    // Create the host element that DocsAPI.DocEditor will mount into
    ctx.bodyEl.innerHTML = `<div id="onlyoffice-editor-host" class="onlyoffice-host" style="height:100%;width:100%;min-height:600px;"></div>`;

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
