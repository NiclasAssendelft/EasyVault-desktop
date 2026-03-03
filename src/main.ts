import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  callDeltaSync,
  callDesktopSave,
  callFileLock,
  checkoutFile,
  createNewVersion,
  downloadFile,
  entityCreate,
  entityDelete,
  entityFilter,
  entityList,
  entityUpdate,
  invokeBase44Function,
  listVersions,
  login,
  sha256Hex,
  uploadFileWithToken,
} from "./api";
import { IMPORT_MAX_RETRIES, WATCH_FOLDER_POLL_MS } from "./config";
import {
  clearLogin,
  getApiKey,
  getAuthToken,
  getExtensionToken,
  getPreferredUploadToken,
  getSavedEmail,
  getUploadedWatchSignatures,
  getWatchEnabled,
  getWatchFolder,
  saveLogin,
  saveSettings,
  saveUploadedWatchSignatures,
  setWatchEnabled,
  setWatchFolder,
} from "./storage";
import { getActiveEditSession, startAutoSync, stopActiveWatcher } from "./syncEngine";
import type { ImportQueueItem, LocalFolderFile, UiCallbacks } from "./types";
import { pdfNutrientAdapter } from "./editors/pdf.nutrient.adapter";
import { imagePinturaAdapter } from "./editors/image.pintura.adapter";
import { officeOnlyofficeAdapter } from "./editors/office.onlyoffice.adapter";
import type { AdapterItem, EditorAdapter } from "./editors/types";

const SUPPORTED_IMPORT_EXT = new Set(["pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg"]);
const FILES_FOLDERS_KEY = "ev.files.folders";
const FILES_ITEMS_KEY = "ev.files.items";

type FileItemType =
  | "note"
  | "link"
  | "file_reference"
  | "email_reference"
  | "uploaded_file"
  | "managed_file";

interface DesktopFolder {
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso?: string;
  notes?: string;
  isPinned: boolean;
  isFavorite?: boolean;
  isDeleting?: boolean;
  spaceId?: string;
  createdBy?: string;
}

interface DesktopItem {
  id: string;
  title: string;
  itemType: FileItemType;
  folderId: string;
  createdAtIso: string;
  updatedAtIso?: string;
  notes: string;
  tags: string[];
  isPinned: boolean;
  isFavorite: boolean;
  isImportant?: boolean;
  storedFileUrl?: string;
  sourceUrl?: string;
  localPath?: string;
  fileExtension?: string;
  isUploading?: boolean;
  isDeleting?: boolean;
  contentText?: string;
  spaceId?: string;
  createdBy?: string;
}

type PreviewKind = "note" | "link" | "image" | "pdf" | "office" | "other";

type PreviewMode = "preview" | "edit";

type ActionTarget =
  | { kind: "folder"; id: string; entity: "Folder" }
  | { kind: "item"; id: string; entity: "VaultItem" | "EmailItem" | "CalendarEvent" | "Space" };
type EntityName = ActionTarget["entity"] | "GatherPack";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <main class="desktop-native">
    <section id="login-screen" class="login-screen">
      <div class="login-card">
        <p class="eyebrow">EasyVault Desktop</p>
        <h1>Sign in</h1>
        <p class="sub">Native desktop companion for capture, editing, and versioning.</p>
        <form id="login-form" class="form">
          <label>Email</label>
          <input id="email" type="email" required placeholder="you@example.com" />
          <label>Password</label>
          <input id="password" type="password" required placeholder="••••••••" />
          <button id="login-btn" type="submit">Log in</button>
        </form>
      </div>
    </section>

    <section id="workspace-screen" class="workspace-screen hidden">
      <aside class="shell-sidebar">
        <div class="brand-block">
          <div class="brand-row">
            <img class="brand-logo" src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69970fbb1f1de2b0bede99df/daa74d4e3_ChatGPTImageFeb20202605_11_56PM.png" alt="EasyVault" />
            <h2>EasyVault</h2>
          </div>
        </div>
        <nav class="nav-list">
          <button class="nav-btn active" data-tab="home">Home</button>
          <button class="nav-btn" data-tab="files">Files</button>
          <button class="nav-btn" data-tab="email">Email</button>
          <button class="nav-btn" data-tab="calendar">Calendar</button>
          <button class="nav-btn" data-tab="vault">Vault</button>
          <button class="nav-btn" data-tab="shared">Shared</button>
          <button class="nav-btn" data-tab="queue">Dropzone</button>
          <button class="nav-btn" data-tab="settings">Settings</button>
        </nav>
        <button id="logout-btn" type="button" class="ghost">Sign out</button>
      </aside>

      <section class="shell-main">
        <div class="top-title">CEO Vault</div>
        <header class="shell-header">
          <div class="search-shell">
            <span class="search-icon">⌕</span>
            <span>Search everything...</span>
            <kbd>⌘K</kbd>
          </div>
          <p id="status">Status: idle</p>
        </header>

        <section id="tab-home" class="tab-panel">
          <div class="home-hero">
            <h1>Good afternoon, Mr Niclas</h1>
            <p>Here's what needs your attention today</p>
          </div>
          <div class="dashboard-grid">
            <article class="dash-card">
              <div class="dash-head">
                <h4>Pinned</h4>
                <span>Desktop</span>
              </div>
              <p id="current-file">Current file: none</p>
            </article>
            <article class="dash-card">
              <div class="dash-head">
                <h4>Upcoming meetings</h4>
                <span>Next 7 days</span>
              </div>
              <p id="last-sync">Last sync: none</p>
            </article>
            <article class="dash-card">
              <div class="dash-head">
                <h4>Recent files</h4>
                <span>Queue</span>
              </div>
              <p id="queue-summary">Queue: 0 items</p>
            </article>
            <article class="dash-card">
              <div class="dash-head">
                <h4>Import watcher</h4>
                <span>Dropzone</span>
              </div>
              <p id="watch-summary">Watch folder: disabled</p>
            </article>
          </div>
        </section>

        <section id="tab-files" class="tab-panel hidden">
          <div id="files-head-row" class="tab-head-row">
            <div>
              <h2 class="page-title">Files</h2>
              <p class="page-subtitle">Folders and files</p>
            </div>
            <div class="actions-row file-head-actions">
              <button id="files-upload-btn" type="button" class="ghost">Upload</button>
              <button id="files-new-btn" type="button">+ New</button>
            </div>
          </div>
          <div id="files-root-view">
            <h4 class="section-label">Folders</h4>
            <div id="files-folders" class="files-folders"></div>
            <h4 class="section-label">Files & Items</h4>
            <p id="files-scope-label" class="files-scope-label">Showing all folders</p>
            <div id="files-items" class="files-items"></div>
          </div>

          <div id="files-folder-view" class="hidden">
            <div class="files-folder-head">
              <div class="files-folder-crumb">⌂ <span>›</span> <span id="files-folder-crumb-name">Folder</span></div>
              <div class="actions-row file-head-actions">
                <button id="files-folder-upload-btn" type="button" class="ghost">Upload</button>
                <button id="files-folder-new-btn" type="button">+ New</button>
              </div>
            </div>
            <div id="files-folder-toolbar" class="files-folder-toolbar">
              <button id="files-back-btn" type="button" class="ghost">← Back</button>
            </div>
            <h2 id="files-folder-title" class="files-folder-page-title">Folder</h2>
            <div id="files-folder-items" class="files-items"></div>
          </div>

          <div id="files-edit-session" class="dash-card">
            <h4>Edit Session</h4>
            <label>File ID</label>
            <input id="file-id" type="text" placeholder="paste fileId here" />
            <div class="actions-row">
              <button id="checkout-btn" type="button">Checkout + Open</button>
              <button id="unlock-btn" type="button">Unlock Current File</button>
              <button id="simulate-link-btn" type="button">Simulate deep link</button>
            </div>
            <p id="deeplink">Deep link: none</p>
            <pre id="result" class="result-box"></pre>
          </div>
        </section>

        <section id="tab-email" class="tab-panel hidden">
          <div class="center-panel">
            <div class="hero-icon">✉</div>
            <h2>Connect Your Email</h2>
            <p>Sync your emails to search, organize, and save important messages to your vault.</p>
            <div class="actions-row center-actions">
              <button id="connect-gmail-btn" type="button">Connect Gmail</button>
              <button id="connect-outlook-btn" type="button" class="ghost" disabled>Outlook (Coming Soon)</button>
            </div>
            <div class="note-box">We only read email headers and content - we never send emails on your behalf.</div>
          </div>
          <div id="email-list" class="files-items hidden"></div>
        </section>

        <section id="tab-calendar" class="tab-panel hidden">
          <div class="tab-head-row">
            <div>
              <h2 class="page-title">Calendar</h2>
              <p class="page-subtitle">0 events</p>
            </div>
            <button id="new-event-btn" type="button">+ New Event</button>
          </div>
          <div class="actions-row">
            <button id="calendar-prev-btn" type="button" class="ghost">‹</button>
            <div id="calendar-week-label" class="week-label"></div>
            <button id="calendar-next-btn" type="button" class="ghost">›</button>
            <button id="calendar-today-btn" type="button" class="ghost">Today</button>
          </div>
          <div id="calendar-week-grid" class="week-grid"></div>
          <h4 class="section-label">Agenda</h4>
          <div id="calendar-agenda" class="files-items"></div>
        </section>

        <section id="tab-vault" class="tab-panel hidden">
          <div class="tab-head-row">
            <div>
              <h2 class="page-title">Vault</h2>
              <p class="page-subtitle">Gather and organize everything</p>
            </div>
          </div>
          <div class="vault-switch">
            <button class="active">AI Gather</button>
            <button>Tags</button>
          </div>
          <div class="gather-box">
            <div class="gather-row">
              <input id="vault-gather-input" type="text" placeholder='Try: "Q4 planning", "John Smith", "budget review"...' />
              <button id="vault-gather-btn" type="button">Gather</button>
            </div>
            <p>AI will search across files, links, emails, and calendar events to find everything related</p>
          </div>
          <h4 class="section-label">Saved Packs</h4>
          <div id="vault-packs" class="files-items"></div>
        </section>

        <section id="tab-shared" class="tab-panel hidden">
          <div class="tab-head-row">
            <div>
              <h2 class="page-title">Shared Spaces</h2>
              <p class="page-subtitle">Collaborate with your team</p>
            </div>
            <button id="new-space-btn" type="button">+ New Space</button>
          </div>
          <div id="shared-list" class="files-items"></div>
        </section>

        <section id="tab-queue" class="tab-panel hidden">
          <div class="center-panel dropzone-head">
            <div class="hero-icon">⤴</div>
            <h2>Quick Upload</h2>
            <p>Drag files here or click to upload directly to your vault</p>
          </div>
          <div class="dropzone-box">
            <div class="dropzone-title">Drop files here or click to upload</div>
            <div class="dropzone-subtitle">Any file type supported</div>
          </div>
          <div class="dash-card">
            <h4>Recent Uploads</h4>
            <div id="dropzone-remote-list" class="files-items"></div>
            <p id="queue-path">Path: -</p>
            <div class="actions-row">
              <button id="scan-now-btn" type="button">Scan Now</button>
              <button id="retry-failed-btn" type="button">Retry Failed</button>
            </div>
            <div id="queue-list" class="queue-list"></div>
          </div>
        </section>

        <section id="tab-settings" class="tab-panel hidden">
          <div class="profile-card">
            <div class="profile-left">
              <div id="profile-avatar" class="profile-avatar">N</div>
              <div class="profile-meta">
                <h3 id="profile-name" class="profile-name">User</h3>
                <p id="profile-email" class="profile-email">-</p>
              </div>
            </div>
            <div class="profile-right">
              <span class="profile-badge">User</span>
              <button id="profile-edit-btn" type="button" class="profile-edit-btn" aria-label="Edit profile">✎</button>
            </div>
          </div>
          <div class="dash-card">
            <h4>Settings</h4>
            <form id="settings-form" class="form">
              <label>Base44 API key</label>
              <input id="api-key" type="text" placeholder="api key" />
              <label>Extension token</label>
              <input id="extension-token" type="text" placeholder="extension token" />
              <label>Watch folder path</label>
              <input id="watch-folder" type="text" placeholder="/Users/.../Downloads/ToEasyVault" />
              <label class="inline-checkbox">
                <input id="watch-enabled" type="checkbox" />
                Enable watched folder auto-import
              </label>
              <button id="save-settings-btn" type="submit">Save Settings</button>
            </form>
          </div>
          <div class="dash-card">
            <div class="cap-head">
              <h4>Capabilities</h4>
              <span id="sync-health-pill" class="health-pill">Health: not run</span>
            </div>
            <p class="files-scope-label">
              Live compatibility view for Base44 schema support detected by desktop runtime.
            </p>
            <div class="actions-row">
              <button id="cap-refresh-btn" type="button" class="ghost">Refresh</button>
              <button id="cap-copy-btn" type="button" class="ghost">Copy Report</button>
              <button id="sync-health-btn" type="button" class="ghost">Run Sync Health Check</button>
            </div>
            <pre id="capabilities-report" class="result-box"></pre>
            <pre id="sync-health-report" class="result-box">Sync health report: not run</pre>
          </div>
        </section>

        <div id="new-modal" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-panel">
            <div class="modal-head">
              <h3 id="new-modal-title">Create New</h3>
              <button id="new-modal-close" type="button" class="ghost">✕</button>
            </div>

            <div id="new-modal-chooser" class="modal-chooser">
              <button id="new-folder-choice" type="button" class="ghost">New Folder</button>
              <button id="new-item-choice" type="button" class="ghost">New Item</button>
            </div>

            <form id="new-modal-form" class="form hidden">
              <label id="new-name-label" for="new-name-input">Name</label>
              <input id="new-name-input" type="text" placeholder="Enter name..." />

              <div id="new-item-fields" class="hidden">
                <label for="new-item-type">Item Type</label>
                <select id="new-item-type">
                  <option value="note">Note</option>
                  <option value="link">Link</option>
                  <option value="file_reference">File Reference</option>
                  <option value="email_reference">Email Reference</option>
                </select>

                <label for="new-parent-folder">Folder</label>
                <select id="new-parent-folder"></select>
              </div>

              <div class="actions-row">
                <button id="new-modal-cancel" type="button" class="ghost">Cancel</button>
                <button id="new-modal-create" type="submit">Create</button>
              </div>
              <p id="new-modal-feedback" class="files-scope-label"></p>
            </form>
          </div>
        </div>

        <div id="manage-modal" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-panel">
            <div class="modal-head">
              <h3 id="manage-modal-title">Manage</h3>
              <button id="manage-modal-close" type="button" class="ghost">✕</button>
            </div>
            <form id="manage-modal-form" class="form">
              <label for="manage-name-input">Title</label>
              <input id="manage-name-input" type="text" placeholder="Enter title..." />
              <label for="manage-notes-input">Notes</label>
              <input id="manage-notes-input" type="text" placeholder="Optional notes..." />
              <label id="manage-tags-label" for="manage-tags-input">Tags (comma separated)</label>
              <input id="manage-tags-input" type="text" placeholder="tag1, tag2" />
              <div class="actions-row">
                <button id="manage-modal-cancel" type="button" class="ghost">Cancel</button>
                <button id="manage-modal-save" type="submit">Save Changes</button>
              </div>
            </form>
          </div>
        </div>

        <div id="delete-modal" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-panel">
            <div class="modal-head">
              <h3>Delete item?</h3>
            </div>
            <p id="delete-modal-text" class="files-scope-label">This action cannot be undone.</p>
            <div class="actions-row">
              <button id="delete-modal-cancel" type="button" class="ghost">Cancel</button>
              <button id="delete-modal-confirm" type="button">Delete</button>
            </div>
          </div>
        </div>

        <div id="file-action-modal" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-panel file-action-panel">
            <div class="modal-head">
              <h3 id="file-action-title">File actions</h3>
              <button id="file-action-close" type="button" class="ghost">✕</button>
            </div>
            <div class="file-action-list">
              <button id="file-action-preview" type="button" class="ghost">Preview</button>
              <button id="file-action-open-native" type="button" class="ghost">Open Native</button>
              <button id="file-action-edit-app" type="button" class="ghost">Edit in App</button>
              <button id="file-action-manage" type="button" class="ghost">Manage</button>
            </div>
          </div>
        </div>

        <div id="preview-edit-modal" class="modal hidden">
          <div class="modal-backdrop"></div>
          <div class="modal-panel preview-edit-panel">
            <div class="modal-head">
              <div class="preview-edit-title-wrap">
                <h3 id="preview-edit-title">Preview</h3>
                <p id="preview-edit-subtitle" class="files-scope-label">-</p>
              </div>
              <button id="preview-edit-close" type="button" class="ghost">✕</button>
            </div>
            <div id="preview-edit-warning" class="files-scope-label hidden"></div>
            <div id="preview-edit-live-status" class="preview-edit-live-status hidden">Status: idle</div>
            <div id="preview-edit-body" class="preview-edit-body"></div>
            <div class="actions-row preview-edit-actions">
              <button id="preview-open-native-btn" type="button" class="ghost">Open Native</button>
              <button id="preview-edit-mode-btn" type="button" class="ghost">Switch to Edit</button>
              <button id="preview-refresh-btn" type="button" class="ghost">Refresh</button>
              <button id="preview-save-btn" type="button">Save</button>
            </div>
          </div>
        </div>
      </section>
    </section>
  </main>
`;

const loginScreen = document.querySelector<HTMLElement>("#login-screen")!;
const workspaceScreen = document.querySelector<HTMLElement>("#workspace-screen")!;

const loginForm = document.querySelector<HTMLFormElement>("#login-form")!;
const emailInput = document.querySelector<HTMLInputElement>("#email")!;
const passwordInput = document.querySelector<HTMLInputElement>("#password")!;
const loginBtn = document.querySelector<HTMLButtonElement>("#login-btn")!;
const logoutBtn = document.querySelector<HTMLButtonElement>("#logout-btn")!;

const settingsForm = document.querySelector<HTMLFormElement>("#settings-form")!;
const apiKeyInput = document.querySelector<HTMLInputElement>("#api-key")!;
const extensionTokenInput = document.querySelector<HTMLInputElement>("#extension-token")!;
const watchFolderInput = document.querySelector<HTMLInputElement>("#watch-folder")!;
const watchEnabledInput = document.querySelector<HTMLInputElement>("#watch-enabled")!;
const profileAvatarEl = document.querySelector<HTMLDivElement>("#profile-avatar")!;
const profileNameEl = document.querySelector<HTMLHeadingElement>("#profile-name")!;
const profileEmailEl = document.querySelector<HTMLParagraphElement>("#profile-email")!;
const profileEditBtn = document.querySelector<HTMLButtonElement>("#profile-edit-btn")!;
const capRefreshBtn = document.querySelector<HTMLButtonElement>("#cap-refresh-btn")!;
const capCopyBtn = document.querySelector<HTMLButtonElement>("#cap-copy-btn")!;
const syncHealthBtn = document.querySelector<HTMLButtonElement>("#sync-health-btn")!;
const capabilitiesReportEl = document.querySelector<HTMLPreElement>("#capabilities-report")!;
const syncHealthReportEl = document.querySelector<HTMLPreElement>("#sync-health-report")!;
const syncHealthPillEl = document.querySelector<HTMLSpanElement>("#sync-health-pill")!;

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const currentFileEl = document.querySelector<HTMLParagraphElement>("#current-file")!;
const lastSyncEl = document.querySelector<HTMLParagraphElement>("#last-sync")!;
const queueSummaryEl = document.querySelector<HTMLParagraphElement>("#queue-summary")!;
const watchSummaryEl = document.querySelector<HTMLParagraphElement>("#watch-summary")!;

const fileIdInput = document.querySelector<HTMLInputElement>("#file-id")!;
const deepLinkEl = document.querySelector<HTMLParagraphElement>("#deeplink")!;
const resultEl = document.querySelector<HTMLPreElement>("#result")!;
const checkoutBtn = document.querySelector<HTMLButtonElement>("#checkout-btn")!;
const unlockBtn = document.querySelector<HTMLButtonElement>("#unlock-btn")!;
const simulateBtn = document.querySelector<HTMLButtonElement>("#simulate-link-btn")!;
const filesUploadBtn = document.querySelector<HTMLButtonElement>("#files-upload-btn")!;
const filesNewBtn = document.querySelector<HTMLButtonElement>("#files-new-btn")!;
const filesFoldersEl = document.querySelector<HTMLDivElement>("#files-folders")!;
const filesHeadRowEl = document.querySelector<HTMLDivElement>("#files-head-row")!;
const filesRootViewEl = document.querySelector<HTMLDivElement>("#files-root-view")!;
const filesFolderViewEl = document.querySelector<HTMLDivElement>("#files-folder-view")!;
const filesItemsEl = document.querySelector<HTMLDivElement>("#files-items")!;
const filesFolderItemsEl = document.querySelector<HTMLDivElement>("#files-folder-items")!;
const filesFolderCrumbNameEl = document.querySelector<HTMLSpanElement>("#files-folder-crumb-name")!;
const filesFolderTitleEl = document.querySelector<HTMLHeadingElement>("#files-folder-title")!;
const filesBackBtn = document.querySelector<HTMLButtonElement>("#files-back-btn")!;
const filesFolderUploadBtn = document.querySelector<HTMLButtonElement>("#files-folder-upload-btn")!;
const filesFolderNewBtn = document.querySelector<HTMLButtonElement>("#files-folder-new-btn")!;
const filesEditSessionEl = document.querySelector<HTMLDivElement>("#files-edit-session")!;
const filesScopeLabelEl = document.querySelector<HTMLParagraphElement>("#files-scope-label")!;
const emailListEl = document.querySelector<HTMLDivElement>("#email-list")!;
const calendarAgendaEl = document.querySelector<HTMLDivElement>("#calendar-agenda")!;
const vaultPacksEl = document.querySelector<HTMLDivElement>("#vault-packs")!;
const sharedListEl = document.querySelector<HTMLDivElement>("#shared-list")!;
const dropzoneRemoteListEl = document.querySelector<HTMLDivElement>("#dropzone-remote-list")!;
const newModalEl = document.querySelector<HTMLDivElement>("#new-modal")!;
const newModalBackdropEl = document.querySelector<HTMLDivElement>("#new-modal .modal-backdrop")!;
const newModalTitleEl = document.querySelector<HTMLHeadingElement>("#new-modal-title")!;
const newModalCloseBtn = document.querySelector<HTMLButtonElement>("#new-modal-close")!;
const newModalChooserEl = document.querySelector<HTMLDivElement>("#new-modal-chooser")!;
const newFolderChoiceBtn = document.querySelector<HTMLButtonElement>("#new-folder-choice")!;
const newItemChoiceBtn = document.querySelector<HTMLButtonElement>("#new-item-choice")!;
const newModalForm = document.querySelector<HTMLFormElement>("#new-modal-form")!;
const newNameInput = document.querySelector<HTMLInputElement>("#new-name-input")!;
const newNameLabelEl = document.querySelector<HTMLLabelElement>("#new-name-label")!;
const newItemFieldsEl = document.querySelector<HTMLDivElement>("#new-item-fields")!;
const newItemTypeSelect = document.querySelector<HTMLSelectElement>("#new-item-type")!;
const newParentFolderSelect = document.querySelector<HTMLSelectElement>("#new-parent-folder")!;
const newModalCancelBtn = document.querySelector<HTMLButtonElement>("#new-modal-cancel")!;
const newModalCreateBtn = document.querySelector<HTMLButtonElement>("#new-modal-create")!;
const newModalFeedbackEl = document.querySelector<HTMLParagraphElement>("#new-modal-feedback")!;
const manageModalEl = document.querySelector<HTMLDivElement>("#manage-modal")!;
const manageModalBackdropEl = document.querySelector<HTMLDivElement>("#manage-modal .modal-backdrop")!;
const manageModalCloseBtn = document.querySelector<HTMLButtonElement>("#manage-modal-close")!;
const manageModalTitleEl = document.querySelector<HTMLHeadingElement>("#manage-modal-title")!;
const manageModalForm = document.querySelector<HTMLFormElement>("#manage-modal-form")!;
const manageNameInput = document.querySelector<HTMLInputElement>("#manage-name-input")!;
const manageNotesLabelEl = document.querySelector<HTMLLabelElement>("label[for='manage-notes-input']")!;
const manageNotesInput = document.querySelector<HTMLInputElement>("#manage-notes-input")!;
const manageTagsLabelEl = document.querySelector<HTMLLabelElement>("#manage-tags-label")!;
const manageTagsInput = document.querySelector<HTMLInputElement>("#manage-tags-input")!;
const manageModalCancelBtn = document.querySelector<HTMLButtonElement>("#manage-modal-cancel")!;
const deleteModalEl = document.querySelector<HTMLDivElement>("#delete-modal")!;
const deleteModalBackdropEl = document.querySelector<HTMLDivElement>("#delete-modal .modal-backdrop")!;
const deleteModalTextEl = document.querySelector<HTMLParagraphElement>("#delete-modal-text")!;
const deleteModalCancelBtn = document.querySelector<HTMLButtonElement>("#delete-modal-cancel")!;
const deleteModalConfirmBtn = document.querySelector<HTMLButtonElement>("#delete-modal-confirm")!;
const deleteModalConfirmDefaultLabel = deleteModalConfirmBtn.textContent || "Delete";
const fileActionModalEl = document.querySelector<HTMLDivElement>("#file-action-modal")!;
const fileActionBackdropEl = document.querySelector<HTMLDivElement>("#file-action-modal .modal-backdrop")!;
const fileActionCloseBtn = document.querySelector<HTMLButtonElement>("#file-action-close")!;
const fileActionTitleEl = document.querySelector<HTMLHeadingElement>("#file-action-title")!;
const fileActionPreviewBtn = document.querySelector<HTMLButtonElement>("#file-action-preview")!;
const fileActionOpenNativeBtn = document.querySelector<HTMLButtonElement>("#file-action-open-native")!;
const fileActionEditAppBtn = document.querySelector<HTMLButtonElement>("#file-action-edit-app")!;
const fileActionManageBtn = document.querySelector<HTMLButtonElement>("#file-action-manage")!;
const previewEditModalEl = document.querySelector<HTMLDivElement>("#preview-edit-modal")!;
const previewEditPanelEl = previewEditModalEl.querySelector<HTMLDivElement>(".preview-edit-panel")!;
const previewEditBackdropEl = document.querySelector<HTMLDivElement>("#preview-edit-modal .modal-backdrop")!;
const previewEditCloseBtn = document.querySelector<HTMLButtonElement>("#preview-edit-close")!;
const previewEditTitleEl = document.querySelector<HTMLHeadingElement>("#preview-edit-title")!;
const previewEditSubtitleEl = document.querySelector<HTMLParagraphElement>("#preview-edit-subtitle")!;
const previewEditWarningEl = document.querySelector<HTMLDivElement>("#preview-edit-warning")!;
const previewEditLiveStatusEl = document.querySelector<HTMLDivElement>("#preview-edit-live-status")!;
const previewEditBodyEl = document.querySelector<HTMLDivElement>("#preview-edit-body")!;
const previewOpenNativeBtn = document.querySelector<HTMLButtonElement>("#preview-open-native-btn")!;
const previewEditModeBtn = document.querySelector<HTMLButtonElement>("#preview-edit-mode-btn")!;
const previewRefreshBtn = document.querySelector<HTMLButtonElement>("#preview-refresh-btn")!;
const previewSaveBtn = document.querySelector<HTMLButtonElement>("#preview-save-btn")!;

const queuePathEl = document.querySelector<HTMLParagraphElement>("#queue-path")!;
const queueListEl = document.querySelector<HTMLDivElement>("#queue-list")!;
const scanNowBtn = document.querySelector<HTMLButtonElement>("#scan-now-btn")!;
const retryFailedBtn = document.querySelector<HTMLButtonElement>("#retry-failed-btn")!;
const connectGmailBtn = document.querySelector<HTMLButtonElement>("#connect-gmail-btn")!;
const newEventBtn = document.querySelector<HTMLButtonElement>("#new-event-btn")!;
const calendarPrevBtn = document.querySelector<HTMLButtonElement>("#calendar-prev-btn")!;
const calendarNextBtn = document.querySelector<HTMLButtonElement>("#calendar-next-btn")!;
const calendarTodayBtn = document.querySelector<HTMLButtonElement>("#calendar-today-btn")!;
const calendarWeekLabelEl = document.querySelector<HTMLDivElement>("#calendar-week-label")!;
const calendarWeekGridEl = document.querySelector<HTMLDivElement>("#calendar-week-grid")!;
const vaultGatherInput = document.querySelector<HTMLInputElement>("#vault-gather-input")!;
const vaultGatherBtn = document.querySelector<HTMLButtonElement>("#vault-gather-btn")!;
const newSpaceBtn = document.querySelector<HTMLButtonElement>("#new-space-btn")!;

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-btn"));
const tabPanels = {
  home: document.querySelector<HTMLElement>("#tab-home")!,
  files: document.querySelector<HTMLElement>("#tab-files")!,
  email: document.querySelector<HTMLElement>("#tab-email")!,
  calendar: document.querySelector<HTMLElement>("#tab-calendar")!,
  vault: document.querySelector<HTMLElement>("#tab-vault")!,
  shared: document.querySelector<HTMLElement>("#tab-shared")!,
  queue: document.querySelector<HTMLElement>("#tab-queue")!,
  settings: document.querySelector<HTMLElement>("#tab-settings")!,
};

let queueItems: ImportQueueItem[] = [];
let isQueueRunning = false;
let watchPollId: number | null = null;
let remotePollId: number | null = null;
let uploadedSignatures = getUploadedWatchSignatures();
let calendarWeekStart = getStartOfWeek(new Date());
let createMode: "folder" | "item" | null = null;
let filesFolders = loadJson<DesktopFolder[]>(FILES_FOLDERS_KEY, []);
let filesItems = loadJson<DesktopItem[]>(FILES_ITEMS_KEY, []);
let activeFolderId = "";
let manageTarget: ActionTarget | null = null;
let manageTargetBaselineUpdatedAt = "";
let deleteTarget: ActionTarget | null = null;
let fileActionTargetId = "";
let accessibleSpaceIds: string[] = [];
let personalSpaceId = "";
let remoteEmails: Record<string, unknown>[] = [];
let remoteEvents: Record<string, unknown>[] = [];
let remotePacks: Record<string, unknown>[] = [];
let remoteSpaces: Record<string, unknown>[] = [];
let remoteDropzoneItems: Record<string, unknown>[] = [];
let lastDeltaSyncIso = "";
const remoteUpdatedAtByEntity: Record<string, Map<string, string>> = {
  Folder: new Map<string, string>(),
  VaultItem: new Map<string, string>(),
  EmailItem: new Map<string, string>(),
  CalendarEvent: new Map<string, string>(),
  Space: new Map<string, string>(),
  GatherPack: new Map<string, string>(),
};
const unsupportedFieldsByEntity: Record<EntityName, Set<string>> = {
  Folder: new Set<string>(["notes", "is_favorite"]),
  VaultItem: new Set<string>(["is_important"]),
  EmailItem: new Set<string>(),
  CalendarEvent: new Set<string>(["is_pinned", "is_favorite"]),
  Space: new Set<string>(),
  GatherPack: new Set<string>(),
};
const schemaFieldsByEntity: Record<EntityName, Set<string> | null> = {
  Folder: null,
  VaultItem: null,
  EmailItem: null,
  CalendarEvent: null,
  Space: null,
  GatherPack: null,
};
let schemaLoadedAt = "";
let schemaVersion = "";
let schemaFunctionCount = 0;
let syncHealthRunning = false;
let previewEditTargetId = "";
let previewEditMode: PreviewMode = "preview";
let previewEditKind: PreviewKind = "other";
let previewEditSaving = false;
let previewEditCanEdit = false;
let previewEditNoteDraft = "";
let previewEditLinkUrlDraft = "";
let previewEditLinkNotesDraft = "";
let previewEditImageObjectUrl = "";
let previewEditImageRotation = 0;
let previewEditImageBrightness = 100;
let onlyofficeEditorInstance: { destroy?: () => void } | null = null;
let onlyofficeApiReady = false;
let onlyofficeApiScriptUrl = "";
let onlyofficeRelayContainerCallbackUrl = "http://host.docker.internal:17171/onlyoffice-callback";
let onlyofficeRelayHostCallbackUrl = "http://localhost:17171/onlyoffice-callback";
const ONLYOFFICE_LOCAL_JWT_SECRET_FALLBACK = "ev_9fK2mQ7xT4pL8vN3zR6cH1yB5uD0wS";
let onlyofficeRelayPollTimer: number | null = null;
let onlyofficeRelayLastSeenCount = 0;
let onlyofficeActiveFileId = "";
let onlyofficeBaselineVersionCount = 0;
const relayTempCleanupInFlight = new Set<string>();

const editorFeatureFlags = {
  nutrient: false,
  onlyoffice: true,
  pintura: true,
};

const previewEditAdapters: Partial<Record<PreviewKind, EditorAdapter>> = {
  pdf: pdfNutrientAdapter,
  image: imagePinturaAdapter,
  office: officeOnlyofficeAdapter,
};

const editorBridge = (window as unknown as { EasyVaultEditors?: { onlyofficeLaunch?: (fileId: string) => void } }).EasyVaultEditors || {};
editorBridge.onlyofficeLaunch = (fileId: string) => {
  void launchOnlyofficeEditor(fileId);
};
(window as unknown as { EasyVaultEditors?: { onlyofficeLaunch?: (fileId: string) => void } }).EasyVaultEditors = editorBridge;

let capabilitiesReportCache = "";

filesFolders = filesFolders.map((folder) => normalizeFolder(folder));
filesItems = filesItems.map((item) => normalizeItem(item));

function setActiveTab(tab: keyof typeof tabPanels): void {
  for (const [name, panel] of Object.entries(tabPanels)) {
    panel.classList.toggle("hidden", name !== tab);
  }
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
}

function enterWorkspace(): void {
  loginScreen.classList.add("hidden");
  workspaceScreen.classList.remove("hidden");
}

function enterLogin(): void {
  workspaceScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

function setStatus(text: string): void {
  statusEl.textContent = `Status: ${text}`;
  if (!previewEditModalEl.classList.contains("hidden")) {
    previewEditLiveStatusEl.classList.remove("hidden");
    previewEditLiveStatusEl.textContent = `Status: ${text}`;
  }
}

function setPreviewLiveStatus(text: string): void {
  if (previewEditModalEl.classList.contains("hidden")) return;
  previewEditLiveStatusEl.classList.remove("hidden");
  previewEditLiveStatusEl.textContent = `Status: ${text}`;
}

function stopOnlyofficeRelayPolling(): void {
  if (onlyofficeRelayPollTimer !== null) {
    window.clearInterval(onlyofficeRelayPollTimer);
    onlyofficeRelayPollTimer = null;
  }
}

async function startOnlyofficeRelayPolling(): Promise<void> {
  stopOnlyofficeRelayPolling();
  onlyofficeRelayLastSeenCount = 0;
  const pull = async () => {
    try {
      const stats = await invoke<{
        callback_count?: number;
        last_status?: number | null;
        last_key?: string | null;
        last_upstream_status?: number | null;
        last_upstream_body?: string | null;
        last_commit_method?: string | null;
        last_error?: string | null;
        last_save_status?: number | null;
        last_save_key?: string | null;
        last_save_upstream_status?: number | null;
        last_save_upstream_body?: string | null;
        last_save_commit_method?: string | null;
        last_save_error?: string | null;
      }>("get_onlyoffice_relay_stats");
      const count = Number(stats.callback_count || 0);
      const status = stats.last_status ?? "-";
      const commitMethod = stats.last_commit_method ?? "-";
      const saveStatus = stats.last_save_status ?? "-";
      const saveUpstream = stats.last_save_upstream_status ?? "-";
      const saveCommitMethod = stats.last_save_commit_method ?? "-";
      const saveUpstreamBody =
        typeof stats.last_save_upstream_body === "string" ? stats.last_save_upstream_body : "";
      const upstreamBody = typeof stats.last_upstream_body === "string" ? stats.last_upstream_body : "";
      if (stats.last_error) {
        setPreviewLiveStatus(`relay error: ${stats.last_error}`);
      } else if (stats.last_save_error) {
        setPreviewLiveStatus(`relay save error: ${stats.last_save_error}`);
      } else {
        setPreviewLiveStatus(
          `relay callbacks: ${count} • callback status: ${status} • save status: ${saveStatus} • save upstream: ${saveUpstream} • save commit: ${saveCommitMethod}`
        );
        if (count > onlyofficeRelayLastSeenCount) {
          onlyofficeRelayLastSeenCount = count;
          if (saveStatus === 6 || saveStatus === 2) {
            setStatus("ONLYOFFICE save callback received, syncing...");
            await syncRemoteDelta();
            if (onlyofficeActiveFileId) {
              try {
                const versionToken = getPreferredUploadToken() || getAuthToken();
                if (!versionToken) throw new Error("missing token for version check");
                const versions = await listVersions(versionToken, onlyofficeActiveFileId);
                const newCount = Array.isArray(versions) ? versions.length : 0;
                if (newCount > onlyofficeBaselineVersionCount) {
                  onlyofficeBaselineVersionCount = newCount;
                  setStatus(`ONLYOFFICE save synced (${newCount} versions)`);
                } else {
                  const upstreamSummary = saveUpstreamBody
                    ? ` • upstream body: ${saveUpstreamBody.slice(0, 120)}`
                    : upstreamBody
                      ? ` • upstream body: ${upstreamBody.slice(0, 120)}`
                      : "";
                  const methodSummary =
                    saveCommitMethod && saveCommitMethod !== "-"
                      ? ` • commit: ${saveCommitMethod}`
                      : commitMethod
                        ? ` • commit: ${commitMethod}`
                        : "";
                  setStatus(`ONLYOFFICE callback received but no new version was created${methodSummary}${upstreamSummary}`);
                }
              } catch (err) {
                setStatus(`ONLYOFFICE save sync check failed: ${String(err)}`);
              }
            } else {
              setStatus("ONLYOFFICE save synced to desktop");
            }
          } else {
            // Surface non-save callbacks too (print/export/session callbacks), so user gets feedback.
            const method = saveCommitMethod && saveCommitMethod !== "-" ? saveCommitMethod : commitMethod;
            if (method === "skipped_file_not_found_callback" || method === "skipped_non_vault_key") {
              setStatus("ONLYOFFICE print/export callback acknowledged");
            } else if (status === 1) {
              setStatus("ONLYOFFICE session callback received");
            } else if (status === 4) {
              setStatus("ONLYOFFICE session closed callback received");
            } else if (status === 7) {
              setStatus("ONLYOFFICE force-save error callback received");
            } else {
              setStatus(`ONLYOFFICE callback received (status ${status})`);
            }
          }
        }
      }
    } catch (err) {
      setPreviewLiveStatus(`relay stats failed: ${String(err)}`);
    }
  };
  await pull();
  onlyofficeRelayPollTimer = window.setInterval(() => {
    void pull();
  }, 1500);
}

function setLastSync(text: string): void {
  lastSyncEl.textContent = `Last sync: ${text}`;
}

function setCurrentFile(text: string): void {
  currentFileEl.textContent = `Current file: ${text}`;
}

function setResult(payload: unknown): void {
  resultEl.textContent = JSON.stringify(payload, null, 2);
}

function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveFilesState(): void {
  localStorage.setItem(FILES_FOLDERS_KEY, JSON.stringify(filesFolders));
  localStorage.setItem(FILES_ITEMS_KEY, JSON.stringify(filesItems));
}

function normalizeFolder(input: Partial<DesktopFolder>): DesktopFolder {
  return {
    id: input.id || crypto.randomUUID(),
    name: input.name || "Untitled folder",
    createdAtIso: input.createdAtIso || new Date().toISOString(),
    updatedAtIso: input.updatedAtIso || input.createdAtIso || new Date().toISOString(),
    notes: input.notes || "",
    isPinned: Boolean(input.isPinned),
    isFavorite: Boolean(input.isFavorite),
    isDeleting: Boolean(input.isDeleting),
    spaceId: input.spaceId || "",
    createdBy: input.createdBy || "",
  };
}

function normalizeItem(input: Partial<DesktopItem>): DesktopItem {
  return {
    id: input.id || crypto.randomUUID(),
    title: input.title || "Untitled item",
    itemType: (input.itemType as FileItemType) || "note",
    folderId: input.folderId || "",
    createdAtIso: input.createdAtIso || new Date().toISOString(),
    updatedAtIso: input.updatedAtIso || input.createdAtIso || new Date().toISOString(),
    notes: input.notes || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    isPinned: Boolean(input.isPinned),
    isFavorite: Boolean(input.isFavorite),
    isImportant: Boolean(input.isImportant),
    storedFileUrl: input.storedFileUrl || "",
    sourceUrl: input.sourceUrl || "",
    localPath: input.localPath || "",
    fileExtension: input.fileExtension || "",
    isUploading: Boolean(input.isUploading),
    isDeleting: Boolean(input.isDeleting),
    contentText: input.contentText || "",
    spaceId: input.spaceId || "",
    createdBy: input.createdBy || "",
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function isFieldSupported(entity: EntityName, field: string): boolean {
  const schemaFields = schemaFieldsByEntity[entity];
  if (schemaFields && !schemaFields.has(field)) return false;
  return !unsupportedFieldsByEntity[entity].has(field);
}

function sanitizePayload(entity: EntityName, payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = unsupportedFieldsByEntity[entity];
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!blocked.has(key)) cleaned[key] = value;
  }
  return cleaned;
}

function getCapabilitiesReport(): string {
  const entities: EntityName[] = ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"];
  const lines: string[] = [];
  lines.push("EasyVault Desktop Capabilities");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Auth token: ${getAuthToken() ? "present" : "missing"}`);
  lines.push(`Accessible spaces loaded: ${accessibleSpaceIds.length}`);
  lines.push(`Personal space id: ${personalSpaceId || "(none)"}`);
  lines.push(`Schema loaded: ${schemaLoadedAt ? schemaLoadedAt : "no"}`);
  lines.push(`Schema version: ${schemaVersion || "unknown"}`);
  lines.push(`Schema functions: ${schemaFunctionCount}`);
  lines.push("");
  for (const entity of entities) {
    const blocked = Array.from(unsupportedFieldsByEntity[entity]);
    const schema = schemaFieldsByEntity[entity];
    lines.push(`${entity}:`);
    lines.push(`  schema fields loaded: ${schema ? schema.size : 0}`);
    lines.push(`  unsupported fields: ${blocked.length === 0 ? "(none detected)" : blocked.join(", ")}`);
  }
  lines.push("");
  lines.push("Counts:");
  lines.push(`  folders=${filesFolders.length}`);
  lines.push(`  files_items=${filesItems.length}`);
  lines.push(`  emails=${remoteEmails.length}`);
  lines.push(`  events=${remoteEvents.length}`);
  lines.push(`  packs=${remotePacks.length}`);
  lines.push(`  shared_spaces=${remoteSpaces.length}`);
  lines.push(`  dropzone_items=${remoteDropzoneItems.length}`);
  return lines.join("\n");
}

function renderCapabilitiesReport(): void {
  capabilitiesReportCache = getCapabilitiesReport();
  capabilitiesReportEl.textContent = capabilitiesReportCache;
}

function fileKindFromItem(item: DesktopItem): PreviewKind {
  if (item.itemType === "note") return "note";
  if (item.itemType === "link") return "link";
  const ext = (item.fileExtension || extOf(item.title)).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") return "office";
  return "other";
}

function canEditBySpace(spaceId: string, createdBy: string): boolean {
  const me = currentUserEmail();
  if (!spaceId) return true;
  if (spaceId === personalSpaceId) {
    if (!me) return true;
    if (!createdBy) return true;
    return createdBy.toLowerCase() === me;
  }
  const row = remoteSpaces.find((s) => asString(s.id) === spaceId);
  if (!row) return false;
  if (me && asString(row.created_by).toLowerCase() === me) return true;
  const members = Array.isArray(row.members) ? row.members : [];
  const member = members.find((m) => m && typeof m === "object" && asString((m as Record<string, unknown>).email).toLowerCase() === me) as
    | Record<string, unknown>
    | undefined;
  const role = asString(member?.role).toLowerCase();
  return role === "owner" || role === "editor";
}

function canEditItem(item: DesktopItem): boolean {
  return canEditBySpace(item.spaceId || "", item.createdBy || "");
}

function toAdapterItem(item: DesktopItem): AdapterItem {
  return {
    id: item.id,
    title: item.title,
    itemType: item.itemType,
    folderId: item.folderId,
    createdAtIso: item.createdAtIso,
    updatedAtIso: item.updatedAtIso,
    notes: item.notes,
    tags: item.tags || [],
    storedFileUrl: item.storedFileUrl,
    sourceUrl: item.sourceUrl,
    localPath: item.localPath,
    fileExtension: item.fileExtension,
    contentText: item.contentText,
    spaceId: item.spaceId,
    createdBy: item.createdBy,
  };
}

function revokePreviewImageObjectUrl(): void {
  if (!previewEditImageObjectUrl) return;
  URL.revokeObjectURL(previewEditImageObjectUrl);
  previewEditImageObjectUrl = "";
}

function resetPreviewEditState(): void {
  previewEditTargetId = "";
  previewEditMode = "preview";
  previewEditKind = "other";
  previewEditSaving = false;
  previewEditCanEdit = false;
  previewEditNoteDraft = "";
  previewEditLinkUrlDraft = "";
  previewEditLinkNotesDraft = "";
  previewEditImageRotation = 0;
  previewEditImageBrightness = 100;
  revokePreviewImageObjectUrl();
}

function closePreviewEditModal(): void {
  if (previewEditSaving) return;
  previewEditPanelEl.classList.remove("office-mode");
  previewEditBodyEl.style.height = "";
  stopOnlyofficeRelayPolling();
  onlyofficeActiveFileId = "";
  onlyofficeBaselineVersionCount = 0;
  previewEditLiveStatusEl.classList.add("hidden");
  previewEditLiveStatusEl.textContent = "Status: idle";
  if (onlyofficeEditorInstance?.destroy) {
    try {
      onlyofficeEditorInstance.destroy();
    } catch {}
  }
  onlyofficeEditorInstance = null;
  previewEditModalEl.classList.add("hidden");
  resetPreviewEditState();
}

function renderPreviewEditWarning(text = ""): void {
  if (!text) {
    previewEditWarningEl.classList.add("hidden");
    previewEditWarningEl.textContent = "";
    return;
  }
  previewEditWarningEl.classList.remove("hidden");
  previewEditWarningEl.textContent = text;
}

function renderPreviewEditBody(item: DesktopItem): void {
  previewEditBodyEl.classList.remove("office-body");
  previewEditPanelEl.classList.remove("office-mode");
  stopOnlyofficeRelayPolling();
  previewEditLiveStatusEl.classList.add("hidden");
  previewEditLiveStatusEl.textContent = "Status: idle";
  previewEditBodyEl.style.height = "";
  const kind = previewEditKind;
  const adapter = previewEditAdapters[kind];
  const adapterCtx = {
    item: toAdapterItem(item),
    bodyEl: previewEditBodyEl,
    draft: {
      imageRotation: previewEditImageRotation,
      imageBrightness: previewEditImageBrightness,
    } as Record<string, unknown>,
    setStatus,
    getPreviewUrl: (x: AdapterItem) => getPreviewUrlForItem(x as DesktopItem),
    featureFlags: editorFeatureFlags,
  };
  if (previewEditMode === "preview") {
    if (kind === "note") {
      const content = (item.contentText || item.notes || "").trim();
      previewEditBodyEl.innerHTML = `<div class="preview-text-block">${content || "No note content"}</div>`;
      return;
    }
    if (kind === "link") {
      const url = item.sourceUrl || "";
      previewEditBodyEl.innerHTML = `
        <div class="preview-link-block">
          <a href="${url}" target="_blank" rel="noreferrer">${url || "No URL"}</a>
          <p>${item.notes || "No notes"}</p>
        </div>
      `;
      return;
    }
    if (adapter) {
      adapter.openPreview(adapterCtx);
      return;
    }
    previewEditBodyEl.innerHTML = `<div class="preview-placeholder">No in-app preview available</div>`;
    return;
  }

  if (kind === "note") {
    previewEditBodyEl.innerHTML = `
      <label>Note content</label>
      <textarea id="preview-edit-note-input" class="preview-textarea" rows="12">${previewEditNoteDraft}</textarea>
    `;
    return;
  }
  if (kind === "link") {
    previewEditBodyEl.innerHTML = `
      <label>URL</label>
      <input id="preview-edit-link-url" type="text" value="${previewEditLinkUrlDraft}" />
      <label>Notes</label>
      <textarea id="preview-edit-link-notes" class="preview-textarea" rows="8">${previewEditLinkNotesDraft}</textarea>
    `;
    return;
  }
  if (adapter) {
    adapter.openEditor(adapterCtx);
    previewEditImageRotation = Number(adapterCtx.draft.imageRotation ?? previewEditImageRotation);
    previewEditImageBrightness = Number(adapterCtx.draft.imageBrightness ?? previewEditImageBrightness);
    return;
  }
  previewEditBodyEl.innerHTML = `<div class="preview-placeholder">No in-app editor available for this type</div>`;
}

function bindPreviewEditInputs(): void {
  if (previewEditMode !== "edit") return;
  if (previewEditKind === "note") {
    const input = previewEditBodyEl.querySelector<HTMLTextAreaElement>("#preview-edit-note-input");
    if (input) {
      input.addEventListener("input", () => {
        previewEditNoteDraft = input.value;
      });
    }
  } else if (previewEditKind === "link") {
    const urlInput = previewEditBodyEl.querySelector<HTMLInputElement>("#preview-edit-link-url");
    const notesInput = previewEditBodyEl.querySelector<HTMLTextAreaElement>("#preview-edit-link-notes");
    if (urlInput) {
      urlInput.addEventListener("input", () => {
        previewEditLinkUrlDraft = urlInput.value;
      });
    }
    if (notesInput) {
      notesInput.addEventListener("input", () => {
        previewEditLinkNotesDraft = notesInput.value;
      });
    }
  }
}

function rewriteOnlyofficeCallbackUrls(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^https?:\/\/(app\.base44\.com|easy-vault\.com)\/api\/apps\/[^/]+\/functions\/onlyofficeCallback\/?$/i.test(value)) {
      return onlyofficeRelayContainerCallbackUrl;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteOnlyofficeCallbackUrls(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteOnlyofficeCallbackUrls(v);
    }
    return out;
  }
  return value;
}

function base64UrlEncode(input: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < input.length; i += 1) raw += String.fromCharCode(input[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonBase64Url(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function hmacSha256Base64Url(message: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

async function signOnlyofficeConfigToken(config: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { ...config };
  delete (payload as { token?: unknown }).token;
  const headerB64 = jsonBase64Url(header);
  const payloadB64 = jsonBase64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSha256Base64Url(signingInput, secret);
  return `${signingInput}.${signature}`;
}

async function setupOnlyofficeLocalRelay(): Promise<void> {
  try {
    const relayInfo = await invoke<{
      enabled?: boolean;
      container_callback_url?: string;
      host_callback_url?: string;
      target_callback_url?: string;
      port?: number;
    }>("get_onlyoffice_relay_info");
    if (!relayInfo?.enabled) return;
    if (typeof relayInfo.container_callback_url === "string" && relayInfo.container_callback_url.length > 0) {
      onlyofficeRelayContainerCallbackUrl = relayInfo.container_callback_url;
    }
    if (typeof relayInfo.host_callback_url === "string" && relayInfo.host_callback_url.length > 0) {
      onlyofficeRelayHostCallbackUrl = relayInfo.host_callback_url;
    }
    const relayToken = getPreferredUploadToken() || getAuthToken();
    if (relayToken) {
      await invoke("set_onlyoffice_relay_auth", {
        token: relayToken,
        apiKey: getApiKey(),
      });
    }
    setStatus(`ONLYOFFICE relay ready on ${onlyofficeRelayHostCallbackUrl}`);
  } catch (err) {
    setStatus(`ONLYOFFICE relay init failed: ${String(err)}`);
  }
}

function updatePreviewEditActions(item: DesktopItem): void {
  previewOpenNativeBtn.disabled = !(item.localPath || item.storedFileUrl);
  previewRefreshBtn.disabled = previewEditSaving;
  const hasDirectSave = previewEditKind !== "office" && previewEditKind !== "pdf";
  previewSaveBtn.disabled = previewEditSaving || previewEditMode !== "edit" || !previewEditCanEdit || !hasDirectSave;
  previewSaveBtn.textContent = previewEditSaving ? "Saving..." : "Save";
  previewEditModeBtn.disabled = !previewEditCanEdit || previewEditSaving || previewEditKind === "other";
  previewEditModeBtn.textContent = previewEditMode === "preview" ? "Switch to Edit" : "Switch to Preview";
}

async function ensureOnlyofficeApi(documentServerUrl: string): Promise<void> {
  const normalized = documentServerUrl.replace(/\/+$/, "");
  const scriptUrl = `${normalized}/web-apps/apps/api/documents/api.js`;
  if (onlyofficeApiReady && onlyofficeApiScriptUrl === scriptUrl) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`ONLYOFFICE API load timeout: ${scriptUrl}`));
    }, 12000);
    const existing = document.querySelector<HTMLScriptElement>(`script[data-onlyoffice-api="${scriptUrl}"]`);
    if (existing) {
      if ((window as unknown as { DocsAPI?: unknown }).DocsAPI) {
        onlyofficeApiReady = true;
        onlyofficeApiScriptUrl = scriptUrl;
        window.clearTimeout(timer);
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        onlyofficeApiReady = true;
        onlyofficeApiScriptUrl = scriptUrl;
        window.clearTimeout(timer);
        resolve();
      });
      existing.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("Failed to load ONLYOFFICE API"));
      });
      return;
    }
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.onlyofficeApi = scriptUrl;
    script.onload = () => {
      onlyofficeApiReady = true;
      onlyofficeApiScriptUrl = scriptUrl;
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Failed to load ONLYOFFICE API from ${scriptUrl}`));
    };
    document.head.appendChild(script);
  });
}

async function launchOnlyofficeEditor(fileId: string): Promise<void> {
  const item = filesItems.find((x) => x.id === fileId);
  if (!item) {
    setStatus("ONLYOFFICE launch failed: item not found");
    return;
  }
  setStatus("opening ONLYOFFICE...");
  try {
    onlyofficeActiveFileId = fileId;
    try {
      const versionToken = getPreferredUploadToken() || getAuthToken();
      if (!versionToken) throw new Error("missing token for version baseline");
      const versions = await listVersions(versionToken, fileId);
      onlyofficeBaselineVersionCount = Array.isArray(versions) ? versions.length : 0;
    } catch {
      onlyofficeBaselineVersionCount = 0;
    }

    const payload = await invokeBase44Function<Record<string, unknown>>("onlyofficeEditorSession", {
      fileId,
      mode: "edit",
      device_id: "easyvault-desktop-mac",
    });
    const editorNode = (payload.editor as Record<string, unknown> | undefined) || payload;
    let documentServerUrl =
      asString(editorNode.document_server_url) ||
      asString(payload.document_server_url) ||
      "http://host.docker.internal";
    if (documentServerUrl.includes("host.docker.internal")) {
      documentServerUrl = documentServerUrl.replace("host.docker.internal", "localhost");
    }
    const editorConfigRaw =
      (editorNode.editor as Record<string, unknown> | undefined) ||
      (editorNode.config as Record<string, unknown> | undefined) ||
      editorNode;
    const editorConfigNormalized = rewriteOnlyofficeCallbackUrls(editorConfigRaw) as Record<string, unknown>;

    // Force correct ONLYOFFICE editor mode from local metadata (handles backend misclassification).
    const fileExt = (item.fileExtension || extOf(item.title || "")).replace(/^\./, "").toLowerCase();
    const documentType = onlyofficeDocumentTypeForExt(fileExt);
    const normalizedDocument = (editorConfigNormalized.document as Record<string, unknown> | undefined) || {};
    if (fileExt) {
      normalizedDocument.fileType = fileExt;
    }
    editorConfigNormalized.document = normalizedDocument;
    editorConfigNormalized.documentType = documentType;

    const normalizedEditorConfig = (editorConfigNormalized.editorConfig as Record<string, unknown> | undefined) || {};
    normalizedEditorConfig.callbackUrl = onlyofficeRelayContainerCallbackUrl;
    editorConfigNormalized.editorConfig = normalizedEditorConfig;

    const localOnlyofficeJwtSecret =
      (localStorage.getItem("easyvault_onlyoffice_jwt_secret") || ONLYOFFICE_LOCAL_JWT_SECRET_FALLBACK).trim();
    if (localOnlyofficeJwtSecret) {
      editorConfigNormalized.token = await signOnlyofficeConfigToken(editorConfigNormalized, localOnlyofficeJwtSecret);
    }

    setStatus(`ONLYOFFICE: loading API from ${documentServerUrl}`);
    await ensureOnlyofficeApi(documentServerUrl);
    setStatus("ONLYOFFICE: API loaded");

    previewEditBodyEl.classList.add("office-body");
    previewEditPanelEl.classList.add("office-mode");
    previewEditBodyEl.style.height = "100%";
    previewEditBodyEl.innerHTML = `<div id="onlyoffice-editor-host" class="onlyoffice-host"></div>`;
    const hostEl = previewEditBodyEl.querySelector<HTMLDivElement>("#onlyoffice-editor-host");
    if (!hostEl) {
      throw new Error("ONLYOFFICE host not found");
    }
    hostEl.style.height = "100%";
    hostEl.style.width = "100%";

    if (onlyofficeEditorInstance?.destroy) {
      try {
        onlyofficeEditorInstance.destroy();
      } catch {}
    }
    const DocsAPI = (window as unknown as { DocsAPI?: { DocEditor: new (id: string, config: unknown) => { destroy?: () => void } } }).DocsAPI;
    if (!DocsAPI?.DocEditor) {
      throw new Error("ONLYOFFICE API is not available");
    }

    const normalizedEditorConfigForUi = (editorConfigNormalized.editorConfig as Record<string, unknown> | undefined) || {};
    const normalizedCustomization = (normalizedEditorConfigForUi.customization as Record<string, unknown> | undefined) || {};

    setStatus(`ONLYOFFICE: callback via relay ${asString(normalizedEditorConfigForUi.callbackUrl) || onlyofficeRelayContainerCallbackUrl}`);

    const editorConfig = {
      ...editorConfigNormalized,
      width: "100%",
      height: "100%",
      editorConfig: {
        ...normalizedEditorConfigForUi,
        customization: {
          ...normalizedCustomization,
          // Ensure toolbar Save triggers callback status=6 immediately.
          forcesave: true,
        },
      },
      events: {
        ...(editorConfigNormalized.events as Record<string, unknown> | undefined),
        onAppReady: () => setStatus(`ONLYOFFICE ready: ${item.title}`),
        onDocumentStateChange: (evt: { data?: boolean }) => {
          if (evt?.data) setPreviewLiveStatus("document changed (unsaved)");
          else setPreviewLiveStatus("document state clean");
        },
        onRequestPrint: () => setStatus("ONLYOFFICE print requested..."),
        onError: (evt: { data?: { errorDescription?: string } }) =>
          setStatus(`ONLYOFFICE error: ${evt?.data?.errorDescription || "unknown"}`),
        onRequestClose: () => {
          setStatus("ONLYOFFICE editor closed");
          stopOnlyofficeRelayPolling();
          void syncRemoteDelta();
        },
      },
    };

    setStatus("ONLYOFFICE: creating editor");
    onlyofficeEditorInstance = new DocsAPI.DocEditor("onlyoffice-editor-host", editorConfig);
    // ONLYOFFICE occasionally measures too early inside modals; force relayout.
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 250);
    setStatus("ONLYOFFICE: editor mounted");
    await startOnlyofficeRelayPolling();
  } catch (err) {
    setStatus(`ONLYOFFICE launch failed: ${String(err)}`);
  }
}

function openPreviewEditModal(itemId: string, startMode: PreviewMode): void {
  const item = filesItems.find((x) => x.id === itemId);
  if (!item) return;
  previewEditTargetId = item.id;
  previewEditKind = fileKindFromItem(item);
  const adapter = previewEditAdapters[previewEditKind];
  const adapterAllowsEdit = adapter ? adapter.canEdit(toAdapterItem(item)) : true;
  previewEditCanEdit = canEditItem(item) && adapterAllowsEdit;
  previewEditMode = previewEditCanEdit ? startMode : "preview";
  previewEditNoteDraft = item.contentText || item.notes || "";
  previewEditLinkUrlDraft = item.sourceUrl || "";
  previewEditLinkNotesDraft = item.notes || "";
  previewEditImageRotation = 0;
  previewEditImageBrightness = 100;

  previewEditTitleEl.textContent = `${previewEditMode === "edit" ? "Edit" : "Preview"}: ${item.title}`;
  previewEditSubtitleEl.textContent = `${item.itemType}${item.spaceId ? ` • ${item.spaceId === personalSpaceId ? "personal" : "shared"}` : ""}`;
  previewEditLiveStatusEl.classList.remove("hidden");
  previewEditLiveStatusEl.textContent = "Status: opening editor...";
  renderPreviewEditWarning(previewEditCanEdit ? "" : "Read-only: only space owner/editor can edit.");
  renderPreviewEditBody(item);
  bindPreviewEditInputs();
  updatePreviewEditActions(item);
  previewEditModalEl.classList.remove("hidden");
}

async function savePreviewEditChanges(): Promise<void> {
  const item = filesItems.find((x) => x.id === previewEditTargetId);
  if (!item) return;
  if (!previewEditCanEdit) {
    setStatus("read-only: you do not have edit permission");
    return;
  }
  previewEditSaving = true;
  updatePreviewEditActions(item);
  try {
    if (previewEditKind === "note") {
      const baseline = getEntityUpdatedAt("VaultItem", item.id);
      if (!baseline) throw new Error("missing item baseline");
      const saved = await callDesktopSave<Record<string, unknown>>(
        "VaultItem",
        item.id,
        { content_text: previewEditNoteDraft, notes: previewEditNoteDraft },
        baseline
      );
      if (!saved.ok) {
        const copyTitle = `${item.title} (conflict-${Date.now()})`;
        await safeEntityCreate("VaultItem", {
          title: copyTitle,
          item_type: "note",
          folder_id: item.folderId || "",
          space_id: item.spaceId || personalSpaceId || "",
          source: item.itemType === "link" ? "other" : "local_upload",
          content_text: previewEditNoteDraft,
          notes: previewEditNoteDraft,
          tags: item.tags || [],
        });
        setStatus(`conflict detected, saved copy: ${copyTitle}`);
      } else {
        const updated = asString(saved.record.updated_date, asString(saved.record.created_date, item.updatedAtIso || item.createdAtIso));
        filesItems = filesItems.map((x) => (x.id === item.id ? { ...x, contentText: previewEditNoteDraft, notes: previewEditNoteDraft, updatedAtIso: updated } : x));
        setEntityUpdatedAt("VaultItem", item.id, updated);
        setStatus("note saved");
      }
      saveFilesState();
      renderFilesLibrary();
      await syncRemoteDelta();
      closePreviewEditModal();
      return;
    }

    if (previewEditKind === "link") {
      const baseline = getEntityUpdatedAt("VaultItem", item.id);
      if (!baseline) throw new Error("missing item baseline");
      const saved = await callDesktopSave<Record<string, unknown>>(
        "VaultItem",
        item.id,
        { source_url: previewEditLinkUrlDraft, notes: previewEditLinkNotesDraft },
        baseline
      );
      if (!saved.ok) {
        const copyTitle = `${item.title} (conflict-${Date.now()})`;
        await safeEntityCreate("VaultItem", {
          title: copyTitle,
          item_type: "link",
          folder_id: item.folderId || "",
          space_id: item.spaceId || personalSpaceId || "",
          source: "other",
          source_url: previewEditLinkUrlDraft,
          notes: previewEditLinkNotesDraft,
          tags: item.tags || [],
        });
        setStatus(`conflict detected, saved copy: ${copyTitle}`);
      } else {
        const updated = asString(saved.record.updated_date, asString(saved.record.created_date, item.updatedAtIso || item.createdAtIso));
        filesItems = filesItems.map((x) =>
          x.id === item.id ? { ...x, sourceUrl: previewEditLinkUrlDraft, notes: previewEditLinkNotesDraft, updatedAtIso: updated } : x
        );
        setEntityUpdatedAt("VaultItem", item.id, updated);
        setStatus("link saved");
      }
      saveFilesState();
      renderFilesLibrary();
      await syncRemoteDelta();
      closePreviewEditModal();
      return;
    }

    const adapter = previewEditAdapters[previewEditKind];
    if (adapter) {
      const saveResult = await adapter.save({
        item: toAdapterItem(item),
        draft: {
          imageRotation: previewEditImageRotation,
          imageBrightness: previewEditImageBrightness,
        },
        setStatus,
        getAuthToken: () => getAuthToken() || "",
        getUploadToken: () => getPreferredUploadToken() || "",
        checkoutFile,
        downloadFile,
        uploadFileWithToken,
        createNewVersion,
        listVersions,
        sha256Hex,
      });
      if (!saveResult.ok) {
        throw new Error(saveResult.message || "editor save failed");
      }
      const maybeUpdated = saveResult.updatedAtIso || new Date().toISOString();
      filesItems = filesItems.map((x) => (x.id === item.id ? { ...x, updatedAtIso: maybeUpdated } : x));
      setEntityUpdatedAt("VaultItem", item.id, maybeUpdated);
      saveFilesState();
      renderFilesLibrary();
      await syncRemoteDelta();
      setStatus(saveResult.message || "saved");
      closePreviewEditModal();
      return;
    }

    setStatus("No editable renderer available for this item");
  } catch (err) {
    setStatus(`save failed: ${String(err)}`);
  } finally {
    previewEditSaving = false;
    const latest = filesItems.find((x) => x.id === previewEditTargetId);
    if (latest) updatePreviewEditActions(latest);
  }
}

function pushHealthLine(lines: string[], ok: boolean, label: string, detail = ""): void {
  lines.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
}

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setSyncHealthPill(state: "idle" | "running" | "pass" | "fail", atIso = ""): void {
  syncHealthPillEl.classList.remove("state-idle", "state-running", "state-pass", "state-fail");
  if (state === "idle") {
    syncHealthPillEl.classList.add("state-idle");
    syncHealthPillEl.textContent = "Health: not run";
    return;
  }
  if (state === "running") {
    syncHealthPillEl.classList.add("state-running");
    syncHealthPillEl.textContent = "Health: running...";
    return;
  }
  const label = state === "pass" ? "PASS" : "FAIL";
  const when = atIso ? ` @ ${formatTimeShort(atIso)}` : "";
  syncHealthPillEl.classList.add(state === "pass" ? "state-pass" : "state-fail");
  syncHealthPillEl.textContent = `Health: ${label}${when}`;
}

async function waitForCondition(
  predicate: () => boolean,
  attempts: number,
  delayMs: number,
  refresh?: () => Promise<void>
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return true;
    if (refresh) {
      try {
        await refresh();
      } catch {}
    }
    if (predicate()) return true;
    await sleep(delayMs);
  }
  return false;
}

async function runSyncHealthCheck(): Promise<void> {
  if (syncHealthRunning) return;
  if (!canUseRemoteData()) {
    setStatus("sync health check requires login");
    return;
  }

  syncHealthRunning = true;
  syncHealthBtn.disabled = true;
  syncHealthReportEl.textContent = "Running sync health check...";
  setSyncHealthPill("running");
  setStatus("sync health check running...");

  const startedAt = Date.now();
  const lines: string[] = [];
  let createdFolderId = "";
  let createdItemId = "";
  const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
  const folderName = `Desktop Sync Test ${stamp}`;
  let itemTitle = `Desktop Sync Item ${stamp}`;

  try {
    await refreshAllRemoteData();
    pushHealthLine(lines, true, "Baseline remote refresh");

    const folderPayload: Record<string, unknown> = { name: folderName, parent_folder_id: "" };
    if (personalSpaceId) folderPayload.space_id = personalSpaceId;
    const createdFolder = await safeEntityCreate<Record<string, unknown>>("Folder", folderPayload);
    createdFolderId = asString(createdFolder.id);
    pushHealthLine(lines, Boolean(createdFolderId), "Create folder", createdFolderId || "missing id");
    if (!createdFolderId) throw new Error("create folder returned no id");

    await syncRemoteDelta();
    const folderVisible = filesFolders.some((f) => f.id === createdFolderId);
    pushHealthLine(lines, folderVisible, "Folder appears after sync");
    if (!folderVisible) throw new Error("folder missing after sync");

    const itemPayload: Record<string, unknown> = {
      title: itemTitle,
      item_type: "note",
      folder_id: createdFolderId,
      source: "local_upload",
      content_text: "sync health payload",
      tags: ["sync-health-check"],
    };
    if (personalSpaceId) itemPayload.space_id = personalSpaceId;
    const createdItem = await safeEntityCreate<Record<string, unknown>>("VaultItem", itemPayload);
    createdItemId = asString(createdItem.id);
    pushHealthLine(lines, Boolean(createdItemId), "Create item in folder", createdItemId || "missing id");
    if (!createdItemId) throw new Error("create item returned no id");

    await syncRemoteDelta();
    const folderItemVisible = filesItems.some((i) => i.id === createdItemId && i.folderId === createdFolderId);
    pushHealthLine(lines, folderItemVisible, "Item appears in folder after sync");
    if (!folderItemVisible) throw new Error("item missing in folder after sync");

    itemTitle = `${itemTitle} Renamed`;
    const renameBaseline = getEntityUpdatedAt("VaultItem", createdItemId);
    if (!renameBaseline) throw new Error("missing updated_date baseline before rename test");
    const renameWrite = await callDesktopSave<Record<string, unknown>>(
      "VaultItem",
      createdItemId,
      { title: itemTitle },
      renameBaseline
    );
    if (!renameWrite.ok) throw new Error(`rename write conflicted at ${renameWrite.serverUpdatedDate}`);
    const renameUpdatedAt = asString(renameWrite.record.updated_date, asString(renameWrite.record.created_date, ""));
    if (renameUpdatedAt) setEntityUpdatedAt("VaultItem", createdItemId, renameUpdatedAt);
    await syncRemoteDelta();
    const renameVisible = filesItems.some((i) => i.id === createdItemId && i.title === itemTitle);
    pushHealthLine(lines, renameVisible, "External rename propagates to desktop");
    if (!renameVisible) throw new Error("rename not visible after sync");

    const staleUpdatedAt = getEntityUpdatedAt("VaultItem", createdItemId);
    if (!staleUpdatedAt) throw new Error("missing updated_date baseline before conflict test");
    const serverWrite = await callDesktopSave<Record<string, unknown>>(
      "VaultItem",
      createdItemId,
      { notes: `server-edit-${Date.now()}` },
      staleUpdatedAt
    );
    if (!serverWrite.ok) throw new Error(`server write conflicted at ${serverWrite.serverUpdatedDate}`);
    const serverUpdatedAt = asString(serverWrite.record.updated_date, asString(serverWrite.record.created_date, ""));
    if (serverUpdatedAt) setEntityUpdatedAt("VaultItem", createdItemId, serverUpdatedAt);
    const conflict = await callDesktopSave("VaultItem", createdItemId, { notes: "desktop-stale-write" }, staleUpdatedAt);
    const conflictDetected = !conflict.ok && conflict.status === 409;
    pushHealthLine(lines, conflictDetected, "Conflict detection (desktopSave 409)");
    if (!conflictDetected) throw new Error("desktopSave conflict not detected");

    await syncRemoteDelta();

    await deleteRemoteEntity("VaultItem", createdItemId);
    createdItemId = "";
    const deletedItemId = asString(createdItem.id);
    const itemDeleted = await waitForCondition(
      () => !filesItems.some((i) => i.id === deletedItemId),
      8,
      400,
      async () => {
        await refreshFilesFromRemote();
      }
    );
    pushHealthLine(lines, itemDeleted, "Item delete propagates");
    if (!itemDeleted) throw new Error("item still present after delete");

    await deleteRemoteEntity("Folder", createdFolderId);
    createdFolderId = "";
    const deletedFolderId = asString(createdFolder.id);
    const folderDeleted = await waitForCondition(
      () => !filesFolders.some((f) => f.id === deletedFolderId),
      8,
      400,
      async () => {
        await refreshFilesFromRemote();
      }
    );
    pushHealthLine(lines, folderDeleted, "Folder delete propagates");
    if (!folderDeleted) throw new Error("folder still present after delete");

    const durationMs = Date.now() - startedAt;
    lines.unshift(`Sync Health Check: PASS (${durationMs}ms)`);
    setStatus("sync health check passed");
    setSyncHealthPill("pass", new Date().toISOString());
  } catch (err) {
    pushHealthLine(lines, false, "Run error", String(err));
    lines.unshift("Sync Health Check: FAIL");
    setStatus(`sync health check failed: ${String(err)}`);
    setSyncHealthPill("fail", new Date().toISOString());
  } finally {
    if (createdItemId) {
      try {
        await deleteRemoteEntity("VaultItem", createdItemId);
      } catch {}
    }
    if (createdFolderId) {
      try {
        await deleteRemoteEntity("Folder", createdFolderId);
      } catch {}
    }
    try {
      await syncRemoteDelta();
    } catch {}
    const finishedAt = new Date().toISOString();
    syncHealthReportEl.textContent = [`Finished: ${finishedAt}`, ...lines].join("\n");
    syncHealthBtn.disabled = false;
    syncHealthRunning = false;
  }
}

function extractUnsupportedFieldsFromError(err: unknown, payloadKeys: string[]): string[] {
  const text = String(err).toLowerCase();
  if (!text) return [];
  const matches = new Set<string>();
  for (const key of payloadKeys) {
    if (text.includes(`"${key.toLowerCase()}"`) || text.includes(`'${key.toLowerCase()}'`) || text.includes(` ${key.toLowerCase()} `)) {
      matches.add(key);
    }
  }
  if (!text.includes("unknown") && !text.includes("does not exist") && !text.includes("invalid") && !text.includes("column")) {
    return [];
  }
  return Array.from(matches);
}

async function safeEntityCreate<T = Record<string, unknown>>(
  entity: EntityName,
  payload: Record<string, unknown>
): Promise<T> {
  let candidate = sanitizePayload(entity, payload);
  while (true) {
    try {
      return await entityCreate<T>(entity, candidate);
    } catch (err) {
      const unsupported = extractUnsupportedFieldsFromError(err, Object.keys(candidate));
      if (unsupported.length === 0) throw err;
      for (const field of unsupported) unsupportedFieldsByEntity[entity].add(field);
      candidate = sanitizePayload(entity, candidate);
      renderCapabilitiesReport();
      if (Object.keys(candidate).length === 0) throw err;
    }
  }
}

async function safeEntityUpdate(
  entity: EntityName,
  id: string,
  payload: Record<string, unknown>,
  expectedUpdatedAt?: string
): Promise<Record<string, unknown> | null> {
  let candidate = sanitizePayload(entity, payload);
  const lastKnownUpdatedDate = expectedUpdatedAt || getEntityUpdatedAt(entity, id);
  while (true) {
    try {
      if (lastKnownUpdatedDate) {
        const result = await callDesktopSave<Record<string, unknown>>(entity, id, candidate, lastKnownUpdatedDate);
        if (!result.ok) {
          const serverDate = result.serverUpdatedDate || "(unknown)";
          throw new Error(`conflict: record changed on server at ${serverDate}`);
        }
        const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
        if (nextUpdatedAt) setEntityUpdatedAt(entity, id, nextUpdatedAt);
        return result.record;
      }
      await entityUpdate(entity, id, candidate);
      return null;
    } catch (err) {
      const unsupported = extractUnsupportedFieldsFromError(err, Object.keys(candidate));
      if (unsupported.length === 0) throw err;
      for (const field of unsupported) unsupportedFieldsByEntity[entity].add(field);
      candidate = sanitizePayload(entity, candidate);
      renderCapabilitiesReport();
      if (Object.keys(candidate).length === 0) return null;
    }
  }
}

function canUseRemoteData(): boolean {
  return Boolean(getAuthToken());
}

function currentUserEmail(): string {
  return getSavedEmail().trim().toLowerCase();
}

function isOwnedByCurrentUser(row: Record<string, unknown>): boolean {
  const me = currentUserEmail();
  if (!me) return true;
  return asString(row.created_by).toLowerCase() === me;
}

function isNotFoundError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("request failed (404)") || msg.includes("record not found") || msg.includes("not found");
}

function setEntityUpdatedAt(entity: string, id: string, updatedAtIso: string): void {
  if (!id || !updatedAtIso) return;
  const map = remoteUpdatedAtByEntity[entity];
  if (!map) return;
  map.set(id, updatedAtIso);
}

function removeEntityUpdatedAt(entity: string, id: string): void {
  const map = remoteUpdatedAtByEntity[entity];
  if (!map) return;
  map.delete(id);
}

function getEntityUpdatedAt(entity: string, id: string): string {
  const map = remoteUpdatedAtByEntity[entity];
  if (!map) return "";
  return map.get(id) || "";
}

function semverAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map((p) => Number(p));
  const b = minimum.split(".").map((p) => Number(p));
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

type EntitySchemasResponse = {
  version: string;
  app_id: string;
  generated_at: string;
  entities: Record<
    string,
    {
      required: string[];
      properties: Record<string, { type: string }>;
      built_in_fields: Record<string, { type: string }>;
      operations: string[];
    }
  >;
  functions: Array<{ name: string; method: string; payload: object; returns: string; note?: string }>;
  auth: {
    note: string;
    entity_endpoint_pattern: string;
    function_endpoint_pattern: string;
  };
};

function parseEntitySchemasPayload(payload: unknown): EntitySchemasResponse {
  if (!payload || typeof payload !== "object") throw new Error("entitySchemas payload is not an object");
  const obj = payload as Record<string, unknown>;
  if (typeof obj.version !== "string") throw new Error("entitySchemas.version missing");
  if (typeof obj.app_id !== "string") throw new Error("entitySchemas.app_id missing");
  if (typeof obj.generated_at !== "string") throw new Error("entitySchemas.generated_at missing");
  if (!obj.entities || typeof obj.entities !== "object") throw new Error("entitySchemas.entities missing");
  if (!Array.isArray(obj.functions)) throw new Error("entitySchemas.functions missing");
  if (!obj.auth || typeof obj.auth !== "object") throw new Error("entitySchemas.auth missing");

  const entities = obj.entities as Record<string, unknown>;
  for (const [name, rawDef] of Object.entries(entities)) {
    if (!rawDef || typeof rawDef !== "object") throw new Error(`entitySchemas.entities.${name} invalid`);
    const def = rawDef as Record<string, unknown>;
    if (!Array.isArray(def.required)) throw new Error(`entitySchemas.entities.${name}.required missing`);
    if (!def.properties || typeof def.properties !== "object") throw new Error(`entitySchemas.entities.${name}.properties missing`);
    if (!def.built_in_fields || typeof def.built_in_fields !== "object") throw new Error(`entitySchemas.entities.${name}.built_in_fields missing`);
    if (!Array.isArray(def.operations)) throw new Error(`entitySchemas.entities.${name}.operations missing`);
  }

  return obj as unknown as EntitySchemasResponse;
}

async function refreshEntitySchemas(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const rawPayload = await invokeBase44Function<unknown>("entitySchemas", {});
    const payload = parseEntitySchemasPayload(rawPayload);
    if (!semverAtLeast(payload.version, "1.0.0")) {
      throw new Error(`Unsupported entitySchemas version: ${payload.version}`);
    }
    const entities: EntityName[] = ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"];
    for (const entity of entities) {
      const entry = payload.entities[entity];
      if (!entry) {
        schemaFieldsByEntity[entity] = new Set<string>();
        continue;
      }
      schemaFieldsByEntity[entity] = new Set<string>(Object.keys(entry.properties || {}));
    }
    schemaLoadedAt = payload.generated_at;
    schemaVersion = payload.version;
    schemaFunctionCount = payload.functions.length;
    renderCapabilitiesReport();
  } catch (err) {
    setStatus(`entitySchemas parse failed: ${String(err)}`);
  }
}

async function deleteRemoteEntity(entity: "Folder" | "VaultItem" | "EmailItem" | "CalendarEvent" | "Space", id: string): Promise<void> {
  let desktopDeleteErr: unknown = null;
  try {
    await invokeBase44Function("desktopDelete", { entity_name: entity, id });
    return;
  } catch (err) {
    desktopDeleteErr = err;
  }

  try {
    await entityDelete(entity, id);
  } catch (entityDeleteErr) {
    // If either path confirms not-found, consider it converged.
    if (isNotFoundError(desktopDeleteErr) || isNotFoundError(entityDeleteErr)) {
      return;
    }
    throw new Error(
      `desktopDelete failed: ${String(desktopDeleteErr)} | entityDelete fallback failed: ${String(entityDeleteErr)}`
    );
  }
}

async function refreshAccessScope(): Promise<void> {
  try {
    const payload = await invokeBase44Function<{ space_ids?: string[]; personal_space_id?: string }>("getAccessibleSpaces", {});
    accessibleSpaceIds = Array.isArray(payload?.space_ids) ? payload.space_ids : [];
    personalSpaceId = asString(payload?.personal_space_id);
  } catch {
    accessibleSpaceIds = [];
    personalSpaceId = "";
  }
}

function spaceAllowed(spaceId: string): boolean {
  if (accessibleSpaceIds.length === 0) return true;
  return !spaceId || accessibleSpaceIds.includes(spaceId);
}

async function refreshFilesFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  await refreshAccessScope();
  try {
    const [folders, items] = await Promise.all([
      entityList<Record<string, unknown>>("Folder", "-created_date", 500),
      entityList<Record<string, unknown>>("VaultItem", "-updated_date", 1000),
    ]);

    filesFolders = folders
      .filter((row) => spaceAllowed(asString(row.space_id)))
      .map((row) =>
        normalizeFolder({
          id: asString(row.id),
          name: asString(row.name, "Untitled folder"),
          createdAtIso: asString(row.created_date, new Date().toISOString()),
          updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
          isPinned: asBool(row.is_pinned),
          spaceId: asString(row.space_id),
          createdBy: asString(row.created_by),
        })
      );
    remoteUpdatedAtByEntity.Folder.clear();
    for (const folder of filesFolders) {
      setEntityUpdatedAt("Folder", folder.id, folder.updatedAtIso || folder.createdAtIso);
    }

    const nextItems = items
      .filter((row) => spaceAllowed(asString(row.space_id)))
      .map((row) =>
        normalizeItem({
          id: asString(row.id),
          title: asString(row.title, "Untitled item"),
          itemType: (asString(row.item_type, "note") as FileItemType),
          folderId: asString(row.folder_id),
          createdAtIso: asString(row.created_date, asString(row.updated_date, new Date().toISOString())),
          updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
          notes: asString(row.notes),
          tags: asArray(row.tags),
          isPinned: asBool(row.is_pinned),
          isFavorite: asBool(row.is_favorite),
          storedFileUrl: asString(row.stored_file_url),
          sourceUrl: asString(row.source_url),
          localPath: asString(row.local_path),
          fileExtension: asString(row.file_extension),
          contentText: asString(row.content_text),
          spaceId: asString(row.space_id),
          createdBy: asString(row.created_by),
        })
      );
    void cleanupOnlyofficeRelayTempItems(nextItems);
    filesItems = nextItems.filter((x) => !isOnlyofficeRelayTempTitle(x.title));
    remoteUpdatedAtByEntity.VaultItem.clear();
    for (const item of filesItems) {
      setEntityUpdatedAt("VaultItem", item.id, item.updatedAtIso || item.createdAtIso);
    }

    saveFilesState();
    renderFilesLibrary();
  } catch (err) {
    setStatus(`remote files sync failed: ${String(err)}`);
  }
}

async function refreshEmailFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("EmailItem", "-received_at", 200);
    remoteEmails = data.filter((row) => isOwnedByCurrentUser(row));
    remoteUpdatedAtByEntity.EmailItem.clear();
    for (const row of remoteEmails) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) setEntityUpdatedAt("EmailItem", id, updated);
    }
    renderEmailList();
  } catch (err) {
    setStatus(`email sync failed: ${String(err)}`);
  }
}

async function refreshCalendarFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("CalendarEvent", "start_time", 300);
    remoteEvents = data.filter((row) => isOwnedByCurrentUser(row));
    remoteUpdatedAtByEntity.CalendarEvent.clear();
    for (const row of remoteEvents) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) setEntityUpdatedAt("CalendarEvent", id, updated);
    }
    renderCalendarAgenda();
  } catch (err) {
    setStatus(`calendar sync failed: ${String(err)}`);
  }
}

async function refreshVaultFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("GatherPack", "-created_date", 100);
    remotePacks = data.filter((row) => isOwnedByCurrentUser(row));
    remoteUpdatedAtByEntity.GatherPack.clear();
    for (const row of remotePacks) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) setEntityUpdatedAt("GatherPack", id, updated);
    }
    renderVaultPacks();
  } catch (err) {
    setStatus(`vault sync failed: ${String(err)}`);
  }
}

async function refreshSharedFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const spaces = await entityFilter<Record<string, unknown>>("Space", { space_type: "shared" }, "-created_date", 100);
    const me = currentUserEmail();
    remoteSpaces = spaces.filter((row) => {
      if (!spaceAllowed(asString(row.id))) return false;
      if (!me) return true;
      if (asString(row.created_by).toLowerCase() === me) return true;
      const members = row.members;
      if (!Array.isArray(members)) return false;
      return members.some((m) => m && typeof m === "object" && asString((m as Record<string, unknown>).email).toLowerCase() === me);
    });
    remoteUpdatedAtByEntity.Space.clear();
    for (const row of remoteSpaces) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) setEntityUpdatedAt("Space", id, updated);
    }
    renderSharedList();
  } catch (err) {
    setStatus(`shared sync failed: ${String(err)}`);
  }
}

async function refreshDropzoneFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const items = await entityFilter<Record<string, unknown>>("VaultItem", { source: "local_upload" }, "-created_date", 30);
    remoteDropzoneItems = items.filter((row) => spaceAllowed(asString(row.space_id)) && isOwnedByCurrentUser(row));
    renderDropzoneRemoteList();
  } catch (err) {
    setStatus(`dropzone sync failed: ${String(err)}`);
  }
}

function renderEmailList(): void {
  if (remoteEmails.length === 0) {
    emailListEl.classList.add("hidden");
    return;
  }
  emailListEl.classList.remove("hidden");
  emailListEl.innerHTML = remoteEmails
    .slice(0, 40)
    .map((row) => {
      const id = asString(row.id);
      const subject = asString(row.subject, "(no subject)");
      const from = asString(row.from_name, asString(row.from_address, "unknown"));
      const snippet = asString(row.snippet);
      const important = asBool(row.is_important);
      const importantAction = isFieldSupported("EmailItem", "is_important")
        ? `<button data-action="important">${important ? "Unmark Important" : "Mark Important"}</button>`
        : "";
      return `
      <article class="file-row group" data-entity="EmailItem" data-entity-id="${id}">
        <div class="file-row-icon">✉</div>
        <div class="file-row-body">
          <p class="file-row-title">${subject}</p>
          <p class="file-row-sub">${from}${snippet ? ` • ${snippet.slice(0, 60)}` : ""}${important ? " • important" : ""}</p>
        </div>
        <div class="row-menu">
          <button class="row-menu-btn" data-target-kind="item" data-target-id="${id}" data-entity="EmailItem" aria-label="More">⋮</button>
          <div class="row-menu-dropdown">
            <button data-action="manage">Manage</button>
            ${importantAction}
            <hr />
            <button data-action="delete" class="danger">Delete</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  bindRowMenus();
}

function renderCalendarAgenda(): void {
  const upcoming = remoteEvents
    .filter((row) => {
      const dt = asString(row.start_time);
      return !dt || new Date(dt).getTime() >= Date.now() - 86400000;
    })
    .slice(0, 30);

  if (upcoming.length === 0) {
    calendarAgendaEl.innerHTML = `<div class="dash-card"><p>No events yet</p></div>`;
    return;
  }

  calendarAgendaEl.innerHTML = upcoming
    .map((row) => {
      const id = asString(row.id);
      const title = asString(row.title, "Untitled event");
      const when = asString(row.start_time, "");
      const location = asString(row.location, "");
      const important = asBool(row.is_important);
      const importantAction = isFieldSupported("CalendarEvent", "is_important")
        ? `<button data-action="important">${important ? "Unmark Important" : "Mark Important"}</button>`
        : "";
      return `
      <article class="file-row group" data-entity="CalendarEvent" data-entity-id="${id}">
        <div class="file-row-icon">☷</div>
        <div class="file-row-body">
          <p class="file-row-title">${title}</p>
          <p class="file-row-sub">${when}${location ? ` • ${location}` : ""}${important ? " • important" : ""}</p>
        </div>
        <div class="row-menu">
          <button class="row-menu-btn" data-target-kind="item" data-target-id="${id}" data-entity="CalendarEvent" aria-label="More">⋮</button>
          <div class="row-menu-dropdown">
            <button data-action="manage">Manage</button>
            ${importantAction}
            <hr />
            <button data-action="delete" class="danger">Delete</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  bindRowMenus();
}

function renderVaultPacks(): void {
  if (remotePacks.length === 0) {
    vaultPacksEl.innerHTML = `<div class="dash-card"><p>No saved packs yet</p></div>`;
    return;
  }
  vaultPacksEl.innerHTML = remotePacks
    .slice(0, 30)
    .map((row) => {
      const title = asString(row.title, "Untitled pack");
      const topic = asString(row.topic, "");
      const count = row.item_count ?? 0;
      return `<article class="file-row"><div class="file-row-icon">✧</div><div class="file-row-body"><p class="file-row-title">${title}</p><p class="file-row-sub">${topic} • ${count} items</p></div></article>`;
    })
    .join("");
}

function renderSharedList(): void {
  if (remoteSpaces.length === 0) {
    sharedListEl.innerHTML = `<div class="dash-card"><p>No shared spaces yet</p></div>`;
    return;
  }
  sharedListEl.innerHTML = remoteSpaces
    .slice(0, 40)
    .map((row) => {
      const id = asString(row.id);
      const name = asString(row.name, "Untitled space");
      const members = Array.isArray(row.members) ? row.members.length : 0;
      return `
      <article class="file-row group" data-entity="Space" data-entity-id="${id}">
        <div class="file-row-icon">◌</div>
        <div class="file-row-body">
          <p class="file-row-title">${name}</p>
          <p class="file-row-sub">${members} members</p>
        </div>
        <div class="row-menu">
          <button class="row-menu-btn" data-target-kind="item" data-target-id="${id}" data-entity="Space" aria-label="More">⋮</button>
          <div class="row-menu-dropdown">
            <button data-action="manage">Manage</button>
            <hr />
            <button data-action="delete" class="danger">Delete</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  bindRowMenus();
}

function renderDropzoneRemoteList(): void {
  if (remoteDropzoneItems.length === 0) {
    dropzoneRemoteListEl.innerHTML = `<div class="dash-card"><p>No recent uploads yet</p></div>`;
    return;
  }
  dropzoneRemoteListEl.innerHTML = remoteDropzoneItems
    .slice(0, 12)
    .map((row) => {
      const title = asString(row.title, "Untitled file");
      const created = asString(row.created_date, "");
      return `<article class="file-row"><div class="file-row-icon">⤴</div><div class="file-row-body"><p class="file-row-title">${title}</p><p class="file-row-sub">${created}</p></div></article>`;
    })
    .join("");
}

async function refreshAllRemoteData(): Promise<void> {
  if (!canUseRemoteData()) return;
  await refreshEntitySchemas();
  await Promise.all([
    refreshFilesFromRemote(),
    refreshEmailFromRemote(),
    refreshCalendarFromRemote(),
    refreshVaultFromRemote(),
    refreshSharedFromRemote(),
    refreshDropzoneFromRemote(),
  ]);
  lastDeltaSyncIso = new Date().toISOString();
  renderCapabilitiesReport();
}

function upsertById(rows: Record<string, unknown>[], nextRow: Record<string, unknown>): Record<string, unknown>[] {
  const id = asString(nextRow.id);
  if (!id) return rows;
  const idx = rows.findIndex((r) => asString(r.id) === id);
  if (idx < 0) return [nextRow, ...rows];
  const copy = rows.slice();
  copy[idx] = nextRow;
  return copy;
}

function applyFolderUpdate(row: Record<string, unknown>): void {
  if (!spaceAllowed(asString(row.space_id))) return;
  const id = asString(row.id);
  if (!id) return;
  const next = normalizeFolder({
    id,
    name: asString(row.name, "Untitled folder"),
    createdAtIso: asString(row.created_date, new Date().toISOString()),
    updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
    isPinned: asBool(row.is_pinned),
  });
  const idx = filesFolders.findIndex((f) => f.id === id);
  if (idx < 0) filesFolders.unshift(next);
  else filesFolders[idx] = next;
  setEntityUpdatedAt("Folder", id, next.updatedAtIso || next.createdAtIso);
}

function applyVaultItemUpdate(row: Record<string, unknown>): void {
  if (!spaceAllowed(asString(row.space_id))) return;
  const id = asString(row.id);
  if (!id) return;
  const next = normalizeItem({
    id,
    title: asString(row.title, "Untitled item"),
    itemType: asString(row.item_type, "note") as FileItemType,
    folderId: asString(row.folder_id),
    createdAtIso: asString(row.created_date, new Date().toISOString()),
    updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
    notes: asString(row.notes),
    tags: asArray(row.tags),
    isPinned: asBool(row.is_pinned),
    isFavorite: asBool(row.is_favorite),
    storedFileUrl: asString(row.stored_file_url),
    sourceUrl: asString(row.source_url),
    localPath: asString(row.local_path),
    fileExtension: asString(row.file_extension),
    contentText: asString(row.content_text),
    spaceId: asString(row.space_id),
    createdBy: asString(row.created_by),
  });
  const idx = filesItems.findIndex((i) => i.id === id);
  if (idx < 0) filesItems.unshift(next);
  else filesItems[idx] = next;
  if (asString(row.source) === "local_upload") {
    remoteDropzoneItems = upsertById(remoteDropzoneItems, row);
  }
  setEntityUpdatedAt("VaultItem", id, next.updatedAtIso || next.createdAtIso);
}

function applyEmailUpdate(row: Record<string, unknown>): void {
  if (!isOwnedByCurrentUser(row)) return;
  const id = asString(row.id);
  if (!id) return;
  remoteEmails = upsertById(remoteEmails, row);
  const updated = asString(row.updated_date, asString(row.created_date, ""));
  if (updated) setEntityUpdatedAt("EmailItem", id, updated);
}

function applyEventUpdate(row: Record<string, unknown>): void {
  if (!isOwnedByCurrentUser(row)) return;
  const id = asString(row.id);
  if (!id) return;
  remoteEvents = upsertById(remoteEvents, row);
  const updated = asString(row.updated_date, asString(row.created_date, ""));
  if (updated) setEntityUpdatedAt("CalendarEvent", id, updated);
}

function applySpaceUpdate(row: Record<string, unknown>): void {
  const me = currentUserEmail();
  if (me) {
    const createdByMe = asString(row.created_by).toLowerCase() === me;
    const members = Array.isArray(row.members) ? row.members : [];
    const isMember = members.some((m) => m && typeof m === "object" && asString((m as Record<string, unknown>).email).toLowerCase() === me);
    if (!createdByMe && !isMember) return;
  }
  const id = asString(row.id);
  if (!id) return;
  remoteSpaces = upsertById(remoteSpaces, row);
  const updated = asString(row.updated_date, asString(row.created_date, ""));
  if (updated) setEntityUpdatedAt("Space", id, updated);
}

function applyPackUpdate(row: Record<string, unknown>): void {
  if (!isOwnedByCurrentUser(row)) return;
  const id = asString(row.id);
  if (!id) return;
  remotePacks = upsertById(remotePacks, row);
  const updated = asString(row.updated_date, asString(row.created_date, ""));
  if (updated) setEntityUpdatedAt("GatherPack", id, updated);
}

function applyDeleteByEntity(entityName: string, id: string): void {
  if (!id) return;
  removeEntityUpdatedAt(entityName, id);
  if (entityName === "Folder") {
    filesFolders = filesFolders.filter((f) => f.id !== id);
    filesItems = filesItems.map((item) => (item.folderId === id ? { ...item, folderId: "" } : item));
    if (activeFolderId === id) activeFolderId = "";
    return;
  }
  if (entityName === "VaultItem") {
    filesItems = filesItems.filter((i) => i.id !== id);
    remoteDropzoneItems = remoteDropzoneItems.filter((r) => asString(r.id) !== id);
    return;
  }
  if (entityName === "EmailItem") {
    remoteEmails = remoteEmails.filter((r) => asString(r.id) !== id);
    return;
  }
  if (entityName === "CalendarEvent") {
    remoteEvents = remoteEvents.filter((r) => asString(r.id) !== id);
    return;
  }
  if (entityName === "Space") {
    remoteSpaces = remoteSpaces.filter((r) => asString(r.id) !== id);
    return;
  }
  if (entityName === "GatherPack") {
    remotePacks = remotePacks.filter((r) => asString(r.id) !== id);
  }
}

function applyDeltaChanges(changes: Record<string, { updated?: Record<string, unknown>[]; deleted?: Array<{ record_id?: string }> }>): void {
  const up = (entity: string) => Array.isArray(changes?.[entity]?.updated) ? changes[entity].updated! : [];
  const del = (entity: string) => Array.isArray(changes?.[entity]?.deleted) ? changes[entity].deleted! : [];

  for (const row of up("Folder")) applyFolderUpdate(row);
  for (const row of up("VaultItem")) applyVaultItemUpdate(row);
  for (const row of up("EmailItem")) applyEmailUpdate(row);
  for (const row of up("CalendarEvent")) applyEventUpdate(row);
  for (const row of up("Space")) applySpaceUpdate(row);
  for (const row of up("GatherPack")) applyPackUpdate(row);

  for (const entity of ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"]) {
    for (const row of del(entity)) {
      const id = asString(row.record_id);
      if (id) applyDeleteByEntity(entity, id);
    }
  }
}

async function syncRemoteDelta(): Promise<void> {
  if (!canUseRemoteData()) return;
  if (!lastDeltaSyncIso) {
    await refreshAllRemoteData();
    return;
  }
  try {
    let page = 0;
    let hasMore = true;
    let serverTime = "";
    while (hasMore) {
      const response = await callDeltaSync(lastDeltaSyncIso, ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"], page);
      const changes = (response?.changes || {}) as Record<string, { updated?: Record<string, unknown>[]; deleted?: Array<{ record_id?: string }> }>;
      applyDeltaChanges(changes);
      serverTime = asString(response?.server_time, serverTime);
      hasMore = Boolean(response?.pagination?.has_more);
      page += 1;
    }
    if (serverTime) lastDeltaSyncIso = serverTime;
    else lastDeltaSyncIso = new Date().toISOString();
    saveFilesState();
    renderFilesLibrary();
    renderEmailList();
    renderCalendarAgenda();
    renderSharedList();
    renderVaultPacks();
    renderDropzoneRemoteList();
    renderCapabilitiesReport();
  } catch (err) {
    setStatus(`delta sync failed, fallback full refresh: ${String(err)}`);
    await refreshAllRemoteData();
  }
}

const ui: UiCallbacks = {
  onStatus: setStatus,
  onResult: setResult,
  onCurrentFile: setCurrentFile,
  onLastSync: setLastSync,
};

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function onlyofficeDocumentTypeForExt(ext: string): "word" | "cell" | "slide" {
  const e = (ext || "").toLowerCase();
  if (e === "xlsx" || e === "xls" || e === "xlsm" || e === "xlsb" || e === "csv") return "cell";
  if (e === "pptx" || e === "ppt" || e === "pptm" || e === "ppsx" || e === "odp") return "slide";
  return "word";
}

function isOnlyofficeRelayTempTitle(title: string): boolean {
  const t = (title || "").trim().toLowerCase();
  return (
    t.startsWith("onlyoffice_") &&
    (t.endsWith(".docx") || t.endsWith(".xlsx") || t.endsWith(".pptx"))
  );
}

async function cleanupOnlyofficeRelayTempItems(items: DesktopItem[]): Promise<void> {
  const token = getPreferredUploadToken() || getAuthToken();
  if (!token) return;
  const tempItems = items.filter((x) => isOnlyofficeRelayTempTitle(x.title));
  if (tempItems.length === 0) return;
  let removed = 0;
  let failed = 0;
  for (const item of tempItems) {
    if (!item.id || relayTempCleanupInFlight.has(item.id)) continue;
    relayTempCleanupInFlight.add(item.id);
    try {
      await invokeBase44Function("desktopDelete", { entity_name: "VaultItem", id: item.id }, token);
      removed += 1;
    } catch {
      failed += 1;
    } finally {
      relayTempCleanupInFlight.delete(item.id);
    }
  }
  if (removed > 0 || failed > 0) {
    setStatus(`relay temp cleanup: removed ${removed}, failed ${failed}`);
  }
}

function formatRelativeTime(iso: string): string {
  const created = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - created);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fillFolderSelect(): void {
  const options = ['<option value="">Root</option>']
    .concat(filesFolders.map((folder) => `<option value="${folder.id}">${folder.name}</option>`))
    .join("");
  newParentFolderSelect.innerHTML = options;
}

function closeContextMenus(): void {
  const openMenus = Array.from(document.querySelectorAll<HTMLElement>(".row-menu-dropdown.open"));
  for (const menu of openMenus) {
    menu.classList.remove("open");
  }
}

function closeManageModal(): void {
  manageModalEl.classList.add("hidden");
  manageTarget = null;
  manageTargetBaselineUpdatedAt = "";
}

function openManageModal(target: ActionTarget): void {
  manageTarget = target;
  manageTargetBaselineUpdatedAt = getEntityUpdatedAt(target.entity, target.id);
  if (target.kind === "folder") {
    const folder = filesFolders.find((x) => x.id === target.id);
    if (!folder) return;
    manageModalTitleEl.textContent = "Manage Folder";
    manageNameInput.value = folder.name;
    manageNotesLabelEl.classList.add("hidden");
    manageNotesInput.classList.add("hidden");
    manageNotesInput.value = "";
    manageTagsLabelEl.classList.add("hidden");
    manageTagsInput.classList.add("hidden");
    manageTagsInput.value = "";
  } else if (target.entity === "VaultItem") {
    const item = filesItems.find((x) => x.id === target.id);
    if (!item) return;
    manageModalTitleEl.textContent = "Manage Item";
    manageNameInput.value = item.title;
    manageNotesLabelEl.classList.remove("hidden");
    manageNotesInput.classList.remove("hidden");
    manageNotesInput.value = item.notes || "";
    manageTagsLabelEl.classList.remove("hidden");
    manageTagsInput.classList.remove("hidden");
    manageTagsInput.value = item.tags.join(", ");
  } else if (target.entity === "EmailItem") {
    const row = remoteEmails.find((x) => asString(x.id) === target.id);
    if (!row) return;
    manageModalTitleEl.textContent = "Manage Email";
    manageNameInput.value = asString(row.subject);
    manageNotesLabelEl.classList.remove("hidden");
    manageNotesInput.classList.remove("hidden");
    manageNotesInput.value = asString(row.snippet);
    manageTagsLabelEl.classList.remove("hidden");
    manageTagsInput.classList.remove("hidden");
    manageTagsInput.value = asArray(row.tags).join(", ");
  } else if (target.entity === "CalendarEvent") {
    const row = remoteEvents.find((x) => asString(x.id) === target.id);
    if (!row) return;
    manageModalTitleEl.textContent = "Manage Event";
    manageNameInput.value = asString(row.title);
    manageNotesLabelEl.classList.remove("hidden");
    manageNotesInput.classList.remove("hidden");
    manageNotesInput.value = asString(row.description);
    manageTagsLabelEl.classList.remove("hidden");
    manageTagsInput.classList.remove("hidden");
    manageTagsInput.value = asArray(row.tags).join(", ");
  } else {
    const row = remoteSpaces.find((x) => asString(x.id) === target.id);
    if (!row) return;
    manageModalTitleEl.textContent = "Manage Space";
    manageNameInput.value = asString(row.name);
    manageNotesLabelEl.classList.remove("hidden");
    manageNotesInput.classList.remove("hidden");
    manageNotesInput.value = asString(row.description);
    manageTagsLabelEl.classList.add("hidden");
    manageTagsInput.classList.add("hidden");
    manageTagsInput.value = "";
  }
  manageModalEl.classList.remove("hidden");
}

function closeDeleteModal(force = false): void {
  if (deleteModalConfirmBtn.disabled && !force) return;
  deleteModalEl.classList.add("hidden");
  deleteTarget = null;
  deleteModalConfirmBtn.disabled = false;
  deleteModalCancelBtn.disabled = false;
  deleteModalConfirmBtn.textContent = deleteModalConfirmDefaultLabel;
}

function closeFileActionModal(): void {
  fileActionModalEl.classList.add("hidden");
  fileActionTargetId = "";
}

function openFileActionModal(itemId: string): void {
  const item = filesItems.find((x) => x.id === itemId);
  if (!item) return;
  fileActionTargetId = itemId;
  fileActionTitleEl.textContent = item.title || "File actions";
  const canEdit = canEditItem(item);
  fileActionEditAppBtn.disabled = !canEdit;
  fileActionManageBtn.disabled = !canEdit;
  fileActionModalEl.classList.remove("hidden");
}

function openDeleteModal(target: ActionTarget): void {
  deleteTarget = target;
  if (target.kind === "folder") {
    const folder = filesFolders.find((x) => x.id === target.id);
    deleteModalTextEl.textContent = `Delete folder "${folder?.name || ""}"? Items in it will move to root.`;
  } else if (target.entity === "VaultItem") {
    const item = filesItems.find((x) => x.id === target.id);
    deleteModalTextEl.textContent = `Delete item "${item?.title || ""}"? This cannot be undone.`;
  } else if (target.entity === "EmailItem") {
    const row = remoteEmails.find((x) => asString(x.id) === target.id);
    deleteModalTextEl.textContent = `Delete email "${asString(row?.subject, "")}"? This cannot be undone.`;
  } else if (target.entity === "CalendarEvent") {
    const row = remoteEvents.find((x) => asString(x.id) === target.id);
    deleteModalTextEl.textContent = `Delete event "${asString(row?.title, "")}"? This cannot be undone.`;
  } else {
    const row = remoteSpaces.find((x) => asString(x.id) === target.id);
    deleteModalTextEl.textContent = `Delete space "${asString(row?.name, "")}"? This cannot be undone.`;
  }
  deleteModalEl.classList.remove("hidden");
}

function buildFolderMenu(folder: DesktopFolder): string {
  if (folder.isDeleting) {
    return `<button disabled>Deleting...</button>`;
  }
  const pinAction = isFieldSupported("Folder", "is_pinned")
    ? `<button data-action="pin">${folder.isPinned ? "Unpin" : "Pin"}</button>`
    : "";
  const favoriteAction = isFieldSupported("Folder", "is_favorite")
    ? `<button data-action="favorite">${folder.isFavorite ? "Unfavorite" : "Favorite"}</button>`
    : "";
  return `
    <button data-action="manage">Manage</button>
    ${pinAction}
    ${favoriteAction}
    <hr />
    <button data-action="delete" class="danger">Delete</button>
  `;
}

function buildItemMenu(item: DesktopItem): string {
  if (item.isDeleting) {
    return `<button disabled>Deleting...</button>`;
  }
  const canEdit = canEditItem(item);
  const kind = fileKindFromItem(item);
  const isPdf = item.title.toLowerCase().endsWith(".pdf");
  const desktopEdit = item.itemType === "file_reference";
  const previewAction = kind !== "other" ? '<button data-action="preview">Preview</button>' : "";
  const nativeAction = item.storedFileUrl || item.localPath ? '<button data-action="open-native">Open Native</button>' : "";
  const pinAction = canEdit && isFieldSupported("VaultItem", "is_pinned")
    ? `<button data-action="pin">${item.isPinned ? "Unpin" : "Pin"}</button>`
    : "";
  const favoriteAction = canEdit && isFieldSupported("VaultItem", "is_favorite")
    ? `<button data-action="favorite">${item.isFavorite ? "Unfavorite" : "Favorite"}</button>`
    : "";
  const importantAction =
    canEdit && item.itemType === "email_reference" && isFieldSupported("VaultItem", "is_important")
      ? `<button data-action="important">${item.isImportant ? "Unmark Important" : "Mark Important"}</button>`
      : "";
  const manageAction = canEdit ? '<button data-action="manage">Manage</button>' : "";
  const deleteAction = canEdit ? '<button data-action="delete" class="danger">Delete</button>' : "";
  return `
    ${previewAction}
    ${nativeAction}
    <button data-action="edit-app" ${canEdit ? "" : "disabled"}>Edit in App</button>
    ${(previewAction || nativeAction) ? "<hr />" : ""}
    ${isPdf ? '<button data-action="edit-pdf">Edit in EasyVault</button>' : ""}
    ${desktopEdit ? '<button data-action="edit-desktop">Edit with Desktop</button>' : ""}
    ${manageAction}
    ${pinAction}
    ${favoriteAction}
    ${importantAction}
    ${deleteAction ? "<hr />" : ""}
    ${deleteAction}
  `;
}

function getPreviewUrlForItem(item: DesktopItem): string {
  if (item.itemType === "link" && item.sourceUrl) return item.sourceUrl;
  if (item.storedFileUrl) return item.storedFileUrl;
  return "";
}

async function openNativeForItem(item: DesktopItem): Promise<void> {
  if (item.localPath) {
    await openPath(item.localPath);
    return;
  }
  if (!item.storedFileUrl) {
    throw new Error("No stored file URL available");
  }
  const bytes = await downloadFile(item.storedFileUrl);
  const savedPath = await invoke<string>("save_file_to_workspace", {
    fileId: item.id,
    filename: item.title || `${item.id}.${item.fileExtension || "bin"}`,
    bytes: Array.from(bytes),
  });
  await openPath(savedPath);
}

function renderFilesLibrary(): void {
  const cleanItems = filesItems.filter((item) => !isOnlyofficeRelayTempTitle(item.title));
  if (filesFolders.length === 0) {
    filesFoldersEl.innerHTML = `<div class="dash-card"><p>No folders yet</p></div>`;
  } else {
    filesFoldersEl.innerHTML = [
      `<article class="folder-card ${activeFolderId === "" ? "active" : ""}" data-folder-id="">
        <div class="folder-icon">📁</div>
        <div class="folder-name">All Files</div>
      </article>`,
      ...filesFolders
        .map(
          (folder) => `
      <article class="folder-card group ${activeFolderId === folder.id ? "active" : ""}" data-folder-id="${folder.id}">
        <div class="folder-main">
          <div class="folder-icon">📁</div>
          <div class="folder-name">${folder.name}</div>
        </div>
        <div class="row-menu">
          <button class="row-menu-btn" data-target-kind="folder" data-target-id="${folder.id}" data-entity="Folder" aria-label="More">⋮</button>
          <div class="row-menu-dropdown">${buildFolderMenu(folder)}</div>
        </div>
      </article>
    `
        ),
    ].join("");

    const folderCards = Array.from(filesFoldersEl.querySelectorAll<HTMLElement>(".folder-card[data-folder-id]"));
    for (const card of folderCards) {
      card.addEventListener("click", () => {
        activeFolderId = card.dataset.folderId ?? "";
        renderFilesLibrary();
      });
    }
  }

  const itemsWithFolder = cleanItems
    .slice()
    .sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1))
    .map((item) => {
      const folder = filesFolders.find((f) => f.id === item.folderId);
      return { ...item, folderName: folder?.name || "root" };
    });

  const scopedItems =
    activeFolderId === "" ? itemsWithFolder : itemsWithFolder.filter((item) => item.folderId === activeFolderId);

  if (activeFolderId === "") {
    filesHeadRowEl.classList.remove("hidden");
    filesEditSessionEl.classList.remove("hidden");
    filesRootViewEl.classList.remove("hidden");
    filesFolderViewEl.classList.add("hidden");
    filesScopeLabelEl.textContent = "Showing all folders";
  } else {
    const currentFolder = filesFolders.find((f) => f.id === activeFolderId);
    filesHeadRowEl.classList.add("hidden");
    filesEditSessionEl.classList.add("hidden");
    filesRootViewEl.classList.add("hidden");
    filesFolderViewEl.classList.remove("hidden");
    filesFolderTitleEl.textContent = currentFolder?.name || "Folder";
    filesFolderCrumbNameEl.textContent = currentFolder?.name || "Folder";
    filesScopeLabelEl.textContent = `Showing folder: ${currentFolder?.name || "Unknown"}`;
  }

  const targetContainer = activeFolderId === "" ? filesItemsEl : filesFolderItemsEl;

  if (scopedItems.length === 0) {
    if (activeFolderId !== "") {
      targetContainer.innerHTML = `
      <div class="files-empty-state">
        <div class="files-empty-icon">📁</div>
        <h3>This folder is empty</h3>
        <p>Upload files or create a new item to get started</p>
      </div>`;
    } else {
      targetContainer.innerHTML = `<div class="dash-card"><p>No files or items in this folder yet</p></div>`;
    }
  } else {
    targetContainer.innerHTML = scopedItems
      .map(
        (item) => `
      <article class="file-row group file-row-clickable" data-file-id="${item.id}">
        <div class="file-row-icon">${item.isUploading ? "⏳" : item.itemType === "uploaded_file" || item.itemType === "managed_file" ? "📄" : "◻"}</div>
        <div class="file-row-body">
          <p class="file-row-title">${item.title}</p>
          <p class="file-row-sub">
            ${item.itemType} • ${item.folderName} • ${formatRelativeTime(item.createdAtIso)}
            ${item.isUploading ? " • uploading..." : ""}${item.isDeleting ? " • deleting..." : ""}${item.isPinned ? " • pinned" : ""}${item.isFavorite ? " • favorite" : ""}${item.isImportant ? " • important" : ""}
          </p>
        </div>
        <div class="row-menu">
          <button class="row-menu-btn" data-target-kind="item" data-target-id="${item.id}" data-entity="VaultItem" aria-label="More">⋮</button>
          <div class="row-menu-dropdown">${buildItemMenu(item)}</div>
        </div>
      </article>
    `
      )
      .join("");
  }

  const fileRows = Array.from(targetContainer.querySelectorAll<HTMLElement>(".file-row-clickable[data-file-id]"));
  for (const row of fileRows) {
    row.addEventListener("click", () => {
      const itemId = row.dataset.fileId || "";
      if (!itemId) return;
      openFileActionModal(itemId);
    });
  }

  bindRowMenus();
}

function bindRowMenus(): void {
  const menuButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".row-menu-btn"));
  for (const btn of menuButtons) {
    if (btn.dataset.bound === "1") continue;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling as HTMLElement | null;
      if (!menu) return;
      const isOpen = menu.classList.contains("open");
      closeContextMenus();
      if (!isOpen) menu.classList.add("open");
    });
  }

  const menuItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".row-menu-dropdown button[data-action]"));
  for (const actionBtn of menuItems) {
    if (actionBtn.dataset.bound === "1") continue;
    actionBtn.dataset.bound = "1";
    actionBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = actionBtn.dataset.action || "";
      const menu = actionBtn.closest(".row-menu-dropdown");
      const trigger = menu?.previousElementSibling as HTMLButtonElement | null;
      const kind = trigger?.dataset.targetKind as "folder" | "item" | undefined;
      const id = trigger?.dataset.targetId;
      const entity = trigger?.dataset.entity as ActionTarget["entity"] | undefined;
      if (!kind || !id || !entity) return;
      closeContextMenus();
      if (action === "manage") {
        openManageModal(
          kind === "folder"
            ? { kind, id, entity: "Folder" }
            : { kind: "item", id, entity: entity as "VaultItem" | "EmailItem" | "CalendarEvent" | "Space" }
        );
      } else if (action === "delete") {
        openDeleteModal(
          kind === "folder"
            ? { kind, id, entity: "Folder" }
            : { kind: "item", id, entity: entity as "VaultItem" | "EmailItem" | "CalendarEvent" | "Space" }
        );
      } else if (action === "pin") {
        if (kind === "folder") {
          const prev = filesFolders.find((f) => f.id === id)?.isPinned ?? false;
          filesFolders = filesFolders.map((f) => (f.id === id ? { ...f, isPinned: !f.isPinned } : f));
          if (canUseRemoteData()) {
            try {
              await safeEntityUpdate("Folder", id, { is_pinned: filesFolders.find((f) => f.id === id)?.isPinned });
              if (!isFieldSupported("Folder", "is_pinned")) {
                filesFolders = filesFolders.map((f) => (f.id === id ? { ...f, isPinned: prev } : f));
              }
            } catch {}
          }
        } else {
          if (entity === "VaultItem") {
            const prev = filesItems.find((i) => i.id === id)?.isPinned ?? false;
            filesItems = filesItems.map((i) => (i.id === id ? { ...i, isPinned: !i.isPinned } : i));
            if (canUseRemoteData()) {
              try {
                await safeEntityUpdate("VaultItem", id, { is_pinned: filesItems.find((i) => i.id === id)?.isPinned });
                if (!isFieldSupported("VaultItem", "is_pinned")) {
                  filesItems = filesItems.map((i) => (i.id === id ? { ...i, isPinned: prev } : i));
                }
              } catch {}
            }
          } else if (entity === "CalendarEvent" && canUseRemoteData()) {
            // no-op: CalendarEvent does not support pin in this schema
          }
        }
        saveFilesState();
        renderFilesLibrary();
      } else if (action === "favorite") {
        if (kind === "folder") {
          const prev = filesFolders.find((f) => f.id === id)?.isFavorite ?? false;
          filesFolders = filesFolders.map((f) => (f.id === id ? { ...f, isFavorite: !f.isFavorite } : f));
          if (canUseRemoteData()) {
            try {
              await safeEntityUpdate("Folder", id, { is_favorite: filesFolders.find((f) => f.id === id)?.isFavorite });
              if (!isFieldSupported("Folder", "is_favorite")) {
                filesFolders = filesFolders.map((f) => (f.id === id ? { ...f, isFavorite: prev } : f));
              }
            } catch {}
          }
        } else {
          if (entity === "VaultItem") {
            const prev = filesItems.find((i) => i.id === id)?.isFavorite ?? false;
            filesItems = filesItems.map((i) => (i.id === id ? { ...i, isFavorite: !i.isFavorite } : i));
            if (canUseRemoteData()) {
              try {
                await safeEntityUpdate("VaultItem", id, { is_favorite: filesItems.find((i) => i.id === id)?.isFavorite });
                if (!isFieldSupported("VaultItem", "is_favorite")) {
                  filesItems = filesItems.map((i) => (i.id === id ? { ...i, isFavorite: prev } : i));
                }
              } catch {}
            }
          } else if (entity === "CalendarEvent" && canUseRemoteData()) {
            // no-op: CalendarEvent does not support favorite in this schema
          }
        }
        saveFilesState();
        renderFilesLibrary();
      } else if (action === "important" && kind === "item") {
        if (entity === "VaultItem") {
          const prev = filesItems.find((i) => i.id === id)?.isImportant ?? false;
          filesItems = filesItems.map((i) => (i.id === id ? { ...i, isImportant: !i.isImportant } : i));
          if (!isFieldSupported("VaultItem", "is_important")) {
            filesItems = filesItems.map((i) => (i.id === id ? { ...i, isImportant: prev } : i));
          }
          saveFilesState();
          renderFilesLibrary();
        } else if (entity === "EmailItem" && canUseRemoteData()) {
          const row = remoteEmails.find((x) => asString(x.id) === id);
          const next = !asBool(row?.is_important);
          try {
            await safeEntityUpdate("EmailItem", id, { is_important: next });
            await refreshEmailFromRemote();
          } catch {}
        } else if (entity === "CalendarEvent" && canUseRemoteData()) {
          const row = remoteEvents.find((x) => asString(x.id) === id);
          const next = !asBool(row?.is_important);
          try {
            await safeEntityUpdate("CalendarEvent", id, { is_important: next });
            await refreshCalendarFromRemote();
          } catch {}
        }
      } else if (action === "edit-pdf") {
        const item = filesItems.find((x) => x.id === id);
        if (!item) return;
        openPreviewEditModal(item.id, "edit");
      } else if (action === "edit-desktop") {
        setStatus("Desktop edit flow coming next");
      } else if (action === "preview" && kind === "item" && entity === "VaultItem") {
        openPreviewEditModal(id, "preview");
      } else if (action === "open-native" && kind === "item" && entity === "VaultItem") {
        const item = filesItems.find((x) => x.id === id);
        if (!item) return;
        try {
          await openNativeForItem(item);
          setStatus(`opened native: ${item.title}`);
        } catch (err) {
          setStatus(`open native failed: ${String(err)}`);
        }
      } else if (action === "edit-app" && kind === "item" && entity === "VaultItem") {
        openPreviewEditModal(id, "edit");
      }
    });
  }
}

function openNewModal(): void {
  createMode = null;
  newNameInput.value = "";
  newModalFeedbackEl.textContent = "";
  newNameLabelEl.textContent = "Name";
  newModalTitleEl.textContent = "Create New";
  newItemFieldsEl.classList.add("hidden");
  newModalForm.classList.add("hidden");
  newModalChooserEl.classList.remove("hidden");
  fillFolderSelect();
  newModalEl.classList.remove("hidden");
}

function closeNewModal(): void {
  newModalEl.classList.add("hidden");
  newModalFeedbackEl.textContent = "";
}

function switchCreateMode(mode: "folder" | "item"): void {
  createMode = mode;
  newModalFeedbackEl.textContent = `Creating ${mode}...`;
  newModalChooserEl.classList.add("hidden");
  newModalForm.classList.remove("hidden");
  newItemFieldsEl.classList.toggle("hidden", mode !== "item");
  newModalTitleEl.textContent = mode === "folder" ? "Create Folder" : "Create Item";
  newNameLabelEl.textContent = mode === "folder" ? "Folder Name" : "Item Title";
  newNameInput.placeholder = mode === "folder" ? "Enter folder name..." : "Enter item title...";
  newNameInput.focus();
}

async function handleCreateFromModal(): Promise<void> {
  newModalFeedbackEl.textContent = "Submitting...";
  const name = newNameInput.value.trim();
  if (!name || !createMode) {
    newModalFeedbackEl.textContent = "Please pick New Folder/New Item and enter a name.";
    setStatus("enter a name first");
    return;
  }

  if (createMode === "folder") {
    if (filesFolders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
      newModalFeedbackEl.textContent = "Folder with this name already exists.";
      setStatus(`folder already exists: ${name}`);
      return;
    }
    const newFolderId = crypto.randomUUID();
    if (canUseRemoteData()) {
      try {
        if (!personalSpaceId && accessibleSpaceIds.length === 0) {
          await refreshAccessScope();
        }
        const targetSpaceId = personalSpaceId || accessibleSpaceIds[0] || "";
        const created = await safeEntityCreate<Record<string, unknown>>("Folder", {
          name,
          space_id: targetSpaceId,
          parent_folder_id: "",
        });
        const remoteId = asString(created.id, newFolderId);
        filesFolders.unshift(
          normalizeFolder({
            id: remoteId,
            name: asString(created.name, name),
            createdAtIso: asString(created.created_date, new Date().toISOString()),
            updatedAtIso: asString(created.updated_date, asString(created.created_date, new Date().toISOString())),
          })
        );
        setEntityUpdatedAt("Folder", remoteId, asString(created.updated_date, asString(created.created_date, new Date().toISOString())));
        activeFolderId = remoteId;
      } catch (err) {
        newModalFeedbackEl.textContent = `Create failed: ${String(err).slice(0, 140)}`;
        setStatus(`folder create failed: ${String(err)}`);
        return;
      }
    } else {
      filesFolders.unshift({
        id: newFolderId,
        name,
        createdAtIso: new Date().toISOString(),
        isPinned: false,
      });
      activeFolderId = newFolderId;
    }
    saveFilesState();
    renderFilesLibrary();
    setActiveTab("files");
    tabPanels.files.scrollTop = 0;
    setStatus(`folder created: ${name}`);
    newModalFeedbackEl.textContent = "Folder created.";
    closeNewModal();
    return;
  }

  const nextItemType = newItemTypeSelect.value as FileItemType;
  const nextFolderId = newParentFolderSelect.value || activeFolderId;
  if (canUseRemoteData()) {
    try {
      if (!personalSpaceId && accessibleSpaceIds.length === 0) {
        await refreshAccessScope();
      }
      const targetSpaceId = personalSpaceId || accessibleSpaceIds[0] || "";
      const created = await safeEntityCreate<Record<string, unknown>>("VaultItem", {
        title: name,
        item_type: nextItemType,
        folder_id: nextFolderId,
        space_id: targetSpaceId,
        source: "desktop_manual",
      });
      filesItems.unshift(
        normalizeItem({
          id: asString(created.id),
          title: asString(created.title, name),
          itemType: (asString(created.item_type, nextItemType) as FileItemType),
          folderId: asString(created.folder_id, nextFolderId),
          createdAtIso: asString(created.created_date, new Date().toISOString()),
          updatedAtIso: asString(created.updated_date, asString(created.created_date, new Date().toISOString())),
          notes: asString(created.notes),
          tags: asArray(created.tags),
          isPinned: asBool(created.is_pinned),
          isFavorite: asBool(created.is_favorite),
        })
      );
      const createdId = asString(created.id);
      if (createdId) setEntityUpdatedAt("VaultItem", createdId, asString(created.updated_date, asString(created.created_date, new Date().toISOString())));
    } catch (err) {
      newModalFeedbackEl.textContent = `Create failed: ${String(err).slice(0, 140)}`;
      setStatus(`item create failed: ${String(err)}`);
      return;
    }
  } else {
    filesItems.unshift({
      id: crypto.randomUUID(),
      title: name,
      itemType: nextItemType,
      folderId: nextFolderId,
      createdAtIso: new Date().toISOString(),
      notes: "",
      tags: [],
      isPinned: false,
      isFavorite: false,
    });
  }
  saveFilesState();
  renderFilesLibrary();
  setActiveTab("files");
  tabPanels.files.scrollTop = 0;
  setStatus(`item created: ${name}`);
  newModalFeedbackEl.textContent = "Item created.";
  closeNewModal();
}

async function uploadSelectedFilesToFolder(targetFolderId: string): Promise<void> {
  if (!canUseRemoteData()) {
    setStatus("login required");
    return;
  }
  const uploadToken = getPreferredUploadToken();
  if (!uploadToken) {
    setStatus("missing upload token");
    return;
  }

  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.style.display = "none";
  document.body.appendChild(picker);

  const files = await new Promise<File[]>((resolve) => {
    picker.addEventListener(
      "change",
      () => {
        const selected = picker.files ? Array.from(picker.files) : [];
        resolve(selected);
      },
      { once: true }
    );
    picker.click();
  });
  picker.remove();

  if (files.length === 0) {
    setStatus("upload canceled");
    return;
  }

  if (!personalSpaceId && accessibleSpaceIds.length === 0) {
    await refreshAccessScope();
  }
  const targetSpaceId = personalSpaceId || accessibleSpaceIds[0] || "";

  let uploaded = 0;
  for (const file of files) {
    const tempId = `temp-upload-${crypto.randomUUID()}`;
    const tempItem = normalizeItem({
      id: tempId,
      title: file.name,
      itemType: "uploaded_file",
      folderId: targetFolderId,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      isUploading: true,
      fileExtension: extOf(file.name),
    });
    filesItems.unshift(tempItem);
    renderFilesLibrary();

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
        filesItems = filesItems.filter((x) => x.id !== tempId);
        const idx = filesItems.findIndex((x) => x.id === createdId);
        if (idx >= 0) filesItems[idx] = nextItem;
        else filesItems.unshift(nextItem);
        setEntityUpdatedAt("VaultItem", createdId, nextItem.updatedAtIso || nextItem.createdAtIso);
        if (asString(nextItem.itemType) === "uploaded_file") {
          remoteDropzoneItems = upsertById(remoteDropzoneItems, created);
        }
        saveFilesState();
        renderFilesLibrary();
      }
      uploaded += 1;
    } catch (err) {
      filesItems = filesItems.filter((x) => x.id !== tempId);
      renderFilesLibrary();
      setStatus(`upload failed for ${file.name}: ${String(err)}`);
    }
  }

  if (uploaded > 0) {
    void syncRemoteDelta();
    void refreshFilesFromRemote();
    if (activeFolderId !== targetFolderId) activeFolderId = targetFolderId;
    renderFilesLibrary();
    setStatus(`uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`);
  }
}

function fileSignature(file: LocalFolderFile): string {
  return `${file.path}|${file.size}|${file.modified_ms}`;
}

function queueCounts(): { total: number; active: number; failed: number; done: number } {
  const total = queueItems.length;
  const active = queueItems.filter((x) => x.status === "queued" || x.status === "uploading" || x.status === "retrying").length;
  const failed = queueItems.filter((x) => x.status === "failed").length;
  const done = queueItems.filter((x) => x.status === "done").length;
  return { total, active, failed, done };
}

function renderQueue(): void {
  const c = queueCounts();
  queueSummaryEl.textContent = `Queue: ${c.total} items (${c.active} active, ${c.failed} failed, ${c.done} done)`;

  if (queueItems.length === 0) {
    queueListEl.innerHTML = `<p class="muted">No items in queue.</p>`;
    return;
  }

  queueListEl.innerHTML = queueItems
    .map(
      (item) => `
      <article class="queue-item">
        <div>
          <strong>${item.filename}</strong>
          <p>${item.sourcePath}</p>
        </div>
        <div>
          <p>Status: ${item.status}</p>
          <p>Attempts: ${item.attempts}/${IMPORT_MAX_RETRIES}</p>
          <p>Progress: ${item.progress}%</p>
          ${item.error ? `<p class="error">${item.error}</p>` : ""}
        </div>
      </article>
    `
    )
    .join("");
}

function addQueueItem(file: LocalFolderFile): void {
  const signature = fileSignature(file);
  if (uploadedSignatures.has(signature)) return;
  if (queueItems.some((x) => x.signature === signature && x.status !== "failed")) return;

  queueItems.unshift({
    id: crypto.randomUUID(),
    signature,
    sourcePath: file.path,
    filename: file.name,
    status: "queued",
    attempts: 0,
    progress: 0,
    createdAtIso: new Date().toISOString(),
  });

  renderQueue();
  void processQueue();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function renderCalendarWeek(): void {
  const end = addDays(calendarWeekStart, 6);
  calendarWeekLabelEl.textContent = `${calendarWeekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  const today = new Date();
  calendarWeekGridEl.innerHTML = Array.from({ length: 7 }, (_, i) => addDays(calendarWeekStart, i))
    .map((d) => {
      const isToday = d.toDateString() === today.toDateString();
      const wd = d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
      const num = d.getDate();
      return `
      <div class="week-day ${isToday ? "active" : ""}">
        <div class="wd">${wd}</div>
        <div class="dn">${num}</div>
      </div>`;
    })
    .join("");
}

async function processQueue(): Promise<void> {
  if (isQueueRunning) return;
  isQueueRunning = true;

  try {
    while (true) {
      const item = queueItems.find((x) => x.status === "queued" || x.status === "retrying");
      if (!item) break;

      const uploadToken = getPreferredUploadToken();
      if (!uploadToken) {
        setStatus("queue paused: missing token");
        break;
      }

      item.status = "uploading";
      item.attempts += 1;
      item.progress = 0;
      item.error = undefined;
      renderQueue();

      try {
        setStatus(`uploading ${item.filename}...`);
        const numbers = await invoke<number[]>("read_file_bytes", { path: item.sourcePath });
        const bytes = new Uint8Array(numbers);

        await uploadFileWithToken(uploadToken, item.filename, bytes, (pct) => {
          item.progress = pct;
          renderQueue();
        });

        item.status = "done";
        item.progress = 100;
        item.finishedAtIso = new Date().toISOString();
        uploadedSignatures.add(item.signature);
        saveUploadedWatchSignatures(uploadedSignatures);
        setStatus(`imported ${item.filename}`);
        if (canUseRemoteData()) {
          void refreshDropzoneFromRemote();
          void refreshFilesFromRemote();
        }
      } catch (err) {
        item.error = String(err);
        if (item.attempts < IMPORT_MAX_RETRIES) {
          item.status = "retrying";
          setStatus(`retrying ${item.filename} (${item.attempts}/${IMPORT_MAX_RETRIES})`);
          renderQueue();
          await sleep(Math.min(1000 * 2 ** (item.attempts - 1), 15000));
          item.status = "queued";
        } else {
          item.status = "failed";
          setStatus(`failed ${item.filename}`);
        }
      }

      renderQueue();
    }
  } finally {
    isQueueRunning = false;
  }
}

async function scanWatchFolder(): Promise<void> {
  if (!getWatchEnabled()) return;

  const folder = getWatchFolder();
  if (!folder) return;

  const files = await invoke<LocalFolderFile[]>("list_folder_files", { path: folder });
  for (const file of files) {
    if (!SUPPORTED_IMPORT_EXT.has(extOf(file.name))) continue;
    addQueueItem(file);
  }
}

function stopWatchPolling(): void {
  if (watchPollId !== null) {
    window.clearInterval(watchPollId);
    watchPollId = null;
  }
}

function stopRemotePolling(): void {
  if (remotePollId !== null) {
    window.clearInterval(remotePollId);
    remotePollId = null;
  }
}

function startRemotePolling(): void {
  stopRemotePolling();
  if (!canUseRemoteData()) return;
  remotePollId = window.setInterval(() => {
    void syncRemoteDelta();
  }, 15000);
}

function updateWatchSummary(): void {
  const folder = getWatchFolder();
  const enabled = getWatchEnabled();
  watchSummaryEl.textContent = `Watch folder: ${enabled ? `on (${folder || "not set"})` : "disabled"}`;
  queuePathEl.textContent = `Path: ${folder || "-"}`;
}

function startWatchPolling(): void {
  stopWatchPolling();
  updateWatchSummary();

  if (!getWatchEnabled()) return;

  watchPollId = window.setInterval(() => {
    void scanWatchFolder();
  }, WATCH_FOLDER_POLL_MS);

  void scanWatchFolder();
}

function handleIncomingUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const fileId = parsed.searchParams.get("fileId");
    deepLinkEl.textContent = `Deep link: ${url}`;
    if (fileId) {
      fileIdInput.value = fileId;
      setActiveTab("files");
    }
  } catch {
    deepLinkEl.textContent = `Deep link: invalid (${url})`;
  }
}

function hydrateSettingsUI(): void {
  apiKeyInput.value = getApiKey();
  extensionTokenInput.value = getExtensionToken() || "";
  emailInput.value = getSavedEmail();
  watchEnabledInput.checked = getWatchEnabled();
  watchFolderInput.value = getWatchFolder();
  renderSettingsProfile();
}

function toDisplayName(email: string): string {
  const local = email.split("@")[0] || "";
  if (!local) return "User";
  const parts = local
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "User";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function renderSettingsProfile(): void {
  const email = getSavedEmail().trim();
  const name = toDisplayName(email);
  const initial = (name.charAt(0) || "U").toUpperCase();
  profileNameEl.textContent = name;
  profileEmailEl.textContent = email || "-";
  profileAvatarEl.textContent = initial;
}

async function ensureDefaultWatchFolder(): Promise<void> {
  if (getWatchFolder()) return;
  const defaultPath = await invoke<string>("get_default_watch_folder");
  setWatchFolder(defaultPath);
}

async function unlockCurrentFile(): Promise<void> {
  const active = getActiveEditSession();
  if (!active) {
    setStatus("no active file to unlock");
    return;
  }

  await callFileLock(active.extensionToken, active.fileId, "unlock");
  stopActiveWatcher();
  setStatus("file unlocked");
  setCurrentFile("none");
}

for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab as keyof typeof tabPanels;
    setActiveTab(tab);
    if (tab === "files") void refreshFilesFromRemote();
    if (tab === "email") void refreshEmailFromRemote();
    if (tab === "calendar") void refreshCalendarFromRemote();
    if (tab === "vault") void refreshVaultFromRemote();
    if (tab === "shared") void refreshSharedFromRemote();
    if (tab === "queue") void refreshDropzoneFromRemote();
  });
}

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  saveSettings(apiKeyInput.value.trim(), extensionTokenInput.value.trim());
  setWatchEnabled(watchEnabledInput.checked);
  setWatchFolder(watchFolderInput.value.trim());

  updateWatchSummary();
  startWatchPolling();
  renderSettingsProfile();
  setStatus("settings saved");
  await setupOnlyofficeLocalRelay();
  await processQueue();
  renderCapabilitiesReport();
});

capRefreshBtn.addEventListener("click", () => {
  renderCapabilitiesReport();
  setStatus("capabilities refreshed");
});

capCopyBtn.addEventListener("click", async () => {
  renderCapabilitiesReport();
  try {
    await navigator.clipboard.writeText(capabilitiesReportCache);
    setStatus("capabilities copied");
  } catch {
    setStatus("clipboard unavailable");
  }
});

syncHealthBtn.addEventListener("click", () => {
  void runSyncHealthCheck();
});

scanNowBtn.addEventListener("click", async () => {
  try {
    await scanWatchFolder();
    setStatus("watch folder scanned");
  } catch (err) {
    setStatus(`scan error: ${String(err)}`);
  }
});

retryFailedBtn.addEventListener("click", () => {
  for (const item of queueItems) {
    if (item.status === "failed") {
      item.status = "queued";
      item.error = undefined;
      item.progress = 0;
    }
  }
  renderQueue();
  void processQueue();
});

connectGmailBtn.addEventListener("click", async () => {
  if (!canUseRemoteData()) {
    setStatus("login required");
    return;
  }
  setStatus("syncing gmail...");
  try {
    await invokeBase44Function("syncGmail", {});
    await refreshEmailFromRemote();
    setStatus("gmail sync complete");
  } catch (err) {
    setStatus(`gmail sync failed: ${String(err)}`);
  }
});

newEventBtn.addEventListener("click", async () => {
  if (!canUseRemoteData()) {
    setStatus("login required");
    return;
  }
  const title = window.prompt("Event title");
  if (!title) return;
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  try {
    await safeEntityCreate("CalendarEvent", {
      title,
      start_time: now.toISOString(),
      end_time: end.toISOString(),
      provider: "manual",
    });
    await syncRemoteDelta();
    setStatus(`event created: ${title}`);
  } catch (err) {
    setStatus(`event create failed: ${String(err)}`);
  }
});

calendarPrevBtn.addEventListener("click", () => {
  calendarWeekStart = addDays(calendarWeekStart, -7);
  renderCalendarWeek();
});

calendarNextBtn.addEventListener("click", () => {
  calendarWeekStart = addDays(calendarWeekStart, 7);
  renderCalendarWeek();
});

calendarTodayBtn.addEventListener("click", () => {
  calendarWeekStart = getStartOfWeek(new Date());
  renderCalendarWeek();
});

vaultGatherBtn.addEventListener("click", async () => {
  const value = vaultGatherInput.value.trim();
  if (!value) {
    setStatus("enter a gather query first");
    return;
  }
  if (!canUseRemoteData()) {
    setStatus("login required");
    return;
  }
  setStatus(`gathering: "${value}"...`);
  try {
    const response = await invokeBase44Function<Record<string, unknown>>("gatherRelated", { topic: value });
    const packTitle = asString(response.pack_title, `Everything related to: ${value}`);
    const total = Number(response.total_items ?? 0);
    await safeEntityCreate("GatherPack", { title: packTitle, topic: value, summary: asString(response.summary), item_count: total });
    await syncRemoteDelta();
    setStatus(`gather complete: ${packTitle}`);
  } catch (err) {
    setStatus(`gather failed: ${String(err)}`);
  }
});

newSpaceBtn.addEventListener("click", async () => {
  if (!canUseRemoteData()) {
    setStatus("login required");
    return;
  }
  const name = window.prompt("Shared space name");
  if (!name) return;
  try {
    await safeEntityCreate("Space", { name, space_type: "shared", members: [] });
    await syncRemoteDelta();
    setStatus(`space created: ${name}`);
  } catch (err) {
    setStatus(`space create failed: ${String(err)}`);
  }
});

filesUploadBtn.addEventListener("click", () => {
  void uploadSelectedFilesToFolder("");
});

filesFolderUploadBtn.addEventListener("click", () => {
  void uploadSelectedFilesToFolder(activeFolderId);
});

filesBackBtn.addEventListener("click", () => {
  activeFolderId = "";
  renderFilesLibrary();
});

filesFolderNewBtn.addEventListener("click", () => {
  openNewModal();
});

filesNewBtn.addEventListener("click", () => {
  openNewModal();
});

newModalCloseBtn.addEventListener("click", closeNewModal);
newModalCancelBtn.addEventListener("click", closeNewModal);
newModalBackdropEl.addEventListener("click", closeNewModal);
newFolderChoiceBtn.addEventListener("click", () => switchCreateMode("folder"));
newItemChoiceBtn.addEventListener("click", () => switchCreateMode("item"));

newModalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void handleCreateFromModal();
});

newModalCreateBtn.addEventListener("click", (e) => {
  e.preventDefault();
  void handleCreateFromModal();
});

manageModalCloseBtn.addEventListener("click", closeManageModal);
manageModalCancelBtn.addEventListener("click", closeManageModal);
manageModalBackdropEl.addEventListener("click", closeManageModal);
manageModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!manageTarget) return;
  const target = manageTarget;

  if (target.kind === "folder") {
    const nextName = manageNameInput.value.trim();
    if (!nextName) {
      setStatus("folder name cannot be empty");
      return;
    }
    const isDuplicate = filesFolders.some(
      (f) => f.id !== target.id && f.name.toLowerCase() === nextName.toLowerCase()
    );
    if (isDuplicate) {
      setStatus(`folder already exists: ${nextName}`);
      return;
    }
    if (canUseRemoteData()) {
      try {
        const updated = await safeEntityUpdate("Folder", target.id, { name: nextName }, manageTargetBaselineUpdatedAt);
        if (updated) {
          const nextUpdatedAt = asString(updated.updated_date, asString(updated.created_date, ""));
          if (nextUpdatedAt) setEntityUpdatedAt("Folder", target.id, nextUpdatedAt);
        }
      } catch (err) {
        setStatus(`folder update failed: ${String(err)}`);
        return;
      }
    }
    filesFolders = filesFolders.map((f) => (f.id === target.id ? { ...f, name: nextName } : f));
    saveFilesState();
    renderFilesLibrary();
    setStatus(`folder updated: ${nextName}`);
    closeManageModal();
    return;
  }

  const tags = manageTagsInput.value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const nextTitle = manageNameInput.value.trim();
  if (!nextTitle) {
    setStatus("item title cannot be empty");
    return;
  }
  if (target.entity === "VaultItem") {
    if (canUseRemoteData()) {
      try {
        const updated = await safeEntityUpdate(
          "VaultItem",
          target.id,
          { title: nextTitle, notes: manageNotesInput.value.trim(), tags },
          manageTargetBaselineUpdatedAt
        );
        if (updated) {
          const nextUpdatedAt = asString(updated.updated_date, asString(updated.created_date, ""));
          if (nextUpdatedAt) setEntityUpdatedAt("VaultItem", target.id, nextUpdatedAt);
        }
      } catch (err) {
        setStatus(`item update failed: ${String(err)}`);
        return;
      }
    }
    filesItems = filesItems.map((i) =>
      i.id === target.id
        ? { ...i, title: nextTitle, notes: manageNotesInput.value.trim(), tags }
        : i
    );
    saveFilesState();
    renderFilesLibrary();
    setStatus(`item updated: ${nextTitle}`);
    closeManageModal();
    return;
  }

  if (!canUseRemoteData()) {
    setStatus("login required for this action");
    return;
  }

  try {
    if (target.entity === "EmailItem") {
      await safeEntityUpdate(
        "EmailItem",
        target.id,
        { subject: nextTitle, snippet: manageNotesInput.value.trim(), tags },
        manageTargetBaselineUpdatedAt
      );
      await syncRemoteDelta();
    } else if (target.entity === "CalendarEvent") {
      await safeEntityUpdate(
        "CalendarEvent",
        target.id,
        { title: nextTitle, description: manageNotesInput.value.trim(), tags },
        manageTargetBaselineUpdatedAt
      );
      await syncRemoteDelta();
    } else if (target.entity === "Space") {
      await safeEntityUpdate(
        "Space",
        target.id,
        { name: nextTitle, description: manageNotesInput.value.trim() },
        manageTargetBaselineUpdatedAt
      );
      await syncRemoteDelta();
    }
    setStatus(`updated: ${nextTitle}`);
    closeManageModal();
  } catch (err) {
    setStatus(`update failed: ${String(err)}`);
  }
});

deleteModalCancelBtn.addEventListener("click", () => closeDeleteModal());
deleteModalBackdropEl.addEventListener("click", () => closeDeleteModal());
deleteModalConfirmBtn.addEventListener("click", async () => {
  if (!deleteTarget) return;
  const target = deleteTarget;
  deleteModalConfirmBtn.disabled = true;
  deleteModalCancelBtn.disabled = true;
  deleteModalConfirmBtn.textContent = "Deleting...";
  if (target.kind === "folder") {
    filesFolders = filesFolders.map((f) => (f.id === target.id ? { ...f, isDeleting: true } : f));
    renderFilesLibrary();
    if (canUseRemoteData()) {
      try {
        await deleteRemoteEntity("Folder", target.id);
      } catch (err) {
        filesFolders = filesFolders.map((f) => (f.id === target.id ? { ...f, isDeleting: false } : f));
        renderFilesLibrary();
        deleteModalConfirmBtn.disabled = false;
        deleteModalCancelBtn.disabled = false;
        deleteModalConfirmBtn.textContent = deleteModalConfirmDefaultLabel;
        setStatus(`folder delete failed: ${String(err)}`);
        return;
      }
    }
    const folder = filesFolders.find((f) => f.id === target.id);
    filesFolders = filesFolders.filter((f) => f.id !== target.id);
    filesItems = filesItems.map((item) =>
      item.folderId === target.id ? { ...item, folderId: "" } : item
    );
    if (activeFolderId === target.id) activeFolderId = "";
    removeEntityUpdatedAt("Folder", target.id);
    saveFilesState();
    renderFilesLibrary();
    setStatus(`folder deleted: ${folder?.name || "folder"}`);
    closeDeleteModal(true);
    return;
  }

  if (target.entity === "VaultItem") {
    filesItems = filesItems.map((i) => (i.id === target.id ? { ...i, isDeleting: true } : i));
    renderFilesLibrary();
    if (canUseRemoteData()) {
      try {
        await deleteRemoteEntity("VaultItem", target.id);
      } catch (err) {
        filesItems = filesItems.map((i) => (i.id === target.id ? { ...i, isDeleting: false } : i));
        renderFilesLibrary();
        deleteModalConfirmBtn.disabled = false;
        deleteModalCancelBtn.disabled = false;
        deleteModalConfirmBtn.textContent = deleteModalConfirmDefaultLabel;
        setStatus(`item delete failed: ${String(err)}`);
        return;
      }
    }
    const item = filesItems.find((i) => i.id === target.id);
    filesItems = filesItems.filter((i) => i.id !== target.id);
    removeEntityUpdatedAt("VaultItem", target.id);
    saveFilesState();
    renderFilesLibrary();
    setStatus(`item deleted: ${item?.title || "item"}`);
    closeDeleteModal(true);
    return;
  }

  if (!canUseRemoteData()) {
    deleteModalConfirmBtn.disabled = false;
    deleteModalCancelBtn.disabled = false;
    deleteModalConfirmBtn.textContent = deleteModalConfirmDefaultLabel;
    setStatus("login required for this action");
    return;
  }

  try {
    if (target.entity === "EmailItem") {
      await deleteRemoteEntity("EmailItem", target.id);
      removeEntityUpdatedAt("EmailItem", target.id);
      await syncRemoteDelta();
    } else if (target.entity === "CalendarEvent") {
      await deleteRemoteEntity("CalendarEvent", target.id);
      removeEntityUpdatedAt("CalendarEvent", target.id);
      await syncRemoteDelta();
    } else if (target.entity === "Space") {
      await deleteRemoteEntity("Space", target.id);
      removeEntityUpdatedAt("Space", target.id);
      await syncRemoteDelta();
    }
    setStatus("deleted");
    closeDeleteModal(true);
  } catch (err) {
    deleteModalConfirmBtn.disabled = false;
    deleteModalCancelBtn.disabled = false;
    deleteModalConfirmBtn.textContent = deleteModalConfirmDefaultLabel;
    setStatus(`delete failed: ${String(err)}`);
  }
});

fileActionCloseBtn.addEventListener("click", closeFileActionModal);
fileActionBackdropEl.addEventListener("click", closeFileActionModal);

fileActionPreviewBtn.addEventListener("click", () => {
  const item = filesItems.find((x) => x.id === fileActionTargetId);
  if (!item) return;
  closeFileActionModal();
  openPreviewEditModal(item.id, "preview");
});

fileActionOpenNativeBtn.addEventListener("click", async () => {
  const item = filesItems.find((x) => x.id === fileActionTargetId);
  if (!item) return;
  try {
    await openNativeForItem(item);
    setStatus(`opened native: ${item.title}`);
    closeFileActionModal();
  } catch (err) {
    setStatus(`open native failed: ${String(err)}`);
  }
});

fileActionEditAppBtn.addEventListener("click", () => {
  const item = filesItems.find((x) => x.id === fileActionTargetId);
  if (!item) return;
  closeFileActionModal();
  openPreviewEditModal(item.id, "edit");
});

fileActionManageBtn.addEventListener("click", () => {
  const item = filesItems.find((x) => x.id === fileActionTargetId);
  if (!item) return;
  if (!canEditItem(item)) {
    setStatus("read-only: you do not have edit permission");
    return;
  }
  openManageModal({ kind: "item", id: item.id, entity: "VaultItem" });
  closeFileActionModal();
});

previewEditCloseBtn.addEventListener("click", closePreviewEditModal);
previewEditBackdropEl.addEventListener("click", closePreviewEditModal);

previewOpenNativeBtn.addEventListener("click", async () => {
  const item = filesItems.find((x) => x.id === previewEditTargetId);
  if (!item) return;
  try {
    await openNativeForItem(item);
    setStatus(`opened native: ${item.title}`);
  } catch (err) {
    setStatus(`open native failed: ${String(err)}`);
  }
});

previewRefreshBtn.addEventListener("click", async () => {
  const item = filesItems.find((x) => x.id === previewEditTargetId);
  if (!item) return;
  await syncRemoteDelta();
  const refreshed = filesItems.find((x) => x.id === item.id);
  if (!refreshed) {
    closePreviewEditModal();
    return;
  }
  renderPreviewEditBody(refreshed);
  bindPreviewEditInputs();
  updatePreviewEditActions(refreshed);
});

previewEditModeBtn.addEventListener("click", () => {
  const item = filesItems.find((x) => x.id === previewEditTargetId);
  if (!item) return;
  if (!previewEditCanEdit) return;
  previewEditMode = previewEditMode === "preview" ? "edit" : "preview";
  previewEditTitleEl.textContent = `${previewEditMode === "edit" ? "Edit" : "Preview"}: ${item.title}`;
  renderPreviewEditBody(item);
  bindPreviewEditInputs();
  updatePreviewEditActions(item);
});

previewSaveBtn.addEventListener("click", () => {
  void savePreviewEditChanges();
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".row-menu")) {
    closeContextMenus();
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("logging in...");
  loginBtn.disabled = true;

  try {
    const email = emailInput.value.trim();
    const accessToken = await login(email, passwordInput.value);
    saveLogin(accessToken, email);
    lastDeltaSyncIso = "";
    setStatus("login success");
    enterWorkspace();
    await setupOnlyofficeLocalRelay();
    await refreshAllRemoteData();
    startRemotePolling();
    await processQueue();
  } catch (err) {
    console.error(err);
    const msg = String(err);
    setStatus(msg.includes("login failed") ? msg : "network/error");
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => {
  clearLogin();
  lastDeltaSyncIso = "";
  stopActiveWatcher();
  stopWatchPolling();
  stopRemotePolling();
  setCurrentFile("none");
  setLastSync("none");
  setResult({});
  renderSettingsProfile();
  enterLogin();
});

profileEditBtn.addEventListener("click", () => {
  setStatus("Profile editing will be added next");
});

checkoutBtn.addEventListener("click", async () => {
  const fileId = fileIdInput.value.trim();
  const authToken = getAuthToken();
  const uploadToken = getPreferredUploadToken();
  const checkoutToken = getPreferredUploadToken();

  if (!fileId) {
    setStatus("missing fileId");
    return;
  }
  if (!checkoutToken) {
    setStatus("missing checkout token, log in first");
    return;
  }
  if (!uploadToken) {
    setStatus("missing upload token (extension token)");
    return;
  }

  checkoutBtn.disabled = true;
  setStatus("checking out...");
  resultEl.textContent = "";

  try {
    const checkout = await checkoutFile(fileId, checkoutToken);

    setStatus("downloading file...");
    const bytes = await downloadFile(checkout.download_url);
    const savedPath = await invoke<string>("save_file_to_workspace", {
      fileId,
      filename: checkout.file_metadata.name,
      bytes: Array.from(bytes),
    });

    await openPath(savedPath);

    await startAutoSync(
      {
        fileId,
        filename: checkout.file_metadata.name,
        localPath: savedPath,
        editSessionId: checkout.edit_session_id,
        authToken: authToken || checkoutToken,
        extensionToken: uploadToken,
      },
      ui
    );

    setStatus("checkout success, file opened");
    setLastSync("none");
    setResult({
      used_file_id: fileId,
      edit_session_id: checkout.edit_session_id,
      filename: checkout.file_metadata.name,
      lock_acquired: checkout.lock_acquired ?? null,
      local_path: savedPath,
      autosync: "watching (debounced)",
    });
  } catch (err) {
    setStatus("checkout network/error");
    setResult({
      used_file_id: fileId,
      error: String(err),
    });
  } finally {
    checkoutBtn.disabled = false;
  }
});

unlockBtn.addEventListener("click", async () => {
  try {
    unlockBtn.disabled = true;
    await unlockCurrentFile();
  } catch (err) {
    setStatus("unlock error");
    setResult({ error: String(err) });
  } finally {
    unlockBtn.disabled = false;
  }
});

simulateBtn.addEventListener("click", () => {
  handleIncomingUrl("easyvault://edit?fileId=test-123");
});

onOpenUrl((urls) => {
  for (const url of urls) {
    handleIncomingUrl(url);
  }
});

window.addEventListener("beforeunload", () => {
  const active = getActiveEditSession();
  if (!active) return;
  void callFileLock(active.extensionToken, active.fileId, "unlock");
});

hydrateSettingsUI();
renderQueue();
renderCalendarWeek();
renderFilesLibrary();
renderCapabilitiesReport();
setSyncHealthPill("idle");
setActiveTab("home");
void setupOnlyofficeLocalRelay();

void ensureDefaultWatchFolder().then(() => {
  hydrateSettingsUI();
  updateWatchSummary();
  startWatchPolling();
});

if (getAuthToken()) {
  enterWorkspace();
  void refreshAllRemoteData();
  startRemotePolling();
} else {
  enterLogin();
}
