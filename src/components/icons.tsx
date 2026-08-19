/**
 * EasyVault inline-SVG icon system (Lucide visual language).
 * All icons: 24px viewBox, stroke-based (round caps/joins), inherit `currentColor`.
 * Defaults: size 18, strokeWidth 1.8.
 */

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function IconHome({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}

export function IconFolder({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 4h5l2 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

export function IconMail({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function IconLink({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconCalendar({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function IconLock({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function IconUsers({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.6" />
      <path d="M3 20.5v-.8a6 6 0 0 1 12 0v.8" />
      <path d="M15.5 4.6a3.6 3.6 0 0 1 0 6.8" />
      <path d="M17.6 14.9a6 6 0 0 1 3.4 4.8v.8" />
    </svg>
  );
}

export function IconInbox({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1Z" />
      <path d="M2 12h5l2 3h6l2-3h5" />
    </svg>
  );
}

export function IconSettings({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5V5" />
      <path d="M12 19v2.5" />
      <path d="M2.5 12H5" />
      <path d="M19 12h2.5" />
      <path d="m5.28 5.28 1.77 1.77" />
      <path d="m16.95 16.95 1.77 1.77" />
      <path d="m18.72 5.28-1.77 1.77" />
      <path d="m7.05 16.95-1.77 1.77" />
    </svg>
  );
}

export function IconLayoutGrid({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconMessageCircle({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z" />
    </svg>
  );
}

export function IconCheckSquare({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 11v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      <path d="m9 11.5 3 3L21 5" />
    </svg>
  );
}

export function IconActivity({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 12h-4l-3 9-6-18-3 9H2" />
    </svg>
  );
}

export function IconShare({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5 15.4 6.5" />
      <path d="m8.6 13.5 6.8 4" />
    </svg>
  );
}

export function IconPlus({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconFile({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

export function IconFileText({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function IconFileSpreadsheet({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
      <path d="M12 13v4" />
    </svg>
  );
}

export function IconImage({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.4-4.4a1.5 1.5 0 0 0-2.1 0L6 19" />
    </svg>
  );
}

export function IconMusic({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  );
}

export function IconVideo({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}

export function IconArchive({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

export function IconStickyNote({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10l7-7V4a1 1 0 0 0-1-1Z" />
      <path d="M14 21v-6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

export function IconClipboard({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

export function IconBriefcase({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="7" width="20" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function IconX({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconDownload({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 3v12" />
    </svg>
  );
}

export function IconUpload({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

export function IconRefresh({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20.5 12a8.5 8.5 0 0 1-14.9 5.6l-2.1-2.1" />
      <path d="M3.5 20v-4.5H8" />
      <path d="M3.5 12a8.5 8.5 0 0 1 14.9-5.6l2.1 2.1" />
      <path d="M20.5 4v4.5H16" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10.3 4.1 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconCheck({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconPin({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 3h6v6l2.5 2.5V14h-11v-2.5L9 9Z" />
      <path d="M12 14v7.5" />
    </svg>
  );
}

export function IconTrash({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function IconExternalLink({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconClock({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function IconChevronRight({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconSearch({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5 16 16" />
    </svg>
  );
}

export function IconSparkles({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1Z" />
      <path d="M5 3.5v3" />
      <path d="M3.5 5h3" />
      <path d="M19 17.5v3" />
      <path d="M17.5 19h3" />
    </svg>
  );
}

export function IconStar({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3.5l2.3 5.8 6.3.4-4.9 4 1.6 6.1-5.3-3.4-5.3 3.4 1.6-6.1-4.9-4 6.3-.4Z" />
    </svg>
  );
}

export function IconPaperclip({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconEye({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
