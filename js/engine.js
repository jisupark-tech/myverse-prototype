// MyVerse 반응 엔진
// 게시물 → 페르소나 선택 → Claude API로 댓글 생성 → 타이밍대로 도착 → 관계도/기억/DM 갱신

window.Engine = (function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 온보딩 관심사(한글) → 내부 태그 매핑
  const INTEREST_TAG_MAP = {
    일상: "daily", 카페: "cafe", 음악: "music", 게임: "game",
    사진: "photo", 감성글: "emotional", 패션: "fashion", 독서: "book",
    러닝: "running", 운동: "health", 책: "book", 뷰티: "beauty",
  };

  function userTags(user) {
    if (!user || !user.interests) return [];
    return user.interests.map((i) => INTEREST_TAG_MAP[i] || i.toLowerCase());
  }

  const FREQ_WEIGHT = {
    high: 9, medium_high: 7, medium: 5, low_medium: 3, low: 1,
  };

  // 게시물 작성 시 자동 태그 추론 (간단 키워드)
  const TAG_KEYWORDS = {
    cafe: ["카페", "커피", "라떼", "아메리카노"],
    music: ["노래", "음악", "플레이리스트", "플리", "가사", "앨범"],
    photo: ["사진", "필름", "카메라", "찍었", "보정"],
    fashion: ["코디", "룩", "옷", "패션", "스타일"],
    food: ["먹", "맛집", "야식", "점심", "저녁", "디저트"],
    running: ["러닝", "달리", "조깅", "운동", "산책"],
    emotional: ["피곤", "우울", "행복", "슬프", "외로", "설레", "힘들", "기분", "감정", "지치"],
    daily: ["오늘", "하루", "요즘", "그냥"],
  };

  function inferTags(text) {
    const tags = [];
    for (const [tag, kws] of Object.entries(TAG_KEYWORDS)) {
      if (kws.some((k) => text.includes(k))) tags.push(tag);
    }
    return tags.length ? tags : ["daily"];
  }

  // ── 온보딩: 사용자 페르소나 기반 초기 활성 페르소나 선택 ──
  function matchInitialPersonas(user) {
    const tags = userTags(user);
    const scored = window.PERSONAS.map((p) => {
      let s = 0;
      const overlap = p.interestTags.filter((t) => tags.includes(t)).length;
      s += overlap * 12;
      // 친구 계열은 초기에 잘 등장
      if (["warm_friend", "playful_friend", "music_empath", "trend_friend"].includes(p.internalRole)) s += 9;
      if (p.internalRole === "growth_fan") s += 6;
      if (["calm_critic", "photo_feedback", "routine_motivator"].includes(p.internalRole)) s += 4;
      // 브랜드/크리에이터는 활동 누적 후 등장 (초기 감점)
      if (["brand_collab", "local_brand_collab"].includes(p.internalRole)) s -= 20;
      s += Math.random() * 6;
      return { p, s };
    }).sort((a, b) => b.s - a.s);

    // 상위 6명을 초기 활성으로
    return scored.slice(0, 6).map((x) => x.p.id);
  }

  // 활동 누적 시 새 페르소나(브랜드 등) 유입
  function maybeOnboardNewPersona() {
    const active = window.Store.getActivePersonaIds();
    const user = window.Store.getUser();
    if (!user) return null;
    // 게시물 3개 이상 + 아직 미등장 페르소나 중 매칭되는 것
    if (user.postCount < 3) return null;
    const inactive = window.PERSONAS.filter((p) => !active.includes(p.id));
    if (!inactive.length) return null;
    const tags = userTags(user);
    const candidate = inactive
      .map((p) => ({ p, s: p.interestTags.filter((t) => tags.includes(t)).length + Math.random() }))
      .sort((a, b) => b.s - a.s)[0];
    if (candidate && Math.random() < 0.5) {
      window.Store.setActivePersonaIds(active.concat(candidate.p.id));
      window.Store.addFollowers(1);
      window.Store.addNotification({
        type: "follower",
        personaId: candidate.p.id,
        text: `${candidate.p.name}님이 회원님을 팔로우하기 시작했어요`,
      });
      return candidate.p;
    }
    return null;
  }

  // ── 게시물 분석 (휴리스틱, LLM 없이) ──
  function analyzePost(post) {
    const text = post.content || "";
    const len = text.length;
    const specificity = Math.min(1, len / 120);
    const emotionWords = ["피곤", "행복", "슬프", "우울", "좋", "힘들", "외로", "설레", "기쁘", "짜증", "신나", "심심", "지치", "벅차", "그립"];
    const emotion = Math.min(1, emotionWords.filter((w) => text.includes(w)).length * 0.4);
    const mediaPresent = post.mediaType && post.mediaType !== "text";
    const isQuestion = text.includes("?") || /까\??$/.test(text.trim());
    return { specificity, emotion, mediaPresent, isQuestion, len };
  }

  // ── 댓글 수 결정 (기획서 9.2 공식 기반 + 분산) ──
  function estimateCommentCount(post, analysis) {
    const followers = (window.Store.getUser() || {}).followerCount || 0;
    const base = Math.log(followers + 1) * 0.5 + 1;
    let n =
      base +
      analysis.specificity * 1.5 +
      analysis.emotion * 1.5 +
      (analysis.mediaPresent ? 1 : 0) +
      (analysis.isQuestion ? 1 : 0);
    n += Math.random() * 1.6 - 0.5; // 분산
    n = Math.round(n);
    const activeCount = window.Store.getActivePersonaIds().length;
    return Math.max(1, Math.min(n, activeCount));
  }

  // ── 반응할 페르소나 선택 ──
  function selectReactors(post, analysis, count) {
    const ids = window.Store.getActivePersonaIds();
    const scored = ids
      .map((id) => {
        const p = window.getPersona(id);
        if (!p) return null;
        const rel = window.Store.getRelationship(id);
        let s = (rel ? rel.score : 10) * 0.25;
        const overlap = p.interestTags.filter((t) => (post.tags || []).includes(t)).length;
        s += overlap * 9;
        s += FREQ_WEIGHT[p.behavior.commentFreq] || 3;
        if (analysis.emotion > 0.3 && p.behavior.support > 0.8) s += 7;
        if (analysis.mediaPresent && p.internalRole === "photo_feedback") s += 9;
        if (analysis.isQuestion) s += 3;
        // 브랜드는 댓글 잘 안 달지만 관련 태그면 가끔
        if (["brand_collab", "local_brand_collab"].includes(p.internalRole)) s -= 6;
        s += Math.random() * 7;
        return { p, s };
      })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, count).map((x) => x.p);
  }

  const FORBIDDEN = [
    "~하는 건 어떨까요", "정말 멋진 것 같아요", "공감이 가네요", "앞으로도 기대할게요",
    "충분히 잘하고 있어요", "힘내세요", "응원할게요", "해보시는 건 어떠세요",
    "좋은 시간 되세요", "감사히 잘 읽었어요",
  ];

  // ── 댓글 생성 프롬프트 + Claude 호출 ──
  async function generateComments(post, reactors) {
    const personaBlocks = reactors
      .map((p, i) => {
        const rel = window.Store.getRelationship(p.id) || {};
        return `${i + 1}. ${p.name} (id: ${p.id})
- 성격: ${p.personalityKeywords.join(", ")}
- 말투: ${p.commentStyle.tone} / 길이감: ${p.commentStyle.length}
- 말투 예시: ${p.commentStyle.samples.join(" / ")}
- 관심사: ${p.interestTags.join(", ")}
- 비판성향(0~1): ${p.behavior.criticism}
- 사용자와의 관계: ${window.relationshipLabel(rel.status || p.relationshipStatus)}
- 이 사용자에 대한 기억: ${rel.memorySummary || "(아직 특별한 기억 없음)"}`;
      })
      .join("\n\n");

    const system = `너는 가상 SNS의 댓글 생성 엔진이다. 각 인물이 사용자 게시물에 다는 댓글을 그 사람의 성격과 말투 그대로 작성한다.

규칙:
- 실제 SNS 댓글처럼 짧고 자연스럽게. 완성된 문장이 아니어도 된다.
- 절대 AI 같은 말투를 쓰지 않는다. 아래 표현은 금지: ${FORBIDDEN.map((f) => `"${f}"`).join(", ")}
- 무조건 칭찬하지 않는다. 비판성향이 높은 인물은 솔직한 피드백을 1개 섞되 공격적이지 않게.
- 각 인물의 말투 예시와 최대한 비슷한 톤/길이로 쓴다. 반말 인물은 반말, 존댓말 인물은 존댓말.
- 기억이 있으면 자연스럽게 한 번 언급해도 좋다(억지로 X).
- 일부 인물끼리 서로 가볍게 반응(대댓글)할 수 있다. 특히 비판적 댓글에 친한 친구가 가볍게 받아치는 식. 자연스러울 때만 0~1개.

반드시 아래 JSON 배열로만 응답한다(다른 설명 금지):
[{"id":"<인물id>","text":"<댓글>","type":"supportive|empathetic|casual|analytical|critical|fan_reaction|brand_interest|meme","reply_from":"<선택: 다른 인물id>","reply_text":"<선택: 대댓글>"}]`;

    const user = `[게시물]
${post.content}
${post.mediaType && post.mediaType !== "text" ? "(사진 첨부됨)" : ""}
태그: ${(post.tags || []).join(", ") || "없음"}

[댓글 작성자들]
${personaBlocks}

위 인물들이 각자 1개씩 댓글을 단다. JSON 배열로만 응답.`;

    const json = await window.ClaudeAPI.completeJson({ system, user, maxTokens: 1600, temperature: 1.0 });
    if (!Array.isArray(json)) return [];
    return json.filter((c) => window.getPersona(c.id) && c.text);
  }

  // ── 오프라인(데모) 댓글: 키 없을 때 말투 샘플로 생성 ──
  function offlineReactionType(p) {
    if (p.behavior.criticism >= 0.4) return "critical";
    if (p.internalRole === "growth_fan") return "fan_reaction";
    if (["brand_collab", "local_brand_collab"].includes(p.internalRole)) return "brand_interest";
    if (p.behavior.support >= 0.85) return "supportive";
    if (p.internalRole === "playful_friend") return "casual";
    return "empathetic";
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function generateCommentsOffline(post, reactors) {
    return reactors.map((p) => {
      const c = { id: p.id, text: pick(p.commentStyle.samples), type: offlineReactionType(p) };
      // 비판적 댓글엔 친구가 가볍게 받아치는 대댓글
      if (p.behavior.criticism >= 0.35 && Math.random() < 0.55) {
        const friend = reactors.find((r) => r.id !== p.id && r.behavior.criticism < 0.2);
        if (friend) {
          c.reply_from = friend.id;
          c.reply_text = pick(friend.commentStyle.samples);
        }
      }
      return c;
    });
  }

  // ── 게시물에 대한 전체 반응 처리 (타이밍 포함) ──
  async function reactToPost(post, cb = {}) {
    const analysis = analyzePost(post);

    // 즉시: 무음 좋아요
    const initialLikes = 2 + Math.floor(Math.random() * 5);
    window.Store.updatePost(post.id, {
      likeCount: post.likeCount + initialLikes,
      reach: post.reach + 80 + Math.floor(Math.random() * 200),
    });
    cb.onLike && cb.onLike();

    let comments = [];
    try {
      const count = estimateCommentCount(post, analysis);
      const reactors = selectReactors(post, analysis, count);
      comments = window.Store.hasApiKey()
        ? await generateComments(post, reactors)
        : generateCommentsOffline(post, reactors);
    } catch (e) {
      cb.onError && cb.onError(e);
      return;
    }

    // 타이밍대로 하나씩 도착
    let delay = 1500 + Math.random() * 1500;
    for (const c of comments) {
      await sleep(delay);
      const saved = window.Store.addComment({
        postId: post.id,
        personaId: c.id,
        text: c.text,
        reactionType: c.type || "casual",
        likeCount: Math.floor(Math.random() * 6),
      });
      window.Store.bumpRelationship(c.id, 1.5, { interaction: true });
      window.Store.updatePost(post.id, { likeCount: window.Store.getPost(post.id).likeCount + 1 });
      const persona = window.getPersona(c.id);
      window.Store.addNotification({ type: "comment", personaId: c.id, text: c.text });
      cb.onComment && cb.onComment(saved, persona);

      // 대댓글 (AI 간 상호작용)
      if (c.reply_from && c.reply_text && window.getPersona(c.reply_from)) {
        await sleep(1200 + Math.random() * 1500);
        const reply = window.Store.addComment({
          postId: post.id,
          personaId: c.reply_from,
          parentId: saved.id,
          text: c.reply_text,
          reactionType: "casual",
          likeCount: Math.floor(Math.random() * 4),
        });
        window.Store.bumpRelationship(c.reply_from, 0.5, { interaction: true });
        cb.onReply && cb.onReply(reply, saved, window.getPersona(c.reply_from));
      }
      delay = 2200 + Math.random() * 2800;
    }

    // 게시물 engagement 최종 집계
    const finalPost = window.Store.getPost(post.id);
    window.Store.updatePost(post.id, {
      engagementScore: finalPost.likeCount + window.Store.countComments(post.id) * 3,
    });

    // 기억 갱신
    updateMemoriesAfterPost(post, comments.map((c) => c.id));

    // 새 페르소나 유입 체크
    maybeOnboardNewPersona();

    // 관계 좋은 친구가 게시물 보고 선제 DM (확률적, 백그라운드)
    maybeProactiveDmAfterPost(post, cb.onDm);

    cb.onDone && cb.onDone();
  }

  // ── DM: 사용자 메시지에 대한 페르소나 응답 ──
  async function generateDmReply(personaId, userText) {
    const p = window.getPersona(personaId);
    if (!window.Store.hasApiKey()) {
      await sleep(900 + Math.random() * 900);
      return pick(p.dmStyle.samples);
    }
    const rel = window.Store.getRelationship(personaId) || {};
    const thread = window.Store.getDmThread(personaId);
    const history = (thread ? thread.messages : [])
      .slice(-8)
      .map((m) => `${m.from === "user" ? "사용자" : p.name}: ${m.text}`)
      .join("\n");

    const system = `너는 '${p.name}'이라는 SNS 사용자다(@${p.handle}). 아래 성격과 말투 그대로 DM에 답한다.
- 성격: ${p.personalityKeywords.join(", ")}
- DM 말투: ${p.dmStyle.tone} / 길이감: ${p.dmStyle.length}
- 말투 예시: ${p.dmStyle.samples.join(" / ")}
- 사용자와의 관계: ${window.relationshipLabel(rel.status || p.relationshipStatus)}
- 기억: ${rel.memorySummary || "(아직 특별한 기억 없음)"}
규칙: 실제 사람처럼 자연스럽게. AI 같은 말투 금지. 금지표현: ${FORBIDDEN.slice(0, 6).join(", ")}. 1~2문장으로 짧게. 답장 텍스트만 출력(이름표/따옴표 없이).`;
    const user = `[대화 기록]\n${history || "(첫 대화)"}\n\n위 대화에서 사용자의 마지막 메시지에 ${p.name}로서 답장:`;
    return await window.ClaudeAPI.complete({ system, user, maxTokens: 300, temperature: 1.0 });
  }

  // ── DM: 페르소나가 먼저 보내는 선제 DM ──
  async function generateProactiveDm(personaId) {
    const p = window.getPersona(personaId);
    if (!window.Store.hasApiKey()) return pick(p.dmStyle.samples);
    const rel = window.Store.getRelationship(personaId) || {};
    const recentPost = window.Store.getPosts()[0];
    const system = `너는 '${p.name}'(@${p.handle}). 아래 말투로 사용자에게 먼저 보내는 DM 한 통을 쓴다.
- DM 말투: ${p.dmStyle.tone} / 예시: ${p.dmStyle.samples.join(" / ")}
- 관계: ${window.relationshipLabel(rel.status || p.relationshipStatus)}
- 기억: ${rel.memorySummary || "(없음)"}
규칙: AI 티 금지. 1~2문장. 답장 텍스트만 출력.`;
    const user = recentPost
      ? `사용자가 최근 올린 글: "${recentPost.content}". 여기에 자연스럽게 이어지는 안부나 짧은 감상 DM을 써줘.`
      : "오랜만에 가볍게 안부를 묻는 DM을 써줘.";
    return await window.ClaudeAPI.complete({ system, user, maxTokens: 300, temperature: 1.0 });
  }

  async function maybeProactiveDmAfterPost(post, onDm) {
    const ids = window.Store.getActivePersonaIds();
    const cands = ids
      .map((id) => ({ id, rel: window.Store.getRelationship(id), p: window.getPersona(id) }))
      .filter(
        (x) => x.rel && x.rel.score > 35 && x.p && ["high", "medium_high"].includes(x.p.behavior.dmFreq)
      );
    if (!cands.length || Math.random() > 0.45) return;
    const pick = cands[Math.floor(Math.random() * cands.length)];
    await sleep(3500 + Math.random() * 3500);
    try {
      const text = await generateProactiveDm(pick.id);
      window.Store.addDmMessage(pick.id, "persona", text);
      window.Store.bumpRelationship(pick.id, 1, {});
      window.Store.addNotification({ type: "dm", personaId: pick.id, text });
      onDm && onDm(pick.p, text);
    } catch (e) {
      /* silent */
    }
  }

  // ── 기억 갱신 (휴리스틱; 추후 LLM 요약으로 교체) ──
  function updateMemoriesAfterPost(post, personaIds) {
    const recent = window.Store.getPosts().slice(0, 5);
    const summary =
      "최근 올린 글: " +
      recent
        .map((p) => `"${p.content.length > 18 ? p.content.slice(0, 18) + "…" : p.content}"`)
        .join(", ");
    new Set(personaIds).forEach((id) => window.Store.setMemorySummary(id, summary));
  }

  return {
    matchInitialPersonas,
    maybeOnboardNewPersona,
    analyzePost,
    inferTags,
    estimateCommentCount,
    selectReactors,
    generateComments,
    reactToPost,
    generateDmReply,
    generateProactiveDm,
    userTags,
  };
})();
