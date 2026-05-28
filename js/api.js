// Claude API 클라이언트 (브라우저 직접 호출)
// 1단계: 사용자가 자신의 API 키를 입력 → 브라우저에서 직접 Anthropic API 호출.
//   - anthropic-dangerous-direct-browser-access 헤더로 CORS 우회.
//   - 주의: API 키가 브라우저에 노출됨. 외부 공유 시 받는 사람도 본인 키를 입력하는 구조.
// 2단계: Vercel 서버리스 함수로 키를 백엔드에 숨기고 프록시 호출로 전환 예정.

window.ClaudeAPI = (function () {
  const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
  const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

  async function errorFrom(res) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err.error ? err.error.message : JSON.stringify(err);
    } catch (e) {
      detail = res.statusText;
    }
    const error = new Error(detail || "API_ERROR");
    error.status = res.status;
    return error;
  }

  async function anthropicComplete({ system, user, maxTokens, temperature, model, apiKey }) {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  async function openaiComplete({ system, user, maxTokens, temperature, model, apiKey }) {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    return ((data.choices || [])[0] || {}).message?.content || "";
  }

  async function complete({ system, user, maxTokens = 1024, temperature = 1.0, model }) {
    const apiKey = window.Store.getApiKey();
    if (!apiKey) throw new Error("NO_API_KEY");
    const provider = window.Store.getProvider();
    const args = { system, user, maxTokens, temperature, model: model || window.Store.getModel(), apiKey };
    return provider === "openai" ? openaiComplete(args) : anthropicComplete(args);
  }

  // 모델이 코드블록(```json ... ```)으로 감싸 반환하는 경우까지 처리하는 JSON 파서
  function parseJson(text) {
    if (!text) return null;
    let t = text.trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) t = fenced[1].trim();
    // 첫 [ 또는 { 부터 마지막 ] 또는 } 까지 추출
    const firstArr = t.indexOf("[");
    const firstObj = t.indexOf("{");
    let start = -1;
    if (firstArr === -1) start = firstObj;
    else if (firstObj === -1) start = firstArr;
    else start = Math.min(firstArr, firstObj);
    if (start > 0) t = t.slice(start);
    const lastArr = t.lastIndexOf("]");
    const lastObj = t.lastIndexOf("}");
    const end = Math.max(lastArr, lastObj);
    if (end > 0 && end < t.length - 1) t = t.slice(0, end + 1);
    try {
      return JSON.parse(t);
    } catch (e) {
      console.warn("parseJson failed", e, text);
      return null;
    }
  }

  async function completeJson(opts) {
    const text = await complete(opts);
    return parseJson(text);
  }

  // API 키 유효성 빠른 확인
  async function testKey() {
    try {
      await complete({ system: "Reply with the single word: ok", user: "ping", maxTokens: 16 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  }

  return { complete, completeJson, parseJson, testKey };
})();
