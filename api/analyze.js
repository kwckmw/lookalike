// api/analyze.js
export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GEMINI_KEY 환경 변수 불러오기
  const apiKey = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다. Vercel 환경 변수를 확인해주세요.' });
  }

  const { base64Data, mimeType, dynamicPrompt } = req.body || {};
  if (!base64Data || !mimeType) {
    return res.status(400).json({ error: '이미지 데이터가 전달되지 않았습니다.' });
  }

  const modelQueue = [
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  const payload = {
    contents: [{
      parts: [
        { text: dynamicPrompt },
        { inlineData: { mimeType: mimeType, data: base64Data } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          face_detected: { type: "BOOLEAN" },
          matches: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                profession: { type: "STRING" },
                similarity: { type: "INTEGER" },
                reasons: { type: "ARRAY", items: { type: "STRING" } },
                wiki_title: { type: "STRING" }
              },
              required: ["name", "profession", "similarity", "reasons", "wiki_title"]
            }
          }
        },
        required: ["face_detected", "matches"]
      }
    }
  };

  let lastError = null;
  for (const model of modelQueue) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const resData = await response.json();
        const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        return res.status(200).json(JSON.parse(rawText));
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  return res.status(500).json({ error: lastError?.message || 'Gemini 분석 통신 실패' });
}