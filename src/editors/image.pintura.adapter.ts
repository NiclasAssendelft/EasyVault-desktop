import type { AdapterRenderContext, AdapterSaveContext, AdapterSaveResult, EditorAdapter } from "./types";
import { t } from "../i18n";

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const imagePinturaAdapter: EditorAdapter = {
  kind: "image",
  canEdit: () => true,
  openPreview(ctx: AdapterRenderContext): void {
    const src = ctx.getPreviewUrl(ctx.item);
    if (!src) {
      ctx.bodyEl.innerHTML = `<div class="preview-placeholder">${t("image.noPreview")}</div>`;
      return;
    }
    ctx.bodyEl.innerHTML = `<img class="preview-image" src="${src}" alt="${ctx.item.title}" />`;
  },
  openEditor(ctx: AdapterRenderContext): void {
    const src = ctx.getPreviewUrl(ctx.item);
    const rotation = num(ctx.draft.imageRotation, 0);
    const brightness = num(ctx.draft.imageBrightness, 100);
    ctx.bodyEl.innerHTML = `
      <div class="preview-image-editor">
        <div class="preview-image-controls">
          <label>${t("image.rotate")}</label>
          <input id="preview-edit-image-rotate" type="range" min="0" max="270" step="90" value="${rotation}" />
          <label>${t("image.brightness")}</label>
          <input id="preview-edit-image-brightness" type="range" min="50" max="150" step="1" value="${brightness}" />
          <p class="files-scope-label">${t("image.fallbackNote")}</p>
        </div>
        <div class="preview-image-canvas-wrap">
          <img id="preview-edit-image-preview" class="preview-image editable" src="${src}" alt="${ctx.item.title}" />
        </div>
      </div>
    `;

    const rotateInput = ctx.bodyEl.querySelector<HTMLInputElement>("#preview-edit-image-rotate");
    const brightInput = ctx.bodyEl.querySelector<HTMLInputElement>("#preview-edit-image-brightness");
    const img = ctx.bodyEl.querySelector<HTMLImageElement>("#preview-edit-image-preview");
    const updateStyle = () => {
      if (!img) return;
      const rot = num(ctx.draft.imageRotation, 0);
      const bright = num(ctx.draft.imageBrightness, 100);
      img.style.transform = `rotate(${rot}deg)`;
      img.style.filter = `brightness(${bright}%)`;
    };

    if (rotateInput) {
      rotateInput.addEventListener("input", () => {
        ctx.draft.imageRotation = Number(rotateInput.value) || 0;
        updateStyle();
      });
    }
    if (brightInput) {
      brightInput.addEventListener("input", () => {
        ctx.draft.imageBrightness = Number(brightInput.value) || 100;
        updateStyle();
      });
    }
    updateStyle();
  },
  async save(ctx: AdapterSaveContext): Promise<AdapterSaveResult> {
    if (!ctx.item.storedFileUrl) {
      return { ok: false, message: t("image.missingUrl") };
    }
    const uploadToken = ctx.getUploadToken();
    if (!uploadToken) {
      return { ok: false, message: t("image.missingToken") };
    }

    const checkout = await ctx.checkoutFile(ctx.item.id, uploadToken);
    const originalBytes = await ctx.downloadFile(checkout.download_url);
    const blob = new Blob([originalBytes], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);

    const rotation = num(ctx.draft.imageRotation, 0);
    const brightness = num(ctx.draft.imageBrightness, 100);
    const radians = (rotation * Math.PI) / 180;
    const rotated = rotation % 180 !== 0;

    const canvas = document.createElement("canvas");
    const drawing = canvas.getContext("2d");
    if (!drawing) {
      return { ok: false, message: t("image.canvasError") };
    }

    canvas.width = rotated ? bitmap.height : bitmap.width;
    canvas.height = rotated ? bitmap.width : bitmap.height;
    drawing.translate(canvas.width / 2, canvas.height / 2);
    drawing.rotate(radians);
    drawing.filter = `brightness(${brightness}%)`;
    drawing.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

    const outputBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    if (!outputBlob) {
      return { ok: false, message: t("image.exportFailed") };
    }

    const outBytes = new Uint8Array(await outputBlob.arrayBuffer());
    const uploadedUrl = await ctx.uploadFileWithToken(uploadToken, ctx.item.title || `${ctx.item.id}.png`, outBytes);
    const checksum = await ctx.sha256Hex(outBytes);

    await ctx.createNewVersion(
      {
        fileId: ctx.item.id,
        filename: ctx.item.title || `${ctx.item.id}.png`,
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
      checksum
    );

    const versions = await ctx.listVersions(ctx.getAuthToken() || uploadToken, ctx.item.id);
    const latest = versions[0] as Record<string, unknown> | undefined;
    const updatedAtIso = typeof latest?.created_date === "string" ? latest.created_date : new Date().toISOString();

    return { ok: true, message: t("image.saved"), updatedAtIso };
  },
};
