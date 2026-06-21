// api/grade.js
// Claude API를 서버에서 호출한다. API 키는 여기(서버 환경변수)에만 있고,
// 브라우저로는 절대 전달되지 않는다.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 API 키가 설정되어 있지 않습니다.' });
  }

  const { mode, koreanPrompt, modelEnglish, englishSource, userAnswer } = req.body || {};

  if (!userAnswer || !mode) {
    return res.status(400).json({ error: '필수 입력값이 누락되었습니다.' });
  }

  let systemPrompt;
  let userContent;

  if (mode === 'write') {
    if (!koreanPrompt || !modelEnglish) {
      return res.status(400).json({ error: 'write 모드에는 koreanPrompt와 modelEnglish가 필요합니다.' });
    }
    systemPrompt = `당신은 한국인 영어 학습자를 위한 엄격하지만 친절한 영작 첨삭 선생님입니다.
사용자는 한국어 해석 문장을 보고 그에 맞는 영어 문장을 작문합니다.
사용자가 입력한 영어 문장을 "모범 영어 원문"과 비교하여 문법, 자연스러움, 의미 전달을 기준으로 채점하세요.
모범 원문과 완전히 똑같지 않아도 문법적으로 맞고 자연스러우며 같은 의미라면 높은 점수를 주세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트, 설명, 마크다운 코드블록 표시 없이 순수 JSON만 출력하세요.

{
  "score": 0부터 10 사이의 정수,
  "verdict_kr": "한 줄 총평 (한국어, 20자 내외)",
  "corrected_sentence": "자연스럽고 올바른 영어 문장 (사용자 문장을 최대한 살려서 수정한 버전)",
  "issues": [
    { "type": "grammar 또는 word 또는 style", "wrong": "틀린 부분", "right": "올바른 표현", "explain_kr": "설명 (1~2문장)" }
  ],
  "wrong_words": [
    { "wrong_form": "틀리게 쓴 단어", "correct_word": "올바른 단어", "meaning_kr": "한국어 뜻", "example_sentence": "예문" }
  ]
}
issues, wrong_words는 해당 사항 없으면 빈 배열로 두세요. wrong_words는 단어 선택 오류에만, 시제/관사 등 문법 오류는 issues에만 넣으세요.`;
    userContent = `[한국어 해석 (제시문)]\n${koreanPrompt}\n\n[모범 영어 원문]\n${modelEnglish}\n\n[사용자가 작문한 영어 문장]\n${userAnswer}\n\n위 기준에 따라 JSON으로만 채점 결과를 출력하세요.`;
  } else if (mode === 'interpret') {
    if (!englishSource) {
      return res.status(400).json({ error: 'interpret 모드에는 englishSource가 필요합니다.' });
    }
    systemPrompt = `당신은 한국인 영어 학습자를 위한 엄격하지만 친절한 해석 첨삭 선생님입니다.
사용자는 영어 원문 문장을 보고 한국어로 해석합니다.
사용자가 입력한 한국어 해석을 영어 원문과 비교하여 정확성과 자연스러움을 기준으로 채점하세요.
직역이 아니더라도 의미가 정확하고 한국어 문장으로 자연스럽다면 높은 점수를 주세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트, 설명, 마크다운 코드블록 표시 없이 순수 JSON만 출력하세요.

{
  "score": 0부터 10 사이의 정수,
  "verdict_kr": "한 줄 총평 (한국어, 20자 내외)",
  "corrected_sentence": "자연스럽고 정확한 한국어 해석",
  "issues": [
    { "type": "grammar 또는 word 또는 style", "wrong": "잘못 해석한 부분(한국어)", "right": "올바른 해석(한국어)", "explain_kr": "설명 (1~2문장)" }
  ],
  "wrong_words": [
    { "wrong_form": "잘못 이해한 영어 단어", "correct_word": "올바른 형태", "meaning_kr": "정확한 한국어 뜻", "example_sentence": "예문(영어, 원문과 다른 새 예문)" }
  ]
}
issues, wrong_words는 해당 사항 없으면 빈 배열로 두세요. wrong_words는 단어 뜻을 잘못 알았을 때만 채우세요.`;
    userContent = `[영어 원문]\n${englishSource}\n\n[사용자가 작성한 한국어 해석]\n${userAnswer}\n\n위 기준에 따라 JSON으로만 채점 결과를 출력하세요.`;
  } else {
    return res.status(400).json({ error: 'mode는 write 또는 interpret 이어야 합니다.' });
  }

  try {
    const response = await callClaudeWithRetry({
      apiKey,
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[grade] Claude API 응답 오류', response.status, errText);
      return res.status(502).json({ error: 'Claude API 오류', detail: errText });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      console.error('[grade] 응답에 텍스트 블록 없음', JSON.stringify(data));
      return res.status(502).json({ error: '응답에 텍스트가 없습니다.' });
    }

    let clean = textBlock.text.trim();
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        console.error('[grade] JSON 파싱 실패. 원문:', clean);
        return res.status(502).json({ error: '채점 결과를 해석할 수 없습니다.' });
      }
    }

    parsed.score = Math.max(0, Math.min(10, Math.round(Number(parsed.score) || 0)));
    parsed.verdict_kr = parsed.verdict_kr || '';
    parsed.corrected_sentence = parsed.corrected_sentence || userAnswer;
    parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    parsed.wrong_words = Array.isArray(parsed.wrong_words) ? parsed.wrong_words : [];

    return res.status(200).json(parsed);
  } catch (e) {
    console.error('[grade] 예외 발생:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: '서버 오류', detail: String(e && e.message ? e.message : e) });
  }
}

// Claude API 호출. 5xx/429(일시적 오류)나 네트워크 자체 실패일 때만 최대 2회까지 재시도한다.
// 4xx(요청 자체가 잘못된 경우)는 재시도해도 의미가 없으므로 바로 반환한다.
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
      console.error(`[grade] Claude API ${response.status} — 재시도 ${attempt + 1}/${maxRetries}`);
    } catch (e) {
      lastError = e;
      console.error(`[grade] fetch 실패 — 재시도 ${attempt + 1}/${maxRetries}`, e && e.message);
      if (attempt === maxRetries) throw e;
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (lastError) throw lastError;
}
