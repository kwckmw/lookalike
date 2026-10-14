// 파일 위치: api/analyze.js

function getSystemPrompt(category) {
  let scopeInstruction = '';

  if (category === 'celeb') {
    scopeInstruction = '검색 대상 범위: 대한민국 대중문화 연예인(배우, 가수, 아이돌, 희극인, 방송인 등) 중에서만 선정하세요.';
  } else if (category === 'sports') {
    scopeInstruction = '검색 대상 범위: 대한민국 축구, 야구, 골프, 배구, e스포츠, 올림픽 등 유명 실존 한국 스포츠 스타 및 운동선수 중에서만 선정하세요.';
  } else if (category === 'master') {
    scopeInstruction = '검색 대상 범위: 대한민국 프로 바둑 기사(이창호, 이세돌, 신진서, 조훈현, 최정 등) 및 문화, 방송, 요리, 예술, 학술 등 각 전문 분야의 실존 유명 셀럽 및 명사 중에서 선정하세요.';
  } else {
    scopeInstruction = '검색 대상 범위: 대한민국 대중에게 널리 알려진 실존 한국인 유명인 전체(연예인, 스포츠 스타, 프로 바둑 기사, 문화 예술 명사 등)를 모두 후보군으로 두고 가장 얼굴 인상이 닮은 인물을 자유롭게 선정하세요.';
  }

  return [
    '당신은 한국 유명인 닮은꼴 분석 AI입니다.',
    scopeInstruction,
    '사진에 사람 얼굴이 명확하게 보이지 않거나, 너무 멀리 있거나, 얼굴보다 다른 사물(음식, 배경 등)이 주된 피사체인 경우 반드시 face_detected를 false로 설정하고 matches를 빈 배열로 하세요.',
    '사람 얼굴이 명확한 경우에만 face_detected를 true로 하고, 얼굴 인상이 가장 닮은 실존 인물 3명을 추천하세요.',
    '중요 규칙:',
    '1. 모든 이름(name), 구체적인 직업(profession - 예: 배우, 축구선수, 프로바둑기사(9단)), 닮은이유(reasons)는 100% 한글(한국어)로만 작성해야 합니다.',
    '2. 러시아어, 영어, 한자 등 외국어나 가상 캐릭터는 절대 사용하지 마세요.',
    '3. 반드시 현재 대한민국 대중에게 널리 알려진 실존 한국인이어야 합니다.',
    '4. wiki_title에는 한국어 위키백과(ko.wikipedia.org) 표제어와 정확히 일치할 인물명을 적으세요.',
    '5. 부가 텍스트 없이 지정된 JSON 스키마 형식 하나로만 출력하세요.'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '허용되지 않는 요청 방식입니다 (POST만 가능).' });
  }

  // Vercel 환경변수 GEMINI_KEY 로드
  const apiKey = (process.env.GEMINI_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({
      error: '서버에 GEMINI_KEY 환경변수가 설정되지 않았습니다.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { base64Data, mimeType, category } = body;

    if (!base64Data || typeof base64Data !== 'string') {
      return res.status(400).json({ error: '이미지 데이터가 누락되었습니다.' });
    }

    const safeMimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
      ? mimeType
      : 'image/jpeg';

    let modelQueue = [];
    try {
      const listRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey),
        { headers: { 'x-goog-api-key': apiKey } }
      );

      if (listRes.ok) {
        const listJson = await listRes.json();
        if (listJson.models && listJson.models.length > 0) {
          const valid = listJson.models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));

          const lites = valid.filter(n => n.includes('flash-lite') || n.includes('8b'));
          const flashes = valid.filter(n => n.includes('flash') && !n.includes('flash-lite') && !n.includes('8b'));
          const others = valid.filter(n => !n.includes('flash'));

          modelQueue = [].concat(lites, flashes, others);
        }
      }
    } catch (e) {
      console.warn('동적 모델 탐색 실패, 기본 모델 큐를 사용합니다.', e);
    }

    if (modelQueue.length === 0) {
      modelQueue = [
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash-8b',
        'gemini-2.0-flash',
        'gemini-1.5-flash'
      ];
    }

    const dynamicPrompt = getSystemPrompt(category || 'all');
    const payload = {
      contents: [{
        parts: [
          { text: dynamicPrompt },
          {
            inlineData: {
              mimeType: safeMimeType,
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            face_detected: { type: 'BOOLEAN' },
            matches: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  profession: { type: 'STRING' },
                  similarity: { type: 'INTEGER' },
                  reasons: { type: 'ARRAY', items: { type: 'STRING' } },
                  wiki_title: { type: 'STRING' }
                },
                required: ['name', 'profession', 'similarity', 'reasons', 'wiki_title']
              }
            }
          },
          required: ['face_detected', 'matches']
        }
      }
    };

    let lastError = null;
    for (let i = 0; i < modelQueue.length; i++) {
      const model = modelQueue[i];
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

      try {
        const geminiRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload)
        });

        if (geminiRes.ok) {
          const resData = await geminiRes.json();
          const rawText = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            return res.status(200).json(parsed);
          }
        }

        lastError = new Error('Model ' + model + ' HTTP ' + geminiRes.status);
      } catch (err) {
        lastError = err;
      }
    }

    return res.status(502).json({
      error: 'AI 모델 응답에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (lastError ? lastError.message : 'Unknown') + ')'
    });
  } catch (error) {
    console.error('Serverless API Error:', error);
    return res.status(500).json({
      error: '서버 내부 처리 중 오류가 발생했습니다.'
    });
  }
};