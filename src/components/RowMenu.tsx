import { useCallback, useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "../hooks/useEscapeClose";

/** Distance between the anchor and the menu. */
const ANCHOR_GAP = 4;
/** Minimum distance the menu keeps from every viewport edge. */
const VIEWPORT_MARGIN = 8;

type MenuAlign = "left" | "right";

interface MenuPos {
  top: number;
  left: number;
}

/**
 * Places the menu next to its anchor so it always fits on screen: it opens
 * downward, flips above the anchor when it would run past the bottom, and
 * flips/clamps horizontally when it would run past a side edge.
 */
function computeMenuPos(anchor: DOMRect, menu: DOMRect, align: MenuAlign): MenuPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = anchor.bottom + ANCHOR_GAP;
  if (top + menu.height > vh - VIEWPORT_MARGIN) {
    const above = anchor.top - ANCHOR_GAP - menu.height;
    top = above >= VIEWPORT_MARGIN
      ? above
      : Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - menu.height);
  }

  let left = align === "right" ? anchor.right - menu.width : anchor.left;
  if (left + menu.width > vw - VIEWPORT_MARGIN) left = anchor.right - menu.width;
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (left + menu.width > vw - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - menu.width);
  }

  return { top, left };
}

interface PortalMenuProps {
  open: boolean;
  /** Element the menu is positioned against (usually the trigger button). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Class names for the floating panel, e.g. "row-menu-dropdown open". */
  className?: string;
  /** Anchor edge the menu lines up with while it fits. Defaults to "right". */
  align?: MenuAlign;
}

/**
 * A dropdown panel rendered into `document.body` with `position: fixed`.
 *
 * Portalling is what keeps the panel visible: rows live inside scroll
 * containers (`.tab-panel` has `overflow: auto`), and the app's glass styling
 * puts `backdrop-filter`/`transform` ancestors above almost every row — either
 * one clips an in-flow dropdown, and a `backdrop-filter` ancestor even becomes
 * the containing block for `position: fixed` children. Only a portal to
 * `<body>` escapes both.
 */
export function PortalMenu({ open, anchorRef, onClose, children, className, align = "right" }: PortalMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);

  // Keep the latest close handler without re-subscribing the listeners when a
  // caller passes an inline arrow function.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Measure the mounted panel and place it before the browser paints, so the
  // menu never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const anchorEl = anchorRef.current;
    const menuEl = menuRef.current;
    if (!anchorEl || !menuEl) return;
    const next = computeMenuPos(anchorEl.getBoundingClientRect(), menuEl.getBoundingClientRect(), align);
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [open, align, anchorRef]);

  useEscapeClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      closeRef.current();
    };
    // The anchor moves with its scroll container, so close rather than chase it.
    // Scrolling inside the menu itself (long option lists) must not close it.
    const onScroll = (e: Event): void => {
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      closeRef.current();
    };
    const onResize = (): void => closeRef.current();
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{
        position: "fixed",
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        right: "auto",
        bottom: "auto",
        visibility: pos ? undefined : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface RowMenuItem {
  /** Stable React key for the entry. */
  key: string;
  label: ReactNode;
  /**
   * Runs when the entry is picked; the menu closes afterwards. The click event
   * is handed over so call sites decide themselves whether it should keep
   * bubbling to a clickable row.
   */
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Renders the destructive style (`.row-menu-dropdown button.danger`). */
  danger?: boolean;
  /** Draws a divider above this entry. */
  separatorBefore?: boolean;
}

interface RowMenuProps {
  items: RowMenuItem[];
  /** Optional accessible name for the trigger. */
  label?: string;
  /** Extra class names for the `.row-menu` wrapper. */
  className?: string;
}

/**
 * The app-wide three-dot row menu. Every list row uses this so the menus can't
 * drift apart again — and so none of them can be clipped by a scroll container.
 */
export default function RowMenu({ items, label, className }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={className ? `row-menu ${className}` : "row-menu"}>
      <button
        ref={btnRef}
        type="button"
        className="row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        &#x22EE;
      </button>
      <PortalMenu open={open} anchorRef={btnRef} onClose={close} className="row-menu-dropdown open">
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.separatorBefore && i > 0 && <hr />}
            <button
              type="button"
              className={item.danger ? "danger" : undefined}
              onClick={(e) => { item.onSelect(e); close(); }}
            >
              {item.label}
            </button>
          </Fragment>
        ))}
      </PortalMenu>
    </div>
  );
}
