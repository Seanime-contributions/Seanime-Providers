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
    const error = ctx.state<string | null>(null);

    // ---------- STATE SYNC ----------
    webview.channel.sync("notifications", notifications);
    webview.channel.sync("unreadCount", unreadCount);
    webview.channel.sync("loading", loading);
    webview.channel.sync("error", error);

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

    // ---------- GRAPHQL QUERIES ----------
    const GET_NOTIFICATIONS = `
      query ($page: Int, $perPage: Int, $resetNotificationCount: Boolean) {
        Page(page: $page, perPage: $perPage) {
          notifications(resetNotificationCount: $resetNotificationCount) {
            ... on AiringNotification {
              id type animeId episode createdAt
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on FollowingNotification {
              id type userId context createdAt
              user { id name avatar { large medium } }
            }
            ... on ActivityMessageNotification {
              id type userId activityId context createdAt
              message { id message }
              user { id name avatar { large medium } }
            }
            ... on ActivityMentionNotification {
              id type userId activityId context createdAt
              activity { ... on TextActivity { id text } ... on ListActivity { id } ... on MessageActivity { id } }
              user { id name avatar { large medium } }
            }
            ... on ActivityReplyNotification {
              id type userId activityId context createdAt
              activity { ... on TextActivity { id text } ... on ListActivity { id } ... on MessageActivity { id } }
              user { id name avatar { large medium } }
            }
            ... on ActivityLikeNotification {
              id type userId activityId context createdAt
              activity { ... on TextActivity { id text } ... on ListActivity { id } ... on MessageActivity { id } }
              user { id name avatar { large medium } }
            }
            ... on ActivityReplyLikeNotification {
              id type userId activityId context createdAt
              activity { ... on TextActivity { id text } ... on ListActivity { id } ... on MessageActivity { id } }
              user { id name avatar { large medium } }
            }
            ... on ActivityReplySubscribedNotification {
              id type userId activityId context createdAt
              activity { ... on TextActivity { id text } ... on ListActivity { id } ... on MessageActivity { id } }
              user { id name avatar { large medium } }
            }
            ... on ThreadCommentMentionNotification {
              id type userId commentId context createdAt
              thread { id title } comment { id }
              user { id name avatar { large medium } }
            }
            ... on ThreadCommentReplyNotification {
              id type userId commentId context createdAt
              thread { id title } comment { id }
              user { id name avatar { large medium } }
            }
            ... on ThreadCommentSubscribedNotification {
              id type userId commentId context createdAt
              thread { id title } comment { id }
              user { id name avatar { large medium } }
            }
            ... on ThreadCommentLikeNotification {
              id type userId commentId context createdAt
              thread { id title } comment { id }
              user { id name avatar { large medium } }
            }
            ... on ThreadLikeNotification {
              id type userId threadId context createdAt
              thread { id title }
              user { id name avatar { large medium } }
            }
            ... on RelatedMediaAdditionNotification {
              id type mediaId context createdAt
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaDataChangeNotification {
              id type mediaId context reason createdAt
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaMergeNotification {
              id type mediaId context reason deletedMediaTitles createdAt
              media { id title { romaji english } coverImage { large medium } }
            }
            ... on MediaDeletionNotification {
              id type deletedMediaTitle context reason createdAt
            }
          }
        }
        Viewer {
          unreadNotificationCount
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
        MarkAllNotificationsAsRead
      }
    `;

    // ---------- FETCH LOGIC ----------
    const fetchNotifications = async () => {
      try {
        loading.set(true);
        error.set(null);
        const data = await anilistFetch(GET_NOTIFICATIONS, {
          page: 1,
          perPage: 50,
          resetNotificationCount: false,
        });
        notifications.set(data?.Page?.notifications || []);
        unreadCount.set(data?.Viewer?.unreadNotificationCount ?? 0);
      } catch (err: any) {
        error.set(err.message || "Failed to fetch notifications");
      } finally {
        loading.set(false);
      }
    };

    const markAsRead = async (id: number) => {
      try {
        await anilistFetch(MARK_AS_READ, { id });
        await fetchNotifications();
      } catch {
        error.set("Failed to mark as read");
      }
    };

    const markAllAsRead = async () => {
      try {
        await anilistFetch(MARK_ALL_AS_READ);
        const data = await anilistFetch(GET_NOTIFICATIONS, {
          page: 1,
          perPage: 50,
          resetNotificationCount: true,
        });
        notifications.set(data?.Page?.notifications || []);
        unreadCount.set(0);
      } catch {
        error.set("Failed to mark all as read");
      }
    };

    // ---------- EVENT HANDLERS ----------
    webview.channel.on("refresh", () => fetchNotifications());
    webview.channel.on("mark-all-read", () => markAllAsRead());
    webview.channel.on("mark-read", (id: number) => markAsRead(id));
    webview.channel.on("open-in-seanime", (id:number) => ctx.screen.navigateTo("/entry", { "id": id }))

    // ---------- WEBVIEW CONTENT ----------
    webview.setContent(() => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          html { overflow: hidden; }

          :root {
            --bg: #0d0d0d;
            --surface: #161616;
            --surface-hover: #1e1e1e;
            --surface-active: #252525;
            --text: #e8e8e8;
            --text-muted: #666;
            --text-subtle: #444;
            --accent: #5865f2;
            --accent-dim: rgba(88,101,242,0.12);
            --border: rgba(255,255,255,0.06);
            --border-hover: rgba(255,255,255,0.12);
            --danger: #ef4444;
            --tag-bg: rgba(255,255,255,0.06);
            --shadow: 0 1px 3px rgba(0,0,0,0.4);
          }

          :root.light {
            --bg: #f5f5f5;
            --surface: #ffffff;
            --surface-hover: #f0f0f0;
            --surface-active: #e8e8e8;
            --text: #111;
            --text-muted: #888;
            --text-subtle: #bbb;
            --accent: #5865f2;
            --accent-dim: rgba(88,101,242,0.08);
            --border: rgba(0,0,0,0.07);
            --border-hover: rgba(0,0,0,0.13);
            --danger: #ef4444;
            --tag-bg: rgba(0,0,0,0.05);
            --shadow: 0 1px 3px rgba(0,0,0,0.08);
          }

          * { box-sizing: border-box; }

          body {
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            margin: 0;
            padding: 24px 20px;
            min-height: 100vh;
            transition: background 0.2s, color 0.2s;
            font-size: 14px;
            line-height: 1.5;
          }

          .container { max-width: 720px; margin: 0 auto; }

          /* ---- HEADER ---- */
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
          }

          .header-left {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .header-title {
            font-size: 1rem;
            font-weight: 600;
            letter-spacing: 0.01em;
            color: var(--text);
          }

          .badge {
            background: var(--danger);
            color: #fff;
            padding: 1px 7px;
            border-radius: 20px;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.02em;
          }

          .badge.hidden { display: none; }

          .header-right {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          /* ---- BUTTONS ---- */
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--surface);
            color: var(--text-muted);
            border: 1px solid var(--border);
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 500;
            transition: all 0.15s;
            white-space: nowrap;
          }

          .btn:hover {
            background: var(--surface-hover);
            color: var(--text);
            border-color: var(--border-hover);
          }

          .btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }

          .btn-icon {
            padding: 6px 9px;
            font-size: 0.85rem;
          }

          .btn-accent {
            background: var(--accent);
            color: #fff;
            border-color: transparent;
          }
          .btn-accent:hover {
            background: #4752c4;
            color: #fff;
          }

          /* ---- DIVIDER ---- */
          .divider {
            height: 1px;
            background: var(--border);
            margin-bottom: 16px;
          }

          /* ---- NOTIFICATION CARD ---- */
          .notification-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .notification {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px 16px;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
            position: relative;
          }

          .notification:hover {
            background: var(--surface-hover);
            border-color: var(--border-hover);
          }

          .notification.unread {
            border-left: 2px solid var(--accent);
            padding-left: 15px;
          }

          .notification-inner {
            display: flex;
            align-items: flex-start;
            gap: 12px;
          }

          /* ---- AVATAR ---- */
          .avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            background: var(--surface-active);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted);
            overflow: hidden;
          }

          .avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
          }

          /* ---- CONTENT ---- */
          .notif-body { flex: 1; min-width: 0; }

          .notif-top {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 3px;
            flex-wrap: wrap;
          }

          .notif-tag {
            font-size: 0.68rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--accent);
            background: var(--accent-dim);
            padding: 1px 6px;
            border-radius: 4px;
          }

          .notif-time {
            font-size: 0.72rem;
            color: var(--text-subtle);
            margin-left: auto;
          }

          .notif-message {
            font-size: 0.875rem;
            color: var(--text);
            margin-bottom: 6px;
            line-height: 1.45;
          }

          .username {
            font-size: 0.75rem;
            color: var(--text-muted);
            font-weight: 500;
          }

          /* ---- MEDIA PILL ---- */
          .media-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--tag-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 5px 10px 5px 6px;
            margin-top: 4px;
            max-width: 100%;
          }

          .media-pill.large {
            padding: 8px 12px 8px 8px;
          }

          .media-cover {
            width: 26px;
            height: 36px;
            border-radius: 3px;
            object-fit: cover;
            flex-shrink: 0;
          }

          .media-pill.large .media-cover {
            width: 36px;
            height: 50px;
          }

          .media-title {
            font-size: 0.8rem;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
          }

          .media-pill.large .media-title {
            font-size: 0.9rem;
          }

          /* ---- QUOTE ---- */
          .quote {
            font-size: 0.8rem;
            color: var(--text-muted);
            margin-top: 5px;
            padding: 6px 10px;
            background: var(--tag-bg);
            border-left: 2px solid var(--border-hover);
            border-radius: 0 4px 4px 0;
            line-height: 1.4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .thread-label {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 4px;
          }

          .reason-label {
            font-size: 0.72rem;
            color: var(--text-subtle);
            margin-top: 3px;
            font-style: italic;
          }

          /* ---- STATES ---- */
          .state-box {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
          }

          .state-box p { margin: 0 0 16px; font-size: 0.875rem; }

          /* ---- THEME TOGGLE ---- */
          .theme-toggle {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-muted);
            font-size: 0.85rem;
            transition: all 0.15s;
            padding: 0;
          }

          .theme-toggle:hover {
            background: var(--surface-hover);
            color: var(--text);
            border-color: var(--border-hover);
          }

          @media (max-width: 600px) {
            body { padding: 16px 14px; }
            .header { flex-wrap: wrap; gap: 10px; }
            .header-right { width: 100%; justify-content: flex-end; }
            .media-title { max-width: 160px; }
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

          // ---------- HELPERS ----------
          const formatMessage = (n) => {
            switch (n.type) {
              case "AIRING": return \`Episode \${n.episode} of \${n.media?.title?.english || n.media?.title?.romaji || "?"} aired\`
              case "FOLLOWING": return n.context || "Someone followed you"
              case "ACTIVITY_MESSAGE": return n.context || "New message on your activity"
              case "ACTIVITY_MENTION": return n.context || "You were mentioned in an activity"
              case "ACTIVITY_REPLY": return n.context || "Someone replied to your activity"
              case "ACTIVITY_LIKE": return n.context || "Someone liked your activity"
              case "ACTIVITY_REPLY_LIKE": return n.context || "Someone liked your activity reply"
              case "ACTIVITY_REPLY_SUBSCRIBED": return n.context || "New reply to a subscribed activity"
              case "THREAD_COMMENT_MENTION": return n.context || "You were mentioned in a thread comment"
              case "THREAD_COMMENT_REPLY": return n.context || "Someone replied to your thread comment"
              case "THREAD_COMMENT_SUBSCRIBED": return n.context || "New comment in a subscribed thread"
              case "THREAD_COMMENT_LIKE": return n.context || "Someone liked your thread comment"
              case "THREAD_LIKE": return n.context || "Someone liked your thread"
              case "RELATED_MEDIA_ADDITION": return n.context || "Related media was added"
              case "MEDIA_DATA_CHANGE": return n.context || \`Data change\${n.reason ? ": " + n.reason : ""}\`
              case "MEDIA_MERGE": return n.context || "Media was merged"
              case "MEDIA_DELETION": return n.context || \`"\${n.deletedMediaTitle}" was deleted\`
              default: return n.context || "Notification"
            }
          }

          const formatTime = (ts) => {
            if (!ts) return ""
            const diff = (Date.now() / 1000) - ts
            if (diff < 60) return "just now"
            if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`
            if (diff < 86400) return \`\${Math.floor(diff / 3600)}h ago\`
            if (diff < 604800) return \`\${Math.floor(diff / 86400)}d ago\`
            return new Date(ts * 1000).toLocaleDateString()
          }

          const getAniListUrl = (n) => {
            switch (n.type) {
              case "AIRING":
                // Use animeId for airing notifications
                return n.animeId ? \`https://anilist.co/anime/\${n.animeId}\` : (n.media?.id ? \`https://anilist.co/anime/\${n.media.id}\` : null)
              case "FOLLOWING":
                return n.userId ? \`https://anilist.co/user/\${n.userId}\` : null
              case "ACTIVITY_MESSAGE":
              case "ACTIVITY_MENTION":
              case "ACTIVITY_REPLY":
              case "ACTIVITY_LIKE":
              case "ACTIVITY_REPLY_LIKE":
              case "ACTIVITY_REPLY_SUBSCRIBED":
                // Try activityId first, then fall back to activity.id
                const activityId = n.activityId || n.activity?.id
                return activityId ? \`https://anilist.co/activity/\${activityId}\` : null
              case "THREAD_COMMENT_MENTION":
              case "THREAD_COMMENT_REPLY":
              case "THREAD_COMMENT_SUBSCRIBED":
              case "THREAD_COMMENT_LIKE":
                if (n.thread?.id && n.commentId) return \`https://anilist.co/forum/thread/\${n.thread.id}/comment/\${n.commentId}\`
                if (n.thread?.id) return \`https://anilist.co/forum/thread/\${n.thread.id}\`
                return null
              case "THREAD_LIKE":
                return n.thread?.id ? \`https://anilist.co/forum/thread/\${n.thread.id}\` : null
              case "RELATED_MEDIA_ADDITION":
              case "MEDIA_DATA_CHANGE":
              case "MEDIA_MERGE":
                return n.media?.id ? \`https://anilist.co/anime/\${n.media.id}\` : null
              default:
                return null
            }
          }

          const getInitials = (name) => {
            if (!name) return "?"
            return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
          }

          // ---------- APP ----------
          function App() {
            const [notifications, setNotifications] = useState([])
            const [unreadCount, setUnreadCount] = useState(0)
            const [loading, setLoading] = useState(false)
            const [error, setError] = useState(null)
            const [theme, setTheme] = useState("dark")

            useEffect(() => {
              document.documentElement.classList.toggle("light", theme === "light")
            }, [theme])

            useEffect(() => {
              if (!window.webview) return
              const u1 = window.webview.on("notifications", setNotifications)
              const u2 = window.webview.on("unreadCount", setUnreadCount)
              const u3 = window.webview.on("loading", setLoading)
              const u4 = window.webview.on("error", setError)
              return () => { u1(); u2(); u3(); u4() }
            }, [])

            const refresh = () => window.webview.send("refresh")
            const markAllRead = () => window.webview.send("mark-all-read")

            const handleNotifClick = (n) => {
              window.webview.send("mark-read", n.id)
              window.webview.send("open-in-seanime", n.media.id)
            }

            if (loading && notifications.length === 0) {
              return html\`<div class="state-box"><p>Loading notifications…</p></div>\`
            }

            if (error && notifications.length === 0) {
              return html\`
                <div class="state-box">
                  <p style="color:var(--danger)">\${error}</p>
                  <button class="btn btn-accent" onClick=\${refresh}>Retry</button>
                </div>
              \`
            }

            if (notifications.length === 0 && !loading) {
              return html\`
                <div class="state-box">
                  <p>No notifications yet</p>
                  <button class="btn btn-accent" onClick=\${refresh}>Refresh</button>
                </div>
              \`
            }

            return html\`
              <div class="container">
                <div class="header">
                  <div class="header-left">
                    <span class="header-title">Notifications</span>
                    <span class="badge \${unreadCount === 0 ? "hidden" : ""}">\${unreadCount}</span>
                  </div>
                  <div class="header-right">
                    <button
                      class="theme-toggle"
                      title="Toggle theme"
                      onClick=\${() => setTheme(t => t === "dark" ? "light" : "dark")}
                    >
                      \${theme === "dark" ? "☀" : "◑"}
                    </button>
                    <button class="btn" onClick=\${refresh} disabled=\${loading}>
                      \${loading ? "Refreshing…" : "Refresh"}
                    </button>
                    <button class="btn" onClick=\${markAllRead} disabled=\${unreadCount === 0}>
                      Mark all read
                    </button>
                  </div>
                </div>

                <div class="divider"></div>

                <div class="notification-list">
                  \${notifications.map(n => {
                    const avatar = n.user?.avatar?.large || n.user?.avatar?.medium
                    const hasLink = !!getAniListUrl(n)
                    const showAvatar = n.type !== "AIRING" && (avatar || n.user?.name)

                    return html\`
                      <div
                        class="notification \${n.unread !== false ? "unread" : ""}"
                        onClick=\${() => handleNotifClick(n)}
                        title=\${hasLink ? "Open in Seanime" : undefined}
                      >
                        <div class="notification-inner">

                          \${showAvatar && html\`
                            <div class="avatar">
                              \${avatar
                                ? html\`<img src=\${avatar} alt="" />\`
                                : html\`\${getInitials(n.user?.name)}\`
                              }
                            </div>
                          \`}

                          <div class="notif-body">
                            <div class="notif-top">
                              <span class="notif-tag">\${(n.type || "").replace(/_/g, " ")}</span>
                              \${n.user?.name && html\`
                                <span class="username">@\${n.user.name}</span>
                              \`}
                              <span class="notif-time">\${formatTime(n.createdAt)}</span>
                            </div>

                            <div class="notif-message">\${formatMessage(n)}</div>

                            \${n.media && html\`
                              <div class="media-pill \${n.type === "AIRING" ? "large" : ""}">
                                \${(n.media.coverImage?.large || n.media.coverImage?.medium) && html\`
                                  <img
                                    src=\${n.media.coverImage.large || n.media.coverImage.medium}
                                    class="media-cover"
                                    alt=""
                                  />
                                \`}
                                <span class="media-title">
                                  \${n.media.title?.english || n.media.title?.romaji || "Unknown"}
                                </span>
                              </div>
                            \`}

                            \${n.deletedMediaTitle && html\`
                              <div class="reason-label">"\${n.deletedMediaTitle}"</div>
                            \`}

                            \${n.deletedMediaTitles?.length > 0 && html\`
                              <div class="reason-label">Merged: \${n.deletedMediaTitles.join(", ")}</div>
                            \`}

                            \${(n.message?.message || n.activity?.text) && html\`
                              <div class="quote">
                                \${n.message?.message || n.activity?.text}
                              </div>
                            \`}

                            \${n.thread && html\`
                              <div class="thread-label">Thread · \${n.thread.title}</div>
                            \`}

                            \${n.reason && html\`
                              <div class="reason-label">Reason: \${n.reason}</div>
                            \`}
                          </div>
                        </div>
                      </div>
                    \`
                  })}
                </div>
              </div>
            \`
          }

          render(html\`<\${App} />\`, document.getElementById("app"))
        </script>
      </body>
      </html>
    `)

    // ---------- INITIAL FETCH ----------
    fetchNotifications();
  });
}