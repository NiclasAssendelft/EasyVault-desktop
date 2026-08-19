import type { ComponentType } from "react";

/** Shape of the shared icon components exported from src/components/icons.tsx. */
export type IconComponent = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

export type SpaceMessage = {
  id: string;
  space_id: string;
  sender_email: string;
  sender_name: string;
  message: string;
  created_at: string;
  is_pinned?: boolean;
  pinned_by?: string;
  reply_to_id?: string;
  mentions?: string[];
};

export type SpaceMember = {
  email?: string;
  role?: string;
};

/** Row returned by the `space-invite-link` edge function (`res.link` on create, `res.links[]` on list). */
export type SpaceInviteLink = {
  id?: string;
  token?: string;
  url?: string;
  role?: string;
  expires_at?: string | null;
  max_uses?: number;
  use_count?: number;
  created_at?: string;
};

export type SpaceTask = {
  id: string;
  space_id: string;
  title: string;
  is_completed: boolean;
  assigned_to: string;
  due_date: string;
  created_by: string;
  created_at: string;
};

export type ActivityEntry = {
  id: string;
  action: string;
  actor_email: string;
  details: string;
  created_at: string;
};

export type SectionId = "overview" | "files" | "chat" | "members" | "tasks" | "activity" | "settings";
