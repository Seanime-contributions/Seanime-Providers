/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
  $ui.register((ctx) => {
    // ---------- TRAY SETUP ----------
    const tray = ctx.newTray({
      tooltipText: "AniList Notifications",
      iconUrl: "https://anilist.co/img/icons/favicon-32x32.png",
      withContent: true,
      isDrawer: false,
    });

    // ---------- STATE ----------
    const notifications = ctx.state<any[]>([]);
    const unreadCount = ctx.state<number>(0);
    const loading = ctx.state<boolean>(false);
    const loadingMore = ctx.state<boolean>(false);
    const error = ctx.state<string | null>(null);
    const page = ctx.state<number>(1);
    const hasNextPage = ctx.state<boolean>(false);

    // Helper: update badge and unread count
    const updateUnreadCount = () => {
      const count = notifications.get().filter((n) => !n.read).length;
      unreadCount.set(count);
      if (count > 0) {
        tray.updateBadge({ number: count, intent: "alert" });
      } else {
        tray.updateBadge({ number: 0 });
      }
    };

    // ---------- ANILIST HELPERS ----------
    const getToken = () => {
      const token = $database.anilist.getToken();
      if (!token) throw new Error("AniList token missing. Please authenticate in Seanime settings.");
      return token;
    };

    const anilistFetch = async (query: string, variables: any = {}) => {
      const token = getToken();
      const res = await ctx.fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0].message);
      return json.data;
    };

    // GraphQL queries
    const GET_NOTIFICATIONS = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          notifications {
            ... on AiringNotification { id type read createdAt mediaId episode }
            ... on FollowingNotification { id type read createdAt userId }
            ... on ActivityMessageNotification { id type read createdAt activityId }
            ... on ActivityMentionNotification { id type read createdAt activityId }
            ... on ThreadCommentMentionNotification { id type read createdAt threadId commentId }
            ... on ThreadCommentReplyNotification { id type read createdAt threadId commentId }
            ... on ThreadCommentSubscribedNotification { id type read createdAt threadId commentId }
            ... on RelatedMediaAdditionNotification { id type read createdAt mediaId }
            ... on MediaDataChangeNotification { id type read createdAt mediaId reason }
            ... on MediaMergeNotification { id type read createdAt mediaId deletedMediaTitles }
            ... on MediaDeletionNotification { id type read createdAt mediaId deletedMediaTitle }
          }
        }
      }
    `;

    const MARK_AS_READ = `
      mutation ($id: Int) {
        MarkNotificationAsRead(id: $id) { id read }
      }
    `;

    const MARK_ALL_AS_READ = `
      mutation {
        MarkAllNotificationsAsRead { id read }
      }
    `;

    // ---------- FETCH LOGIC ----------
    const fetchNotifications = async (reset = true, loadMore = false) => {
      try {
        if (reset) {
          loading.set(true);
          error.set(null);
          page.set(1);
        } else if (loadMore) {
          loadingMore.set(true);
        }

        const currentPage = loadMore ? page.get() + 1 : 1;
        const data = await anilistFetch(GET_NOTIFICATIONS, { page: currentPage, perPage: 20 });
        const pageInfo = data.Page.pageInfo;
        const newNotifs = data.Page.notifications || [];

        if (reset) {
          notifications.set(newNotifs);
          page.set(1);
          hasNextPage.set(pageInfo.hasNextPage);
        } else if (loadMore) {
          notifications.set([...notifications.get(), ...newNotifs]);
          page.set(currentPage);
          hasNextPage.set(pageInfo.hasNextPage);
        }

        updateUnreadCount();
      } catch (err: any) {
        error.set(err.message || "Failed to fetch notifications");
      } finally {
        loading.set(false);
        loadingMore.set(false);
      }
    };

    const markAsRead = async (id: number) => {
      const old = notifications.get();
      const updated = old.map((n) => (n.id === id ? { ...n, read: true } : n));
      notifications.set(updated);
      updateUnreadCount();

      try {
        await anilistFetch(MARK_AS_READ, { id });
      } catch {
        notifications.set(old);
        updateUnreadCount();
        error.set("Failed to mark as read");
      }
    };

    const markAllAsRead = async () => {
      const old = notifications.get();
      const updated = old.map((n) => ({ ...n, read: true }));
      notifications.set(updated);
      updateUnreadCount();

      try {
        await anilistFetch(MARK_ALL_AS_READ);
        await fetchNotifications(true);
      } catch {
        notifications.set(old);
        updateUnreadCount();
        error.set("Failed to mark all as read");
      }
    };

    const refresh = () => fetchNotifications(true);

    // ---------- EVENT HANDLERS ----------
    ctx.registerEventHandler("refresh", () => refresh());
    ctx.registerEventHandler("mark-all-read", () => markAllAsRead());
    ctx.registerEventHandler("load-more", () => {
      if (hasNextPage.get() && !loadingMore.get()) fetchNotifications(false, true);
    });

    // Dynamic handler for each notification
    const getMarkReadHandler = (id: number) => {
      const handlerId = `mark-read-${id}`;
      ctx.registerEventHandler(handlerId, () => markAsRead(id));
      return handlerId;
    };

    // Format message
    const formatMessage = (n: any): string => {
      switch (n.type) {
        case "AIRING": return `Episode ${n.episode} of media ${n.mediaId} aired`;
        case "FOLLOWING": return `User ${n.userId} followed you`;
        case "ACTIVITY_MESSAGE": return `New message on activity ${n.activityId}`;
        case "ACTIVITY_MENTION": return `Mentioned in activity ${n.activityId}`;
        case "THREAD_COMMENT_MENTION": return `Mentioned in thread ${n.threadId}`;
        case "THREAD_COMMENT_REPLY": return `Reply in thread ${n.threadId}`;
        case "THREAD_COMMENT_SUBSCRIBED": return `New comment in thread ${n.threadId}`;
        case "RELATED_MEDIA_ADDITION": return `Related media added to media ${n.mediaId}`;
        case "MEDIA_DATA_CHANGE": return `Data change on media ${n.mediaId}: ${n.reason || ""}`;
        case "MEDIA_MERGE": return `Media merged: ${n.deletedMediaTitles?.join(", ") || ""}`;
        case "MEDIA_DELETION": return `Media deleted: ${n.deletedMediaTitle || ""}`;
        default: return `Notification (${n.type})`;
      }
    };

    // ---------- TRAY RENDER ----------
    tray.render(() => {
      const notifs = notifications.get();
      const isLoading = loading.get() && notifs.length === 0;
      const hasError = error.get() && notifs.length === 0;
      const showLoadMore = hasNextPage.get() && !loadingMore.get() && notifs.length > 0;
      const allRead = notifs.every((n) => n.read);

      if (isLoading) {
        return tray.stack({ items: [tray.text("Loading notifications...")] });
      }

      if (hasError) {
        return tray.stack({
          items: [
            tray.alert(error.get()!, { intent: "error" }),
            tray.button("Retry", { onClick: "refresh", className: "mt-2" }),
          ],
        });
      }

      const header = tray.flex(
        [
          tray.text("Notifications", { className: "font-bold text-lg" }),
          tray.flex(
            [
              tray.button("Refresh", { size: "sm", intent: "gray-subtle", onClick: "refresh" }),
              tray.button("Mark all read", {
                size: "sm",
                intent: "gray-subtle",
                onClick: "mark-all-read",
                disabled: allRead,
              }),
            ],
            { gap: 2 }
          ),
        ],
        { justify: "between", align: "center", className: "mb-3" }
      );

      const items = notifs.map((n) => {
        const time = new Date(n.createdAt * 1000).toLocaleString();
        const isRead = n.read;
        return tray.div(
          [
            tray.flex(
              [
                tray.div(
                  [
                    tray.text(formatMessage(n), {
                      className: `text-sm ${isRead ? "text-gray-500" : "font-semibold"}`,
                    }),
                    tray.text(time, { className: "text-xs text-gray-400" }),
                  ],
                  { direction: "col" }
                ),
                !isRead &&
                  tray.button("Mark read", {
                    size: "sm",
                    intent: "primary",
                    onClick: getMarkReadHandler(n.id),
                  }),
              ],
              { justify: "between", align: "center", gap: 2 }
            ),
          ],
          { className: `p-2 rounded ${!isRead ? "bg-gray-800" : ""} mb-1` }
        );
      });

      const loadMoreButton = showLoadMore
        ? tray.button("Load more", { onClick: "load-more", intent: "gray-subtle", className: "mt-2" })
        : null;
      const loadingMoreIndicator = loadingMore.get()
        ? tray.text("Loading more...", { className: "text-center text-sm mt-2" })
        : null;

      return tray.stack({
        items: [header, ...items, loadMoreButton, loadingMoreIndicator],
        style: { maxHeight: "500px", overflowY: "auto" },
      });
    });

    // ---------- TRAY EVENTS ----------
    tray.onOpen(() => {
      if (notifications.get().length === 0 || error.get()) refresh();
      else fetchNotifications(true).catch(() => {});
    });

    // Initial fetch (so badge appears even without opening tray)
    refresh();
  });
}