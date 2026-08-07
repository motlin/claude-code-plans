import { z } from "zod";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

/**
 * A single persisted agent notification as returned by `/api/notifications`.
 * Fields through `createdAtIso` mirror the server store's `NotificationEntry` /
 * `NotificationEntryPayload`; `unread` is derived by the API. `notificationType`
 * is the freeform discriminator (`agent_needs_input` / `agent_completed` /
 * unknown) classified in the presentation layer. `title` is optional (absent
 * when the hook carried none). `createdAt` is epoch ms; `createdAtIso` is the ISO
 * form used for relative-time rendering.
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
  unread: z.boolean(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationsResponse = z.object({
  notifications: z.array(NotificationSchema),
});
export type NotificationsData = z.infer<typeof NotificationsResponse>;

const NotificationMutationResponse = z.object({ ok: z.boolean() });

/** Newest-first list of all persisted notifications across every project. */
export const notificationsQueryOptions = () =>
  queryOptions({
    queryKey: ["notifications"] as const,
    queryFn: () => apiFetch("/api/notifications", NotificationsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** Newest-first notifications scoped to a single project. */
export const projectNotificationsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["notifications", projectId] as const,
    queryFn: () =>
      apiFetch(
        `/api/notifications?projectId=${encodeURIComponent(projectId)}`,
        NotificationsResponse,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/**
 * Remove `id` from every cached notifications slice. The project-scoped caches
 * are keyed by projectId, so getQueriesData matches the global list and every
 * per-project slice in one pass — mirroring `applyApprovalResolved`.
 */
function removeFromCache(qc: QueryClient, id: string): void {
  for (const [key, data] of qc.getQueriesData<NotificationsData>({ queryKey: ["notifications"] })) {
    if (!data) continue;
    qc.setQueryData<NotificationsData>(key, {
      notifications: data.notifications.filter((n) => n.id !== id),
    });
  }
}

/** Empty every cached notifications slice (global + per-project). */
function clearCache(qc: QueryClient): void {
  for (const [key, data] of qc.getQueriesData<NotificationsData>({ queryKey: ["notifications"] })) {
    if (!data) continue;
    qc.setQueryData<NotificationsData>(key, { notifications: [] });
  }
}

export function markNotificationsReadInCache(qc: QueryClient): void {
  for (const [key, data] of qc.getQueriesData<NotificationsData>({ queryKey: ["notifications"] })) {
    if (!data) continue;
    qc.setQueryData<NotificationsData>(key, {
      notifications: data.notifications.map((notification) => ({
        ...notification,
        unread: false,
      })),
    });
  }
}

/** Dismiss a single notification (DELETE /api/notifications/:id) with optimistic removal. */
export const useDismissNotification = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/notifications/${encodeURIComponent(id)}`, NotificationMutationResponse, {
        method: "DELETE",
      }),
    onMutate: (id: string) => {
      removeFromCache(qc, id);
    },
  });
};

/** Clear all notifications (DELETE /api/notifications) with optimistic emptying. */
export const useClearNotifications = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/notifications", NotificationMutationResponse, { method: "DELETE" }),
    onMutate: () => {
      clearCache(qc);
    },
  });
};

/** Mark all notifications read (PATCH /api/notifications) while keeping their history visible. */
export const useMarkNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/notifications", NotificationMutationResponse, { method: "PATCH" }),
    onMutate: () => {
      markNotificationsReadInCache(qc);
    },
  });
};
