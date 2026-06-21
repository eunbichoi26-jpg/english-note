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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: `여러 영어 문장을 자연스러운 한국어로 번역하는 번역기입니다.
입력은 번호가 매겨진 영어 문장 목록입니다. 각 문장을 같은 번호의 한국어 번역으로 출력하세요.

반드시 아래 형식만 출력하세요. 다른 설명, 인사말, 마크다운 없이:
1. (1번 문장의 한국어 번역)
2. (2번 문장의 한국어 번역)
...

입력된 문장 개수와 출력 줄 수가 반드시 같아야 합니다. 번호를 빠뜨리거나 합치지 마세요.`,
        messages: [{ role: 'user', content: numbered }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Claude API 오류', detail: errText });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
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
    return res.status(500).json({ error: '서버 오류', detail: String(e) });
  }
}
