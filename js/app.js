// MyVerse 앱 로직: 라우팅, 렌더링, 이벤트
(function () {
  const S = window.Store;
  const E = window.Engine;

  // ============ 테마 ============
  const THEME_KEY = "myverse-theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
  }
  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  };
  (function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
    else applyTheme(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  })();

  // ============ 헬퍼 ============
  function $(sel) { return document.querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function relativeTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 50) return "방금";
    if (diff < 3600) return Math.floor(diff / 60) + "분 전";
    if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
    if (diff < 172800) return "어제";
    return Math.floor(diff / 86400) + "일 전";
  }

  function avatarHtml(p, size) {
    const s = size || 38;
    return `<div class="avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.37)}px;background:${p.avatar.gradient}">${esc(p.avatar.initial)}</div>`;
  }
  function userAvatarHtml(size) {
    const s = size || 38;
    const u = S.getUser();
    const initial = u && u.nickname ? u.nickname[0] : "나";
    return `<div class="avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.37)}px;background:var(--brand-gradient)">${esc(initial)}</div>`;
  }

  const MEDIA_EMOJI = { cafe: "☕", music: "🎵", photo: "📷", mood: "🌙", emotional: "🌙", food: "🍜", fashion: "👗", text: "" };
  function mediaClass(t) { return ["cafe", "music", "photo", "emotional", "food", "fashion"].includes(t) ? t : ""; }

  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // ============ 라우팅 ============
  const SCREENS = {
    onboarding: { hideHeader: 1, hideTab: 1, hideFab: 1 },
    feed: { title: "MyVerse" },
    postDetail: { hideHeader: 1, hideFab: 1, flex: 1 },
    compose: { hideHeader: 1, hideTab: 1, hideFab: 1 },
    profile: { title: "프로필" },
    dm: { title: "메시지" },
    dmChat: { hideHeader: 1, hideTab: 1, hideFab: 1, flex: 1 },
    notifications: { hideHeader: 1, hideFab: 1 },
    explore: { title: "탐색" },
    campaign: { hideHeader: 1, hideFab: 1 },
    settings: { hideHeader: 1, hideFab: 1 },
  };
  let current = "feed";

  window.goto = function (name, arg) {
    if (!SCREENS[name]) return;
    // 렌더링 (진입 시점에 최신 데이터)
    if (renderers[name]) renderers[name](arg);

    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el("screen-" + name).classList.add("active");

    const c = SCREENS[name];
    el("header").style.display = c.hideHeader ? "none" : "flex";
    el("fab").style.display = c.hideFab ? "none" : "flex";
    el("tabbar").style.display = c.hideTab ? "none" : "flex";
    if (c.title) el("header-title").textContent = c.title;

    const tabMap = { feed: 0, explore: 1, compose: 2, dm: 3, profile: 4 };
    document.querySelectorAll(".tab-bar .tab").forEach((t) => t.classList.remove("active"));
    if (name in tabMap) document.querySelectorAll(".tab-bar .tab")[tabMap[name]].classList.add("active");

    if (!c.flex) el("screen-" + name).scrollTop = 0;
    current = name;
    updateBadges();
  };

  function updateBadges() {
    const dmCount = S.totalUnreadDm();
    const ntfCount = S.unreadNotifications();
    const dmBadge = el("badge-dm");
    const ntfBadge = el("badge-ntf");
    if (dmBadge) { dmBadge.textContent = dmCount; dmBadge.classList.toggle("hidden", dmCount === 0); }
    if (ntfBadge) { ntfBadge.textContent = ntfCount; ntfBadge.classList.toggle("hidden", ntfCount === 0); }
    const tabDm = el("tab-dm-badge");
    if (tabDm) { tabDm.textContent = dmCount; tabDm.classList.toggle("hidden", dmCount === 0); }
  }

  // ============ 렌더러 ============
  const renderers = {};

  // ---- 피드 ----
  renderers.feed = function () {
    const posts = S.getPosts();
    const activeIds = S.getActivePersonaIds();

    // 스토리바
    let stories = `<div class="story"><div class="story-avatar"><div><div style="background:var(--brand-gradient)">${esc((S.getUser() || {}).nickname?.[0] || "나")}</div></div></div><div class="story-name">내 스토리</div></div>`;
    activeIds.forEach((id) => {
      const p = window.getPersona(id);
      if (p) stories += `<div class="story" onclick="goto('dmChat','${p.id}')"><div class="story-avatar"><div><div style="background:${p.avatar.gradient}">${esc(p.avatar.initial)}</div></div></div><div class="story-name">${esc(p.name)}</div></div>`;
    });
    el("feed-stories").innerHTML = stories;

    // 게시물
    if (!posts.length) {
      el("feed-posts").innerHTML = `<div class="empty-state"><div class="emoji">✍️</div><div class="title">첫 게시물을 올려보세요</div><div class="desc">오늘 있었던 일, 지금 기분, 아무 말이라도 좋아요.<br>올리면 사람들이 하나둘 반응하기 시작해요.</div></div>`;
      return;
    }
    el("feed-posts").innerHTML = posts.map(postCardHtml).join("");
  };

  function postCardHtml(post) {
    const comments = S.getComments(post.id).filter((c) => !c.parentId);
    const preview = comments.slice(0, 2).map((c) => {
      const p = window.getPersona(c.personaId);
      return `<div class="comment-line"><span class="name">${esc(p ? p.name : "")}</span>${esc(c.text)}</div>`;
    }).join("");
    const moreCount = S.countComments(post.id);
    const media = mediaClass(post.mediaTag);
    return `<article class="post">
      <div class="post-header">
        ${userAvatarHtml(38)}
        <div class="post-meta"><div class="post-name-row"><span>${esc((S.getUser() || {}).nickname || "나")}</span></div><div class="post-sub">${relativeTime(post.createdAt)}</div></div>
        <div class="icon-btn" onclick="event.stopPropagation();App.deletePost('${post.id}')" title="삭제">⋯</div>
      </div>
      <div class="post-content">${esc(post.content)}</div>
      ${media ? `<div class="post-image ${media}">${MEDIA_EMOJI[media] || ""}</div>` : ""}
      <div class="post-actions">
        <div class="post-action ${post.likeCount > 0 ? "liked" : ""}" onclick="App.likePost('${post.id}', this)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="${post.likeCount > 0 ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          <span>${post.likeCount}</span>
        </div>
        <div class="post-action" onclick="goto('postDetail','${post.id}')">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          <span>${moreCount}</span>
        </div>
        <div class="post-action"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
      </div>
      <div class="post-stats">좋아요 ${post.likeCount}개${post.reach ? " · 노출 " + post.reach.toLocaleString() + "회" : ""}</div>
      ${preview ? `<div class="post-comments-preview">${preview}${moreCount > 2 ? `<div class="view-more" onclick="goto('postDetail','${post.id}')">댓글 ${moreCount}개 모두 보기</div>` : ""}</div>` : ""}
    </article>`;
  }

  // ---- 게시물 상세 ----
  let detailPostId = null;
  renderers.postDetail = function (postId) {
    if (postId) detailPostId = postId;
    const post = S.getPost(detailPostId);
    if (!post) { goto("feed"); return; }
    const media = mediaClass(post.mediaTag);
    el("detail-post").innerHTML = `<article class="post" style="border-bottom:none">
      <div class="post-header">${userAvatarHtml(38)}
        <div class="post-meta"><div class="post-name-row"><span>${esc((S.getUser() || {}).nickname || "나")}</span></div><div class="post-sub">${relativeTime(post.createdAt)}</div></div>
        <div class="icon-btn" onclick="App.deletePost('${post.id}')" title="삭제">⋯</div>
      </div>
      <div class="post-content">${esc(post.content)}</div>
      ${media ? `<div class="post-image ${media}">${MEDIA_EMOJI[media] || ""}</div>` : ""}
      <div class="post-actions">
        <div class="post-action ${post.likeCount > 0 ? "liked" : ""}" onclick="App.likePost('${post.id}', this)"><svg width="22" height="22" viewBox="0 0 24 24" fill="${post.likeCount > 0 ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span>${post.likeCount}</span></div>
        <div class="post-action"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><span>${S.countComments(post.id)}</span></div>
      </div>
      <div class="post-stats">좋아요 ${post.likeCount}개${post.reach ? " · 노출 " + post.reach.toLocaleString() + "회" : ""}</div>
    </article>`;
    el("detail-comment-count").textContent = "댓글 " + S.countComments(post.id) + "개";
    renderDetailComments();
  };

  function renderDetailComments() {
    const post = S.getPost(detailPostId);
    if (!post) return;
    const tops = S.getTopLevelComments(post.id);
    if (!tops.length) {
      el("detail-comments").innerHTML = `<div class="empty-state" style="padding:30px"><div class="desc">아직 댓글이 없어요.<br>곧 반응이 도착해요.</div></div>`;
      return;
    }
    el("detail-comments").innerHTML = tops.map(commentHtml).join("");
  }

  function commentHtml(c, isReply) {
    const p = window.getPersona(c.personaId);
    if (!p) return "";
    const replies = isReply ? [] : S.getReplies(c.id);
    return `<div class="comment ${isReply ? "" : ""}">
      ${avatarHtml(p, isReply ? 28 : 38)}
      <div class="comment-body">
        <div class="comment-bubble">
          <div class="comment-name-row"><span>${esc(p.name)}</span><span class="comment-handle">@${esc(p.handle)}</span></div>
          <div class="comment-text">${esc(c.text)}</div>
        </div>
        <div class="comment-meta"><span>${relativeTime(c.createdAt)}</span>${c.likeCount ? `<span class="liked-count">♥ ${c.likeCount}</span>` : "<span>좋아요</span>"}<span>답글</span></div>
        ${replies.map((r) => `<div class="reply">${commentHtml(r, true)}</div>`).join("")}
      </div>
    </div>`;
  }

  // 댓글 도착 시 라이브 추가 (상세 화면 보고 있을 때)
  function appendCommentLive(comment, persona) {
    if (current !== "postDetail" || comment.postId !== detailPostId) return;
    const wrap = el("detail-comments");
    const empty = wrap.querySelector(".empty-state");
    if (empty) wrap.innerHTML = "";
    const div = document.createElement("div");
    div.innerHTML = commentHtml(comment);
    const node = div.firstElementChild;
    node.classList.add("fade-in");
    wrap.appendChild(node);
    el("detail-comment-count").textContent = "댓글 " + S.countComments(detailPostId) + "개";
    const sc = el("screen-postDetail-scroll");
    if (sc) sc.scrollTop = sc.scrollHeight;
  }
  function refreshDetailAfterReply() {
    if (current === "postDetail") renderDetailComments();
  }

  function showTyping(on) {
    if (current !== "postDetail") return;
    let t = el("detail-typing");
    if (on) {
      if (!t) {
        t = document.createElement("div");
        t.id = "detail-typing";
        t.className = "typing-indicator";
        t.innerHTML = `<span>반응이 오는 중</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
        el("detail-comments").parentElement.insertBefore(t, el("detail-comments").nextSibling);
      }
    } else if (t) t.remove();
  }

  // ---- 프로필 ----
  renderers.profile = function () {
    const u = S.getUser() || {};
    el("profile-content").innerHTML = `
      <div class="profile-header">
        <div class="profile-top">
          <div class="profile-avatar">${esc(u.nickname?.[0] || "나")}</div>
          <div class="profile-stats">
            <div class="profile-stat"><div class="profile-stat-num">${u.postCount || 0}</div><div class="profile-stat-label">게시물</div></div>
            <div class="profile-stat"><div class="profile-stat-num">${u.followerCount || 0}</div><div class="profile-stat-label">팔로워</div></div>
            <div class="profile-stat"><div class="profile-stat-num">${S.getActivePersonaIds().length}</div><div class="profile-stat-label">팔로잉</div></div>
          </div>
        </div>
        <div class="profile-name">${esc(u.nickname || "나")}</div>
        <div class="profile-bio">${esc(u.bio || "")}${(u.interests || []).length ? "<br>" + u.interests.map((i) => "#" + esc(i)).join(" ") : ""}</div>
        <div class="profile-actions"><button onclick="goto('settings')">설정</button><button onclick="App.shareProfile()">공유</button></div>
      </div>
      <div class="growth-card">
        <h4>이번 주 성장</h4>
        <div class="stat-row"><span class="stat-label">팔로워</span><span class="stat-val">${u.followerCount || 0}명</span></div>
        <div class="stat-row"><span class="stat-label">게시물</span><span class="stat-val">${u.postCount || 0}개</span></div>
        <div class="stat-row"><span class="stat-label">함께하는 사람</span><span class="stat-val">${S.getActivePersonaIds().length}명</span></div>
      </div>
      <div class="section-title">나와 잘 맞는 사람</div>
      <div id="profile-personas"></div>
      <div class="profile-tabs"><div class="profile-tab active">게시물</div></div>
      <div class="post-grid" id="profile-grid"></div>`;

    const personaRows = S.getActivePersonaIds().map((id) => {
      const p = window.getPersona(id);
      const rel = S.getRelationship(id) || {};
      const relClass = rel.status === "close_friend" ? "close" : rel.status === "active_fan" ? "fan" : "";
      return `<div class="persona-row" onclick="goto('dmChat','${p.id}')">${avatarHtml(p, 40)}
        <div class="meta"><div class="name">${esc(p.name)}</div><div class="sub">@${esc(p.handle)} · 교류 ${rel.interactionCount || 0}회</div></div>
        <div class="relation ${relClass}">${esc(window.relationshipLabel(rel.status || p.relationshipStatus))}</div></div>`;
    }).join("");
    el("profile-personas").innerHTML = personaRows || `<div class="settings-help" style="padding:0 20px">아직 함께하는 사람이 없어요.</div>`;

    const posts = S.getPosts();
    el("profile-grid").innerHTML = posts.length
      ? posts.map((p) => `<div class="grid-item ${mediaClass(p.mediaTag)}" onclick="goto('postDetail','${p.id}')">${p.mediaTag && MEDIA_EMOJI[p.mediaTag] ? MEDIA_EMOJI[p.mediaTag] : esc(p.content.slice(0, 18))}</div>`).join("")
      : "";
  };

  // ---- DM 목록 ----
  let dmFilter = "all";
  renderers.dm = function () {
    const threads = S.getDmThreads();
    const pending = S.getPendingCampaigns();
    let html = "";
    // 캠페인 카드
    pending.forEach((camp) => {
      const p = window.getPersona(camp.personaId);
      html += `<div class="campaign-card-dm" onclick="goto('campaign','${camp.id}')">
        <div class="campaign-tag">✦ 브랜드 제안</div>
        <div class="campaign-title">${esc(p ? p.name : "브랜드")}</div>
        <div class="campaign-desc">${esc(camp.description)}</div>
        <button class="campaign-btn">검토하기</button></div>`;
    });
    const filtered = threads.filter((t) => dmFilter === "all" || t.category === dmFilter);
    if (!filtered.length && !pending.length) {
      el("dm-list").innerHTML = `<div class="empty-state"><div class="emoji">💌</div><div class="title">아직 메시지가 없어요</div><div class="desc">게시물을 올리고 활동하면<br>친구들이 먼저 말을 걸어와요.</div></div>`;
      return;
    }
    filtered.forEach((t) => {
      const p = window.getPersona(t.personaId);
      if (!p) return;
      const last = t.messages[t.messages.length - 1];
      html += `<div class="dm-item" onclick="goto('dmChat','${p.id}')">${avatarHtml(p, 46)}
        <div class="dm-meta"><div class="dm-name-row"><span class="dm-name">${esc(p.name)}</span><span class="dm-time">${last ? relativeTime(last.at) : ""}</span></div>
        <div class="dm-preview ${t.unread ? "unread" : ""}">${esc(last ? (last.from === "user" ? "나: " : "") + last.text : "")}</div></div>
        ${t.unread ? `<span class="dm-badge">${t.unread}</span>` : ""}</div>`;
    });
    el("dm-list").innerHTML = html;
  };
  window.App = window.App || {};
  window.App.setDmFilter = function (f, btn) {
    dmFilter = f;
    btn.parentElement.querySelectorAll(".dm-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    renderers.dm();
  };

  // ---- DM 대화 ----
  let chatPersonaId = null;
  renderers.dmChat = function (personaId) {
    if (personaId) chatPersonaId = personaId;
    const p = window.getPersona(chatPersonaId);
    if (!p) { goto("dm"); return; }
    S.ensureDmThread(chatPersonaId);
    S.markDmRead(chatPersonaId);
    const rel = S.getRelationship(chatPersonaId) || {};
    el("dmchat-header").innerHTML = `<div class="icon-btn" onclick="goto('dm')"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></div>
      ${avatarHtml(p, 38)}
      <div class="meta"><div class="name">${esc(p.name)}</div><div class="sub">@${esc(p.handle)} · ${esc(window.relationshipLabel(rel.status || p.relationshipStatus))}</div></div>`;
    renderChatMessages();
  };
  function renderChatMessages() {
    const t = S.getDmThread(chatPersonaId);
    const msgs = t ? t.messages : [];
    const p = window.getPersona(chatPersonaId);
    if (!msgs.length) {
      el("dmchat-messages").innerHTML = `<div class="empty-state" style="margin:auto"><div class="desc">${esc(p.name)}님과의 첫 대화예요.<br>가볍게 인사해보세요.</div></div>`;
      return;
    }
    el("dmchat-messages").innerHTML = msgs.map((m) => {
      const cls = m.from === "user" ? "sent" : "received";
      return `<div class="message ${cls}">${esc(m.text)}</div><div class="message-time ${cls}">${relativeTime(m.at)}</div>`;
    }).join("");
    el("dmchat-messages").scrollTop = el("dmchat-messages").scrollHeight;
  }

  window.App.sendDm = async function () {
    const input = el("dmchat-input");
    const text = input.value.trim();
    if (!text) return;
    S.addDmMessage(chatPersonaId, "user", text);
    S.bumpRelationship(chatPersonaId, 2, { interaction: true });
    input.value = "";
    renderChatMessages();
    // 타이핑 표시
    const tw = document.createElement("div");
    tw.className = "typing-indicator";
    tw.style.padding = "0";
    tw.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
    el("dmchat-messages").appendChild(tw);
    el("dmchat-messages").scrollTop = el("dmchat-messages").scrollHeight;
    try {
      const reply = await E.generateDmReply(chatPersonaId, text);
      S.addDmMessage(chatPersonaId, "persona", reply);
      S.markDmRead(chatPersonaId);
      S.bumpRelationship(chatPersonaId, 1, {});
    } catch (e) {
      tw.remove();
      toast("답장 생성 실패: " + (e.message || "오류"));
      return;
    }
    if (current === "dmChat") renderChatMessages();
    updateBadges();
  };

  // ---- 알림 ----
  renderers.notifications = function () {
    S.markAllNotificationsRead();
    const list = S.getNotifications();
    if (!list.length) {
      el("notif-list").innerHTML = `<div class="empty-state"><div class="emoji">🔔</div><div class="title">알림이 없어요</div><div class="desc">활동을 시작하면 좋아요, 댓글, 메시지 알림이 여기 모여요.</div></div>`;
      updateBadges();
      return;
    }
    const icon = { like: "♥", comment: "💭", follower: "+", dm: "💬", brand: "🎁" };
    el("notif-list").innerHTML = list.map((n) => {
      const p = n.personaId ? window.getPersona(n.personaId) : null;
      let body = n.text;
      if (n.type === "comment" && p) body = `<strong>${esc(p.name)}</strong>님이 댓글을 남겼어요: "${esc(n.text.slice(0, 30))}${n.text.length > 30 ? "…" : ""}"`;
      else if (n.type === "dm" && p) body = `<strong>${esc(p.name)}</strong>님이 메시지를 보냈어요`;
      else body = esc(n.text);
      const click = n.type === "dm" && p ? `onclick="goto('dmChat','${p.id}')"` : "";
      return `<div class="notif" ${click}><div class="notif-icon ${n.type}">${icon[n.type] || "•"}</div>
        <div class="notif-body"><div class="notif-text">${body}</div><div class="notif-time">${relativeTime(n.at)}</div></div>
        ${p ? avatarHtml(p, 36) : ""}</div>`;
    }).join("");
    updateBadges();
  };

  // ---- 탐색 ----
  renderers.explore = function () {
    const trends = S.getTrends();
    el("explore-trends").innerHTML = trends.map((t) => `<div class="trend-tag">#${esc(t.keyword)}<span class="count">${t.score}</span></div>`).join("");
    // 아직 팔로우 안 한 페르소나 추천
    const active = S.getActivePersonaIds();
    const recos = window.PERSONAS.filter((p) => !active.includes(p.id)).slice(0, 6);
    el("explore-recos").innerHTML = recos.length
      ? recos.map((p) => `<div class="recommend-card">${avatarHtml(p, 48)}<div class="name">${esc(p.name)}</div><div class="role">${esc(p.bio.slice(0, 20))}</div><button class="follow-btn" onclick="App.followPersona('${p.id}', this)">팔로우</button></div>`).join("")
      : `<div class="settings-help" style="padding:0 16px">이미 모든 추천 계정과 연결되어 있어요.</div>`;
  };
  window.App.followPersona = function (id, btn) {
    const active = S.getActivePersonaIds();
    if (active.includes(id)) return;
    S.setActivePersonaIds(active.concat(id));
    S.addFollowers(1);
    const p = window.getPersona(id);
    toast(`${p.name}님과 연결되었어요`);
    btn.textContent = "팔로잉";
    btn.disabled = true;
  };

  // ---- 캠페인 상세 ----
  let campaignId = null;
  renderers.campaign = function (id) {
    if (id) campaignId = id;
    const camp = S.getCampaigns().find((c) => c.id === campaignId);
    if (!camp) { goto("dm"); return; }
    const p = window.getPersona(camp.personaId);
    el("campaign-content").innerHTML = `
      <div class="campaign-hero">
        <div class="from-row">${p ? avatarHtml(p, 40) : ""}<div><div style="font-weight:700;color:var(--text-primary)">${esc(p ? p.name : "브랜드")}</div><div style="font-size:11px;color:var(--text-dim)">@${esc(p ? p.handle : "")}</div></div></div>
        <h2>${esc(camp.title)}</h2><p>${esc(camp.description)}</p>
      </div>
      <div class="reward-section"><h4>예상 보상 (분산 적용)</h4>
        <div class="reward-row"><span class="lbl">팔로워 증가</span><span class="val-good">+${camp.reward.followerMin} ~ +${camp.reward.followerMax}</span></div>
        <div class="reward-row"><span class="lbl">관계도</span><span class="val-good">+${camp.reward.relation}</span></div>
        <div class="reward-row"><span class="lbl">가시성 부스트</span><span class="val-good">+${Math.round(camp.reward.visibility * 100)}% (24h)</span></div>
      </div>
      <div class="risk-section"><h4>주의 사항</h4>
        <div class="reward-row"><span class="lbl">비판 댓글 확률</span><span class="val-bad">${Math.round(camp.risk.criticism * 100)}%</span></div>
        <div class="reward-row"><span class="lbl">피로감 확률</span><span class="val-bad">${Math.round(camp.risk.fatigue * 100)}%</span></div>
      </div>
      ${camp.status === "pending"
        ? `<div class="campaign-actions"><button class="btn-reject" onclick="App.rejectCampaign('${camp.id}')">거절</button><button class="btn-accept" onclick="App.acceptCampaign('${camp.id}')">수락하기</button></div>`
        : `<div class="settings-help" style="text-align:center">이미 ${camp.status === "accepted" ? "수락" : "거절"}한 제안이에요.</div>`}`;
  };
  window.App.acceptCampaign = function (id) {
    const camp = S.getCampaigns().find((c) => c.id === id);
    if (!camp) return;
    const gain = Math.round(camp.reward.followerMin + Math.random() * (camp.reward.followerMax - camp.reward.followerMin));
    S.addFollowers(gain);
    S.bumpRelationship(camp.personaId, camp.reward.relation, { interaction: true });
    S.updateCampaign(id, { status: "accepted" });
    toast(`캠페인 참여 완료! 팔로워 +${gain} ✨`);
    goto("dm");
  };
  window.App.rejectCampaign = function (id) {
    S.updateCampaign(id, { status: "rejected" });
    toast("제안을 거절했어요");
    goto("dm");
  };

  // ---- 설정 ----
  renderers.settings = function () {
    const hasKey = S.hasApiKey();
    const provider = S.getProvider();
    const model = S.getModel();
    const spice = S.getSpiceLevel();
    const profanity = S.getAllowProfanity();
    const flirt = S.getFlirtMode();
    const isOpenai = provider === "openai";
    const models = isOpenai
      ? [["gpt-4o-mini", "GPT-4o mini (빠르고 저렴 · 추천)"], ["gpt-4o", "GPT-4o (더 자연스러움)"]]
      : [["claude-haiku-4-5-20251001", "Claude Haiku 4.5 (빠르고 저렴 · 추천)"], ["claude-sonnet-4-6", "Claude Sonnet 4.6 (더 자연스러움)"], ["claude-opus-4-7", "Claude Opus 4.7 (최고 품질 · 느림/비쌈)"]];
    const keyLink = isOpenai ? "https://platform.openai.com/api-keys" : "https://console.anthropic.com/settings/keys";
    const keyHost = isOpenai ? "platform.openai.com" : "console.anthropic.com";
    const placeholder = isOpenai ? "sk-..." : "sk-ant-...";
    const statusMsg = S.hasApiKey()
      ? "✓ 직접 키가 저장돼 있어요"
      : S.hasTeamPassword()
      ? "✓ 팀 비밀번호로 공유 서버를 사용 중이에요"
      : "팀 비밀번호를 입력하면 댓글·DM이 생성돼요";
    el("settings-content").innerHTML = `
      <div class="settings-group">
        <h3>AI 연결</h3>
        <select class="model-select" id="provider-select" style="margin-top:0">
          <option value="anthropic" ${!isOpenai ? "selected" : ""}>Claude (Anthropic)</option>
          <option value="openai" ${isOpenai ? "selected" : ""}>GPT (OpenAI)</option>
        </select>
        <input type="password" class="input-field" id="team-pw-input" placeholder="팀 비밀번호 (공유 서버용)" value="${esc(S.getTeamPassword())}" style="margin-top:8px" />
        <input type="password" class="input-field" id="api-key-input" placeholder="${placeholder} (내 키로 직접 호출 · 선택)" value="${esc(S.getApiKey())}" style="margin-top:8px" />
        <button class="primary-btn" style="margin-top:8px" onclick="App.saveApiKey()">저장 후 테스트</button>
        <div class="key-status ${hasKey || S.hasTeamPassword() ? "ok" : ""}" id="key-status">${statusMsg}</div>
        <select class="model-select" id="model-select">
          ${models.map(([v, l]) => `<option value="${v}" ${model === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <div class="settings-help"><b>팀 비밀번호</b>만 입력하면 운영자가 키를 숨겨둔 공유 서버로 동작해요(동업자용). 본인 키로 직접 쓰려면 아래 칸에 <a href="${keyLink}" target="_blank">${keyHost}</a> 키를 넣으세요. 모두 이 브라우저에만 저장됩니다.</div>
      </div>
      <div class="settings-group">
        <h3>대화 강도</h3>
        <select class="model-select" id="spice-select" style="margin-top:0">
          <option value="mild" ${spice === "mild" ? "selected" : ""}>🍼 순한맛 — 다정하고 부드럽게</option>
          <option value="normal" ${spice === "normal" ? "selected" : ""}>🙂 보통 — 솔직하지만 무난하게</option>
          <option value="spicy" ${spice === "spicy" ? "selected" : ""}>🌶 매운맛 — 팩폭·돌직구·드립</option>
        </select>
        <label class="settings-row" style="cursor:pointer">
          <div><div class="label">🤬 비속어 허용</div><div class="sub">감정 실릴 때 가벼운 욕·은어를 양념처럼</div></div>
          <input type="checkbox" id="profanity-toggle" ${profanity ? "checked" : ""} style="width:20px;height:20px" />
        </label>
        <label class="settings-row" style="cursor:pointer">
          <div><div class="label">💘 썸·설렘 텐션</div><div class="sub">은근한 플러팅·밀당·두근거리는 뉘앙스</div></div>
          <input type="checkbox" id="flirt-toggle" ${flirt ? "checked" : ""} style="width:20px;height:20px" />
        </label>
        <div class="settings-help">매운맛은 빈말 칭찬 없이 직설적으로. 비속어·썸은 켜면 적용돼요. 단 혐오·차별·인신공격·성적 노골 표현은 어느 설정에서도 차단됩니다(API 정책). (실제 AI 연결 시 적용)</div>
      </div>
      <div class="settings-group">
        <h3>데이터</h3>
        <div class="settings-row"><div><div class="label">게시물</div><div class="sub">${S.getPosts().length}개 · 댓글 ${S.state.comments.length}개</div></div></div>
        <button class="danger-btn" onclick="App.resetAll()">모든 데이터 초기화</button>
      </div>`;
    el("provider-select").addEventListener("change", (e) => { S.setProvider(e.target.value); renderers.settings(); });
    el("model-select").addEventListener("change", (e) => { S.setModel(e.target.value); toast("모델 변경됨"); });
    el("spice-select").addEventListener("change", (e) => {
      S.setSpiceLevel(e.target.value);
      toast(e.target.value === "spicy" ? "🌶 매운맛 적용" : e.target.value === "mild" ? "🍼 순한맛 적용" : "🙂 보통 적용");
    });
    el("profanity-toggle").addEventListener("change", (e) => {
      S.setAllowProfanity(e.target.checked);
      toast(e.target.checked ? "🤬 비속어 허용 켬" : "비속어 허용 끔");
    });
    el("flirt-toggle").addEventListener("change", (e) => {
      S.setFlirtMode(e.target.checked);
      toast(e.target.checked ? "💘 썸 텐션 켬" : "썸 텐션 끔");
    });
  };
  window.App.saveApiKey = async function () {
    const key = el("api-key-input").value.trim();
    const pw = el("team-pw-input") ? el("team-pw-input").value.trim() : "";
    S.setApiKey(key);
    S.setTeamPassword(pw);
    const status = el("key-status");
    if (!key && !pw) { status.textContent = "팀 비밀번호나 API 키 중 하나를 입력해주세요"; status.className = "key-status bad"; return; }
    status.innerHTML = `<span class="spinner"></span> 확인 중...`;
    status.className = "key-status";
    const res = await window.ClaudeAPI.testKey();
    if (res.ok) { status.textContent = key ? "✓ 직접 호출 정상! 진짜 반응이 달려요" : "✓ 공유 서버 연결 정상! 진짜 반응이 달려요"; status.className = "key-status ok"; }
    else { status.textContent = "✗ " + (res.error || "확인 실패"); status.className = "key-status bad"; }
  };
  window.App.resetAll = function () {
    if (!confirm("모든 게시물·댓글·관계·설정이 삭제됩니다. 계속할까요?")) return;
    S.reset();
    location.reload();
  };

  // ============ 좋아요 ============
  window.App.likePost = function (postId, btnEl) {
    const post = S.getPost(postId);
    if (!post) return;
    const liked = btnEl.classList.toggle("liked");
    const delta = liked ? 1 : -1;
    S.updatePost(postId, { likeCount: Math.max(0, post.likeCount + delta) });
    const span = btnEl.querySelector("span");
    if (span) span.textContent = S.getPost(postId).likeCount;
    const svg = btnEl.querySelector("svg");
    if (svg) svg.setAttribute("fill", liked ? "currentColor" : "none");
  };

  // ============ 게시물 작성 ============
  let composeMedia = null;
  window.App.toggleComposeMedia = function (tag, btn) {
    if (composeMedia === tag) { composeMedia = null; btn.classList.remove("active"); }
    else {
      composeMedia = tag;
      document.querySelectorAll("#compose-options .compose-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
  };
  renderers.compose = function () {
    el("compose-textarea").value = "";
    composeMedia = null;
    document.querySelectorAll("#compose-options .compose-option").forEach((b) => b.classList.remove("active"));
    el("compose-user").innerHTML = `${userAvatarHtml(38)}<div><div style="font-size:14px;font-weight:700;color:var(--text-primary)">${esc((S.getUser() || {}).nickname || "나")}</div><div style="font-size:11px;color:var(--text-dim)">전체에 공개</div></div>`;
    setTimeout(() => el("compose-textarea").focus(), 100);
  };
  window.App.submitPost = function () {
    const text = el("compose-textarea").value.trim();
    if (!text) { toast("내용을 입력해주세요"); return; }
    const tags = E.inferTags(text);
    const post = S.addPost({ content: text, mediaType: composeMedia ? "image" : "text", mediaTag: composeMedia, tags });
    goto("postDetail", post.id);
    showTyping(true);
    E.reactToPost(post, {
      onLike: () => { if (current === "postDetail" && detailPostId === post.id) renderers.postDetail(); },
      onComment: (c, p) => { showTyping(false); appendCommentLive(c, p); updateBadges(); setTimeout(() => showTyping(true), 300); },
      onReply: () => { refreshDetailAfterReply(); },
      onDm: (p, txt) => { toast(`${p.name}님이 메시지를 보냈어요`); updateBadges(); },
      onError: (e) => { showTyping(false); toast("반응 생성 실패: " + (e.message === "NO_API_KEY" ? "설정에서 API 키를 입력하세요" : e.message)); },
      onDone: () => { showTyping(false); updateBadges(); },
      onNeedKey: () => { showTyping(false); toast("설정에서 Claude API 키를 입력하면 댓글이 생성돼요"); },
    });
  };

  window.App.shareProfile = function () { toast("공유 링크가 복사되었어요 (데모)"); };
  window.App.toast = toast;

  window.App.deletePost = function (id) {
    if (!confirm("이 게시물을 삭제할까요? 달린 댓글도 함께 삭제됩니다.")) return;
    S.deletePost(id);
    toast("게시물을 삭제했어요");
    if (current === "postDetail") goto("feed");
    else renderers.feed();
  };

  // ============ 온보딩 ============
  window.App.finishOnboarding = function () {
    const nickname = el("ob-nickname").value.trim() || "나";
    const bio = el("ob-bio").value.trim();
    const interests = Array.from(document.querySelectorAll("#ob-interests .chip.selected")).map((c) => c.textContent);
    const criticismLevel = parseInt(el("ob-criticism").value, 10) / 100;
    S.setUser({ nickname, bio, interests, criticismLevel });
    const matched = E.matchInitialPersonas(S.getUser());
    S.setActivePersonaIds(matched);
    S.addFollowers(matched.length);
    // 시드 트렌드
    S.setTrends([
      { keyword: "봄코디", score: 128, category: "fashion", tags: ["fashion"] },
      { keyword: "밤글", score: 87, category: "emotional", tags: ["emotional"] },
      { keyword: "오늘의분위기", score: 62, category: "daily", tags: ["daily"] },
      { keyword: "카페투어", score: 45, category: "cafe", tags: ["cafe"] },
      { keyword: "감성글", score: 38, category: "emotional", tags: ["emotional"] },
    ]);
    // 시드 캠페인 (브랜드 페르소나가 활성에 있으면)
    seedCampaignIfPossible();
    toast(`환영해요, ${nickname}님 ✨`);
    goto("feed");
  };

  function seedCampaignIfPossible() {
    const brandP = S.getActivePersonaIds().map(window.getPersona).find((p) => p && ["brand_collab", "local_brand_collab"].includes(p.internalRole));
    if (!brandP) return;
    S.addCampaign({
      personaId: brandP.id,
      title: "봄코디 챌린지 🌸",
      description: "요즘 #봄코디 트렌드 관련해서 잘 어울릴 것 같아 연락드려요. 일상 분위기의 사진 1장 + 짧은 글로 참여해주세요.",
      reward: { followerMin: 30, followerMax: 300, relation: 5, visibility: 0.15 },
      risk: { criticism: 0.1, fatigue: 0.05 },
    });
  }

  // 온보딩 칩/슬라이더
  function bindOnboarding() {
    document.querySelectorAll("#ob-interests .chip").forEach((c) => c.addEventListener("click", () => c.classList.toggle("selected")));
    const slider = el("ob-criticism");
    if (slider) slider.addEventListener("input", (e) => { el("ob-criticism-val").textContent = e.target.value + "%"; });
  }

  // ============ 초기화 ============
  function applyLocalConfig() {
    const cfg = window.LOCAL_CONFIG;
    if (cfg && cfg.apiKey) {
      if (cfg.provider) S.setProvider(cfg.provider);
      if (cfg.model) S.setModel(cfg.model);
      S.setApiKey(cfg.apiKey);
    }
  }
  function init() {
    applyLocalConfig();
    bindOnboarding();
    updateBadges();
    if (S.isOnboarded()) goto("feed");
    else goto("onboarding");
  }
  window.App.init = init;
  document.addEventListener("DOMContentLoaded", init);
})();
