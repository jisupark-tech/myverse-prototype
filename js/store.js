// MyVerse 로컬 데이터 스토어 (localStorage 기반)
// 1단계: 단일 사용자, 브라우저 로컬 저장. 2단계에서 백엔드(Supabase)로 마이그레이션 예정.

window.Store = (function () {
  const KEY = "myverse_state_v1";

  const defaultState = () => ({
    user: null, // { nickname, bio, interests:[], desiredImage, criticismLevel, followerCount, postCount, createdAt }
    settings: { provider: "anthropic", apiKey: "", model: "claude-haiku-4-5-20251001" },
    activePersonaIds: [], // 이 유저의 버스에 등장한 페르소나
    posts: [], // { id, content, mediaType, mediaTag, tags:[], createdAt, likeCount, reach, engagementScore }
    comments: [], // { id, postId, personaId, parentId, text, reactionType, likeCount, createdAt }
    relationships: {}, // personaId -> { score, status, interactionCount, lastInteractionAt, memorySummary, lastSeenPostAt }
    dmThreads: [], // { id, personaId, category, messages:[{from:'user'|'persona', text, at}], unread, updatedAt }
    notifications: [], // { id, type, personaId, text, at, read }
    campaigns: [], // { id, personaId, title, description, reward, risk, status, createdAt }
    trends: [], // { keyword, score, category, tags:[] }
    meta: { lastActivityAt: null },
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.warn("Store load failed, resetting", e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Store save failed", e);
    }
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return {
    get state() {
      return state;
    },
    save,
    uid,

    reset() {
      state = defaultState();
      save();
    },

    isOnboarded() {
      return !!state.user;
    },

    // ---- settings ----
    getProvider() {
      return state.settings.provider || "anthropic";
    },
    setProvider(p) {
      state.settings.provider = p;
      const m = state.settings.model || "";
      if (p === "openai" && m.indexOf("gpt") === -1) state.settings.model = "gpt-4o-mini";
      if (p === "anthropic" && m.indexOf("claude") === -1) state.settings.model = "claude-haiku-4-5-20251001";
      save();
    },
    getApiKey() {
      return state.settings.apiKey || "";
    },
    setApiKey(k) {
      state.settings.apiKey = (k || "").trim();
      save();
    },
    getModel() {
      return state.settings.model;
    },
    setModel(m) {
      state.settings.model = m;
      save();
    },
    hasApiKey() {
      return !!(state.settings.apiKey && state.settings.apiKey.length > 10);
    },

    // ---- user ----
    getUser() {
      return state.user;
    },
    setUser(u) {
      state.user = Object.assign(
        { followerCount: 0, postCount: 0, createdAt: new Date().toISOString() },
        state.user || {},
        u
      );
      save();
    },
    addFollowers(n) {
      if (!state.user) return;
      state.user.followerCount = Math.max(0, (state.user.followerCount || 0) + n);
      save();
    },

    // ---- active personas ----
    getActivePersonaIds() {
      return state.activePersonaIds;
    },
    setActivePersonaIds(ids) {
      state.activePersonaIds = ids;
      // 관계도 초기화
      ids.forEach((id) => {
        if (!state.relationships[id]) {
          const p = window.getPersona(id);
          state.relationships[id] = {
            score: relationshipStartScore(p ? p.relationshipStatus : "stranger"),
            status: p ? p.relationshipStatus : "stranger",
            interactionCount: 0,
            lastInteractionAt: null,
            memorySummary: "",
            lastSeenPostAt: null,
          };
        }
      });
      save();
    },

    // ---- posts ----
    getPosts() {
      return state.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    getPost(id) {
      return state.posts.find((p) => p.id === id) || null;
    },
    addPost(post) {
      const p = Object.assign(
        {
          id: uid("post"),
          createdAt: new Date().toISOString(),
          likeCount: 0,
          reach: 0,
          engagementScore: 0,
          tags: [],
          mediaType: "text",
          mediaTag: null,
        },
        post
      );
      state.posts.push(p);
      if (state.user) state.user.postCount = (state.user.postCount || 0) + 1;
      state.meta.lastActivityAt = p.createdAt;
      save();
      return p;
    },
    updatePost(id, patch) {
      const p = state.posts.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
      save();
      return p;
    },

    // ---- comments ----
    getComments(postId) {
      return state.comments
        .filter((c) => c.postId === postId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    },
    getTopLevelComments(postId) {
      return this.getComments(postId).filter((c) => !c.parentId);
    },
    getReplies(commentId) {
      return state.comments
        .filter((c) => c.parentId === commentId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    },
    addComment(comment) {
      const c = Object.assign(
        {
          id: uid("cmt"),
          createdAt: new Date().toISOString(),
          likeCount: 0,
          parentId: null,
          reactionType: "casual",
        },
        comment
      );
      state.comments.push(c);
      save();
      return c;
    },
    countComments(postId) {
      return state.comments.filter((c) => c.postId === postId).length;
    },

    // ---- relationships ----
    getRelationship(personaId) {
      return state.relationships[personaId] || null;
    },
    bumpRelationship(personaId, deltaScore, opts = {}) {
      const r = state.relationships[personaId];
      if (!r) return;
      r.score = Math.min(100, Math.max(0, r.score + (deltaScore || 0)));
      r.interactionCount += opts.interaction ? 1 : 0;
      r.lastInteractionAt = new Date().toISOString();
      r.status = statusForScore(r.score, r.status);
      save();
    },
    setMemorySummary(personaId, summary) {
      const r = state.relationships[personaId];
      if (r) {
        r.memorySummary = summary;
        save();
      }
    },

    // ---- DM ----
    getDmThreads() {
      return state.dmThreads.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    },
    getDmThread(personaId) {
      return state.dmThreads.find((t) => t.personaId === personaId) || null;
    },
    ensureDmThread(personaId) {
      let t = this.getDmThread(personaId);
      if (!t) {
        const p = window.getPersona(personaId);
        t = {
          id: uid("dm"),
          personaId,
          category: dmCategory(p),
          messages: [],
          unread: 0,
          updatedAt: new Date().toISOString(),
        };
        state.dmThreads.push(t);
        save();
      }
      return t;
    },
    addDmMessage(personaId, from, text) {
      const t = this.ensureDmThread(personaId);
      t.messages.push({ from, text, at: new Date().toISOString() });
      t.updatedAt = new Date().toISOString();
      if (from === "persona") t.unread += 1;
      save();
      return t;
    },
    markDmRead(personaId) {
      const t = this.getDmThread(personaId);
      if (t) {
        t.unread = 0;
        save();
      }
    },
    totalUnreadDm() {
      return state.dmThreads.reduce((s, t) => s + (t.unread || 0), 0);
    },

    // ---- notifications ----
    getNotifications() {
      return state.notifications.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    },
    addNotification(n) {
      state.notifications.push(
        Object.assign({ id: uid("ntf"), at: new Date().toISOString(), read: false }, n)
      );
      // 최대 100개 유지
      if (state.notifications.length > 100) state.notifications = state.notifications.slice(-100);
      save();
    },
    unreadNotifications() {
      return state.notifications.filter((n) => !n.read).length;
    },
    markAllNotificationsRead() {
      state.notifications.forEach((n) => (n.read = true));
      save();
    },

    // ---- campaigns ----
    getCampaigns() {
      return state.campaigns.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    getPendingCampaigns() {
      return this.getCampaigns().filter((c) => c.status === "pending");
    },
    addCampaign(c) {
      const camp = Object.assign(
        { id: uid("camp"), status: "pending", createdAt: new Date().toISOString() },
        c
      );
      state.campaigns.push(camp);
      save();
      return camp;
    },
    updateCampaign(id, patch) {
      const c = state.campaigns.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      save();
      return c;
    },

    // ---- trends ----
    getTrends() {
      return state.trends;
    },
    setTrends(t) {
      state.trends = t;
      save();
    },
  };

  // ---- helpers ----
  function relationshipStartScore(status) {
    const map = {
      stranger: 5,
      brand_interest: 8,
      creator_network: 10,
      interest_match: 15,
      recommended_friend: 20,
      follower: 25,
      active_fan: 45,
      friend: 35,
      close_friend: 65,
      collaborator: 75,
      critic: 30,
    };
    return map[status] != null ? map[status] : 10;
  }

  function statusForScore(score, current) {
    // 브랜드/크리에이터 계열은 친구 단계로 전환하지 않는다.
    const brandStatuses = ["brand_interest", "creator_network"];
    if (brandStatuses.includes(current)) return current;
    if (score >= 70) return "close_friend";
    if (score >= 45) return "active_fan";
    if (score >= 25) return "friend";
    if (score >= 15) return "follower";
    return "stranger";
  }

  function dmCategory(p) {
    if (!p) return "friend";
    if (["brand_collab", "local_brand_collab"].includes(p.internalRole)) return "brand";
    if (p.internalRole === "growth_fan") return "fan";
    return "friend";
  }

  window.relationshipLabel = function (status) {
    const map = {
      stranger: "알 수도 있는 사람",
      follower: "팔로워",
      active_fan: "단골 팬",
      friend: "친구",
      close_friend: "친한 친구",
      collaborator: "함께 작업하는 사이",
      critic: "솔직한 피드백을 주는 사이",
      recommended_friend: "추천 친구",
      interest_match: "관심사가 비슷한 사람",
      creator_network: "크리에이터",
      brand_interest: "브랜드·제안",
    };
    return map[status] || status;
  };

  return window.Store;
})();
