import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { uploadFileWithToken, downloadFile } from "../api";
import { getPreferredUploadToken } from "../storage";
import { useFilesStore } from "../stores/filesStore";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useSyncStore } from "../stores/syncStore";
import { safeEntityCreate, canUseRemoteData } from "./entityService";
import { refreshAccessScope, syncRemoteDelta, refreshFilesFromRemote } from "./deltaSyncService";
import { normalizeItem, extOf, asString, asArray, asBool, type FileItemType, type DesktopItem } from "./helpers";

export async function uploadSelectedFilesToFolder(targetFolderId: string): Promise<void> {
  // Check auth
  if (!canUseRemoteData()) { useUiStore.getState().setStatus("login required"); return; }
  const uploadToken = getPreferredUploadToken();
  if (!uploadToken) { useUiStore.getState().setStatus("missing upload token"); return; }

  // Open file picker
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.style.display = "none";
  document.body.appendChild(picker);
  const files = await new Promise<File[]>((resolve) => {
    picker.addEventListener("change", () => resolve(picker.files ? Array.from(picker.files) : []), { once: true });
    picker.click();
  });
  picker.remove();
  if (files.length === 0) { useUiStore.getState().setStatus("upload canceled"); return; }

  // Get space id
  const { personalSpaceId, accessibleSpaceIds } = useAuthStore.getState();
  if (!personalSpaceId && accessibleSpaceIds.length === 0) await refreshAccessScope();
  const targetSpaceId = useAuthStore.getState().personalSpaceId || useAuthStore.getState().accessibleSpaceIds[0] || "";

  const setStatus = useUiStore.getState().setStatus;
  const filesStore = useFilesStore.getState();
  let uploaded = 0;

  for (const file of files) {
    const tempId = `temp-upload-${crypto.randomUUID()}`;
    const tempItem = normalizeItem({
      id: tempId,
      title: file.name,
      itemType: "uploaded_file",
      folderId: targetFolderId,
      createdAtIso: new Date().toISOString(),
      isUploading: true,
      fileExtension: extOf(file.name),
    });
    filesStore.addItem(tempItem);

    try {
      setStatus(`uploading ${file.name}...`);
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const fileUrl = await uploadFileWithToken(uploadToken, file.name, bytes);
      const ext = extOf(file.name);
      const created = await safeEntityCreate<Record<string, unknown>>("VaultItem", {
        title: file.name,
        item_type: "uploaded_file",
        folder_id: targetFolderId,
        space_id: targetSpaceId,
        source: "local_upload",
        stored_file_url: fileUrl,
        file_extension: ext,
        file_size: file.size,
      });
      const createdId = asString(created.id);
      if (createdId) {
        const nextItem = normalizeItem({
          id: createdId,
          title: asString(created.title, file.name),
          itemType: asString(created.item_type, "uploaded_file") as FileItemType,
          folderId: asString(created.folder_id, targetFolderId),
          createdAtIso: asString(created.created_date, new Date().toISOString()),
          updatedAtIso: asString(created.updated_date, asString(created.created_date, new Date().toISOString())),
          notes: asString(created.notes),
          tags: asArray(created.tags),
          isPinned: asBool(created.is_pinned),
          isFavorite: asBool(created.is_favorite),
          storedFileUrl: asString(created.stored_file_url, fileUrl),
          fileExtension: asString(created.file_extension, ext),
        });
        useFilesStore.getState().removeItem(tempId);
        useFilesStore.getState().addItem(nextItem);
        useSyncStore.getState().setEntityUpdatedAt("VaultItem", createdId, nextItem.updatedAtIso || nextItem.createdAtIso);
        useFilesStore.getState().persist();
      }
      uploaded += 1;
    } catch (err) {
      useFilesStore.getState().removeItem(tempId);
      setStatus(`upload failed for ${file.name}: ${String(err)}`);
    }
  }

  if (uploaded > 0) {
    void syncRemoteDelta();
    void refreshFilesFromRemote();
    const store = useFilesStore.getState();
    if (store.activeFolderId !== targetFolderId) store.setActiveFolderId(targetFolderId);
    setStatus(`uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`);
  }
}

export async function openNativeForItem(item: DesktopItem): Promise<void> {
  if (item.localPath) {
    await openPath(item.localPath);
    return;
  }
  if (!item.storedFileUrl) throw new Error("No stored file URL available");
  const bytes = await downloadFile(item.storedFileUrl);
  const savedPath = await invoke<string>("save_file_to_workspace", {
    fileId: item.id,
    filename: item.title || `${item.id}.${item.fileExtension || "bin"}`,
    bytes: Array.from(bytes),
  });
  await openPath(savedPath);
}
