/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
  $ui.register((ctx) => {
    // ---------- WEBVIEW SETUP ----------
    const webview = ctx.newWebview({
      slot: "screen",
      fullWidth: true,
      autoHeight: true,
      sidebar: {
        label: "Notifications",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
      },
    });

    // ---------- STATE ----------
    const notifications = ctx.state<any[]>([]);
    const unreadCount = ctx.state<number>(0);
    const loading = ctx.state<boolean>(false);
    const loadingMore = ctx.state<boolean>(false);
    const error = ctx.state<string | null>(null);
    const page = ctx.state<number>(1);
    const hasNextPage = ctx.state<boolean>(false);

    // ---------- STATE SYNC ----------
    webview.channel.sync("notifications", notifications);
    webview.channel.sync("unreadCount", unreadCount);
    webview.channel.sync("loading", loading);
    webview.channel.sync("loadingMore", loadingMore);
    webview.channel.sync("error", error);
    webview.channel.sync("hasNextPage", hasNextPage);

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

    // GraphQL queries - Enhanced with media details
    const GET_NOTIFICATIONS = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          notifications {
            ... on AiringNotification { 
              id type read createdAt mediaId episode 
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on FollowingNotification { 
              id type read createdAt userId 
              user { id name avatar { large medium } }
            }
            ... on ActivityMessageNotification { 
              id type read createdAt activityId 
              activity { id ... on TextActivity { text user { name avatar { large medium } } } }
            }
            ... on ActivityMentionNotification { 
              id type read createdAt activityId 
              activity { id ... on TextActivity { text user { name avatar { large medium } } } }
            }
            ... on ThreadCommentMentionNotification { 
              id type read createdAt threadId commentId 
              thread { id title user { name } }
              comment { id user { name avatar { large medium } } }
            }
            ... on ThreadCommentReplyNotification { 
              id type read createdAt threadId commentId 
              thread { id title user { name } }
              comment { id user { name avatar { large medium } } }
            }
            ... on ThreadCommentSubscribedNotification { 
              id type read createdAt threadId commentId 
              thread { id title user { name } }
              comment { id user { name avatar { large medium } } }
            }
            ... on RelatedMediaAdditionNotification { 
              id type read createdAt mediaId 
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaDataChangeNotification { 
              id type read createdAt mediaId reason 
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaMergeNotification { 
              id type read createdAt mediaId deletedMediaTitles 
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaDeletionNotification { 
              id type read createdAt mediaId deletedMediaTitle 
              media { id title { romaji english } coverImage { large medium } }
            }
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
    const updateUnreadCount = () => {
      const count = notifications.get().filter((n) => !n.read).length;
      unreadCount.set(count);
    };

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
    webview.channel.on("refresh", () => refresh());
    webview.channel.on("mark-all-read", () => markAllAsRead());
    webview.channel.on("load-more", () => {
      if (hasNextPage.get() && !loadingMore.get()) fetchNotifications(false, true);
    });
    webview.channel.on("mark-read", (id: number) => markAsRead(id));

    // ---------- WEBVIEW CONTENT ----------
    webview.setContent(() => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          html {
            color-scheme: dark;
            overflow: hidden;
          }
          :root {
            --bg: #101010;
            --card: #10161f;
            --card-hover: #1a2230;
            --text: #e2e8f0;
            --text-muted: #94a3b8;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --border: rgba(255,255,255,0.1);
            --success: #10b981;
            --danger: #ef4444;
          }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, system-ui, sans-serif;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
          }
          .header h1 {
            margin: 0;
            font-size: 1.5rem;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .badge {
            background: var(--danger);
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
          }
          .badge.hidden {
            display: none;
          }
          .actions {
            display: flex;
            gap: 8px;
          }
          button {
            background: var(--accent);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.875rem;
            transition: all 0.2s;
          }
          button:hover {
            background: var(--accent-hover);
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          button.secondary {
            background: rgba(255,255,255,0.1);
          }
          button.secondary:hover {
            background: rgba(255,255,255,0.15);
          }
          .notification-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .notification {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px;
            transition: all 0.2s;
            cursor: pointer;
          }
          .notification:hover {
            background: var(--card-hover);
            border-color: rgba(255,255,255,0.2);
          }
          .notification.unread {
            border-left: 3px solid var(--accent);
          }
          .notification.read {
            opacity: 0.7;
          }
          .notification-header {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 8px;
          }
          .notification-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .notification-content {
            flex: 1;
            min-width: 0;
          }
          .notification-type {
            font-size: 0.75rem;
            color: var(--accent);
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .notification-message {
            font-size: 0.9rem;
            line-height: 1.4;
            margin-bottom: 4px;
          }
          .notification-media {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 8px;
            padding: 8px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
          }
          .notification-media-cover {
            width: 32px;
            height: 45px;
            border-radius: 4px;
            object-fit: cover;
            flex-shrink: 0;
          }
          .notification-media-title {
            font-size: 0.85rem;
            color: var(--text-muted);
          }
          .notification-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--border);
          }
          .notification-time {
            font-size: 0.75rem;
            color: var(--text-muted);
          }
          .mark-read-btn {
            background: var(--accent);
            padding: 4px 12px;
            font-size: 0.75rem;
          }
          .loading, .error, .empty {
            text-align: center;
            padding: 40px;
            color: var(--text-muted);
          }
          .error {
            color: var(--danger);
          }
          .load-more {
            text-align: center;
            margin-top: 16px;
          }
          @media (max-width: 640px) {
            body {
              padding: 12px;
            }
            .header {
              flex-direction: column;
              align-items: flex-start;
              gap: 12px;
            }
            .actions {
              width: 100%;
            }
            .actions button {
              flex: 1;
            }
          }
        </style>
      </head>
      <body>
        <div id="app"></div>

        <script type="module">
          import { h, render } from "https://esm.sh/preact@10.19.3"
          import { useState, useEffect } from "https://esm.sh/preact@10.19.3/hooks"
          import htm from "https://esm.sh/htm@3.1.1"
          
          const html = htm.bind(h)

          function App() {
            const [notifications, setNotifications] = useState([])
            const [unreadCount, setUnreadCount] = useState(0)
            const [loading, setLoading] = useState(false)
            const [loadingMore, setLoadingMore] = useState(false)
            const [error, setError] = useState(null)
            const [hasNextPage, setHasNextPage] = useState(false)

            useEffect(() => {
              if (!window.webview) return

              const unsubNotifications = window.webview.on("notifications", setNotifications)
              const unsubUnreadCount = window.webview.on("unreadCount", setUnreadCount)
              const unsubLoading = window.webview.on("loading", setLoading)
              const unsubLoadingMore = window.webview.on("loadingMore", setLoadingMore)
              const unsubError = window.webview.on("error", setError)
              const unsubHasNextPage = window.webview.on("hasNextPage", setHasNextPage)

              return () => {
                unsubNotifications()
                unsubUnreadCount()
                unsubLoading()
                unsubLoadingMore()
                unsubError()
                unsubHasNextPage()
              }
            }, [])

            const formatMessage = (n) => {
              switch (n.type) {
                case "AIRING": return \`Episode \${n.episode} aired\`
                case "FOLLOWING": return \`User followed you\`
                case "ACTIVITY_MESSAGE": return \`New message on activity\`
                case "ACTIVITY_MENTION": return \`Mentioned in activity\`
                case "THREAD_COMMENT_MENTION": return \`Mentioned in thread\`
                case "THREAD_COMMENT_REPLY": return \`Reply in thread\`
                case "THREAD_COMMENT_SUBSCRIBED": return \`New comment in subscribed thread\`
                case "RELATED_MEDIA_ADDITION": return \`Related media added\`
                case "MEDIA_DATA_CHANGE": return \`Data change: \${n.reason || ""}\`
                case "MEDIA_MERGE": return \`Media merged\`
                case "MEDIA_DELETION": return \`Media deleted\`
                default: return \`Notification\`
              }
            }

            const formatTime = (timestamp) => {
              const date = new Date(timestamp * 1000)
              const now = new Date()
              const diff = (now - date) / 1000
              
              if (diff < 60) return "Just now"
              if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`
              if (diff < 86400) return \`\${Math.floor(diff / 3600)}h ago\`
              if (diff < 604800) return \`\${Math.floor(diff / 86400)}d ago\`
              return date.toLocaleDateString()
            }

            const refresh = () => window.webview.send("refresh")
            const markAllRead = () => window.webview.send("mark-all-read")
            const loadMore = () => window.webview.send("load-more")
            const markRead = (id) => window.webview.send("mark-read", id)

            if (loading && notifications.length === 0) {
              return html\`<div class="loading">Loading notifications...</div>\`
            }

            if (error && notifications.length === 0) {
              return html\`
                <div class="error">
                  <p>\${error}</p>
                  <button onClick=\${refresh}>Retry</button>
                </div>
              \`
            }

            if (notifications.length === 0 && !loading) {
              return html\`
                <div class="empty">
                  <p>No notifications yet</p>
                  <button onClick=\${refresh}>Refresh</button>
                </div>
              \`
            }

            return html\`
              <div class="container">
                <div class="header">
                  <h1>
                    Notifications
                    <span class="badge \${unreadCount === 0 ? 'hidden' : ''}">\${unreadCount}</span>
                  </h1>
                  <div class="actions">
                    <button class="secondary" onClick=\${refresh}>
                      \${loading ? "Refreshing..." : "Refresh"}
                    </button>
                    <button class="secondary" onClick=\${markAllRead} disabled=\${unreadCount === 0}>
                      Mark all read
                    </button>
                  </div>
                </div>

                <div class="notification-list">
                  \${notifications.map(n => html\`
                    <div class="notification \${n.read ? 'read' : 'unread'}" onClick=\${() => !n.read && markRead(n.id)}>
                      <div class="notification-header">
                        \${n.user?.avatar?.large && html\`
                          <img src=\${n.user.avatar.large || n.user.avatar.medium} class="notification-avatar" alt="" />
                        \`}
                        \${n.comment?.user?.avatar?.large && html\`
                          <img src=\${n.comment.user.avatar.large || n.comment.user.avatar.medium} class="notification-avatar" alt="" />
                        \`}
                        \${!n.user?.avatar && !n.comment?.user?.avatar && html\`
                          <div class="notification-avatar" style="background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">🔔</div>
                        \`}
                        <div class="notification-content">
                          <div class="notification-type">\${n.type.replace(/_/g, " ")}</div>
                          <div class="notification-message">\${formatMessage(n)}</div>
                          \${n.media && html\`
                            <div class="notification-media">
                              \${n.media.coverImage?.large && html\`
                                <img src=\${n.media.coverImage.large || n.media.coverImage.medium} class="notification-media-cover" alt="" />
                              \`}
                              <div class="notification-media-title">\${n.media.title?.english || n.media.title?.romaji || "Unknown Media"}</div>
                            </div>
                          \`}
                        </div>
                      </div>
                      <div class="notification-footer">
                        <span class="notification-time">\${formatTime(n.createdAt)}</span>
                        \${!n.read && html\`
                          <button class="mark-read-btn" onClick=\${(e) => { e.stopPropagation(); markRead(n.id) }}>
                            Mark read
                          </button>
                        \`}
                      </div>
                    </div>
                  \`)}
                </div>

                \${hasNextPage && html\`
                  <div class="load-more">
                    <button class="secondary" onClick=\${loadMore} disabled=\${loadingMore}>
                      \${loadingMore ? "Loading..." : "Load more"}
                    </button>
                  </div>
                \`}
              </div>
            \`
          }

          render(html\`<\${App} />\`, document.getElementById("app"))
        </script>
      </body>
      </html>
    `)

    // ---------- INITIAL FETCH ----------
    refresh();
  });
}