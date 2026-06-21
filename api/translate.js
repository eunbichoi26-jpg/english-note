// api/translate.js
// 영작 탭에서 영어 지문을 미리 한국어로 번역해두기 위한 배치 번역 API.
// 여러 문장을 한 번에 묶어서 보내 호출 횟수를 줄인다.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 API 키가 설정되어 있지 않습니다.' });
  }

  const { sentences } = req.body || {};
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return res.status(400).json({ error: 'sentences 배열이 필요합니다.' });
  }
  if (sentences.length > 20) {
    return res.status(400).json({ error: '한 번에 최대 20문장까지 번역할 수 있습니다.' });
  }

  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');

  try {
    const response = await callClaudeWithRetry({
      apiKey,
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: `여러 영어 문장을 자연스러운 한국어로 번역하는 번역기입니다.
입력은 번호가 매겨진 영어 문장 목록입니다. 각 문장을 같은 번호의 한국어 번역으로 출력하세요.

중요: 사람 이름(인명)은 번역하거나 한글로 음역하지 말고, 원문의 영문 철자 그대로 남겨두세요.
예: "Lacey Duvall" → 그대로 "Lacey Duvall" (✕ "레이시 듀발"로 음역하지 않음)
지명, 회사명 등 다른 고유명사는 자연스러운 한국어 표기(외래어 표기법)를 따르되, 사람 이름만 예외로 원문 그대로 둡니다.

반드시 아래 형식만 출력하세요. 다른 설명, 인사말, 마크다운 없이:
1. (1번 문장의 한국어 번역)
2. (2번 문장의 한국어 번역)
...

입력된 문장 개수와 출력 줄 수가 반드시 같아야 합니다. 번호를 빠뜨리거나 합치지 마세요.`,
        messages: [{ role: 'user', content: numbered }],
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[translate] Claude API 응답 오류', response.status, errText);
      return res.status(502).json({ error: 'Claude API 오류', detail: errText });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      console.error('[translate] 응답에 텍스트 블록 없음', JSON.stringify(data));
      return res.status(502).json({ error: '번역 응답이 없습니다.' });
    }

    const lines = textBlock.text.trim().split('\n').filter((l) => l.trim());
    const results = new Array(sentences.length).fill(null);
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\.\s*(.*)$/);
      if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && idx < sentences.length) {
          results[idx] = m[2].trim();
        }
      }
    }

    return res.status(200).json({ translations: results });
  } catch (e) {
    console.error('[translate] 예외 발생:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: '서버 오류', detail: String(e && e.message ? e.message : e) });
  }
}

// Claude API 호출. 5xx/429(일시적 오류)나 네트워크 자체 실패일 때만 최대 2회까지 재시도한다.
async function callClaudeWithRetry({ apiKey, body }, maxRetries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const isRetryable = response.status === 429 || response.status >= 500;
      if (response.ok || !isRetryable || attempt === maxRetries) {
        return response;
      }
      console.error(`[translate] Claude API ${response.status} — 재시도 ${attempt + 1}/${maxRetries}`);
    } catch (e) {
      lastError = e;
      console.error(`[translate] fetch 실패 — 재시도 ${attempt + 1}/${maxRetries}`, e && e.message);
      if (attempt === maxRetries) throw e;
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (lastError) throw lastError;
}
