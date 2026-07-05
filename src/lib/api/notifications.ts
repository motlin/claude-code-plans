import { z } from "zod";

/**
 * A single persisted agent notification as returned by `/api/notifications`.
 * Mirrors the server store's `NotificationEntry` / `NotificationEntryPayload`.
 * `notificationType` is the freeform discriminator (`agent_needs_input` /
 * `agent_completed` / unknown) classified in the presentation layer. `title` is
 * optional (absent when the hook carried none). `createdAt` is epoch ms;
 * `createdAtIso` is the ISO form used for relative-time rendering.
 */
const NotificationSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  message: z.string(),
  title: z.string().optional(),
  notificationType: z.string(),
  createdAt: z.number(),
  createdAtIso: z.string(),
});

export const NotificationsResponse = z.object({
  notifications: z.array(NotificationSchema),
});
