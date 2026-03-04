import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";
import { t } from "../i18n";

export const officeOnlyofficeAdapter: EditorAdapter = {
  kind: "office",
  canEdit: () => true,
  openPreview(ctx: AdapterRenderContext): void {
    ctx.bodyEl.innerHTML = `
      <div class="preview-placeholder">
        <p>${t("office.previewMsg")}</p>
        <p class="files-scope-label">${t("office.switchToEdit")}</p>
      </div>
    `;
  },
  openEditor(ctx: AdapterRenderContext): void {
    const enabled = ctx.featureFlags.onlyoffice;
    if (!enabled) {
      ctx.bodyEl.innerHTML = `
        <div class="preview-placeholder">
          <p>${t("office.disabled")}</p>
        </div>
      `;
      ctx.setStatus(t("office.notEnabled"));
      return;
    }

    // Create the host element that DocsAPI.DocEditor will mount into
    ctx.bodyEl.innerHTML = `<div id="onlyoffice-editor-host" class="onlyoffice-host" style="height:100%;width:100%;min-height:600px;"></div>`;

    const launch = () => {
      const integrations = (window as unknown as { EasyVaultEditors?: { onlyofficeLaunch?: (fileId: string) => void } }).EasyVaultEditors;
      if (!integrations?.onlyofficeLaunch) {
        ctx.setStatus(t("office.bridgeMissing"));
        return;
      }
      integrations.onlyofficeLaunch(ctx.item.id);
      ctx.setStatus(t("office.launching"));
    };
    launch();
  },
  async save(_ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    return {
      ok: false,
      message: t("office.saveMessage"),
    };
  },
};
