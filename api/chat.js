// Vercel 서버리스 프록시: 키를 서버 환경변수에 숨기고, 팀 비밀번호 + 레이트리밋으로 남용 방지.
// 환경변수: OPENAI_API_KEY, ANTHROPIC_API_KEY, TEAM_PASSWORD, (선택) RATE_LIMIT_PER_MIN

const ipHits = new Map(); // best-effort 인메모리 레이트리밋 (서버리스 인스턴스 단위)

function rateLimited(ip) {
  const limit = parseInt(process.env.RATE_LIMIT_PER_MIN || "20", 10);
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  ipHits.set(ip, arr);
  if (ipHits.size > 5000) ipHits.clear(); // 메모리 누수 방지
  return arr.length > limit;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { password, provider, system, user, model, maxTokens, temperature } = body || {};

  // 1) 팀 비밀번호 검증
  if (!process.env.TEAM_PASSWORD || password !== process.env.TEAM_PASSWORD) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않아요" });
  }

  // 2) 레이트리밋
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." });
  }

  // 3) 토큰 상한
  const cappedTokens = Math.min(maxTokens || 1024, 2000);

  // 4) 프로바이더 자동 선택: 요청한 프로바이더의 키가 없으면, 서버에 설정된
  //    다른 프로바이더로 폴백한다(클라이언트 기본값과 서버 키 불일치 방지).
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenai = !!process.env.OPENAI_API_KEY;
  let effective = provider === "openai" ? "openai" : "anthropic";
  if (effective === "anthropic" && !hasAnthropic && hasOpenai) effective = "openai";
  if (effective === "openai" && !hasOpenai && hasAnthropic) effective = "anthropic";
  if ((effective === "anthropic" && !hasAnthropic) || (effective === "openai" && !hasOpenai)) {
    return res.status(500).json({ error: "서버에 AI 키가 설정되지 않았어요(관리자 확인 필요)" });
  }
  // 폴백으로 프로바이더가 바뀌면 클라이언트가 보낸 모델ID는 무효하므로 그쪽 기본 모델 사용
  const useModel = effective === provider ? model : null;

  try {
    let text = "";
    if (effective === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: useModel || "claude-haiku-4-5-20251001",
          max_tokens: cappedTokens,
          temperature: temperature == null ? 1.0 : temperature,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (d.error && d.error.message) || "API 오류" });
      text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + process.env.OPENAI_API_KEY },
        body: JSON.stringify({
          model: useModel || "gpt-4o-mini",
          max_tokens: cappedTokens,
          temperature: temperature == null ? 1.0 : temperature,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (d.error && d.error.message) || "API 오류" });
      text = (((d.choices || [])[0] || {}).message || {}).content || "";
    }
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || "서버 오류" });
  }
}
