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

  try {
    let text = "";
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return res.status(500).json({ error: "서버에 Anthropic 키가 설정되지 않았어요" });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: model || "claude-haiku-4-5-20251001",
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
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(500).json({ error: "서버에 OpenAI 키가 설정되지 않았어요" });
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
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
