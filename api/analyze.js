// 파일 위치: api/analyze.js

function getSystemPrompt(category) {
  var scopeInstruction = '';

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

export default async function handler(req, res) {
  function sendJson(status, obj) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(obj));
  }

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(405, { error: 'POST 요청만 허용됩니다.' });
    }

    var rawKey = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || '';
    var apiKey = String(rawKey).replace(/['"\s]/g, '').trim();

    if (!apiKey) {
      return sendJson(500, {
        error: 'Vercel 환경변수(GEMINI_KEY)가 비어 있습니다.'
      });
    }

    var body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return sendJson(400, { error: '요청 JSON 파싱 실패: ' + e.message });
      }
    } else if (!body || typeof body !== 'object') {
      body = {};
    }

    var base64Data = body.base64Data || '';
    var mimeType = body.mimeType || 'image/jpeg';
    var category = body.category || 'all';

    if (!base64Data) {
      return sendJson(400, { error: '이미지 데이터가 전달되지 않았습니다.' });
    }

    var cleanBase64 = base64Data.indexOf(',') !== -1 ? base64Data.split(',')[1] : base64Data;
    var safeMimeType = ['image/jpeg', 'image/png', 'image/webp'].indexOf(mimeType) !== -1
      ? mimeType
      : 'image/jpeg';

    // 1. 기존 HTML 코드와 동일한 실시간 모델 자동 탐색 (Auto-Discovery)
    var modelQueue = [];
    try {
      var listRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey),
        { headers: { 'x-goog-api-key': apiKey } }
      );

      if (listRes.ok) {
        var listJson = await listRes.json();
        if (listJson.models && listJson.models.length > 0) {
          var valid = listJson.models.filter(function (m) {
            return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
          }).map(function (m) {
            return m.name.replace(/^models\//, '');
          }).filter(function (n) {
            // 이미지+JSON 응답이 불가능한 특수 모델(tts, imagen, thinking 등) 제외
            return n.indexOf('tts') === -1 && n.indexOf('imagen') === -1 && n.indexOf('embedding') === -1 && n.indexOf('aqa') === -1;
          });

          var lites = valid.filter(function (n) { return n.indexOf('flash-lite') !== -1; });
          var flashes = valid.filter(function (n) { return n.indexOf('flash') !== -1 && n.indexOf('flash-lite') === -1; });
          var others = valid.filter(function (n) { return n.indexOf('flash') === -1; });

          modelQueue = [].concat(lites, flashes, others);
        }
      }
    } catch (e) {
      // 탐색 실패 시 아래 기본 큐 사용
    }

    // 만약 목록 조회가 안 되었을 때 사용할 최신 모델 기본 큐 (구형 1.5 제거)
    if (modelQueue.length === 0) {
      modelQueue = [
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash'
      ];
    }

    // 2. 프롬프트 및 페이로드 구성
    var dynamicPrompt = getSystemPrompt(category);
    var payload = {
      contents: [{
        parts: [
          { text: dynamicPrompt },
          {
            inlineData: {
              mimeType: safeMimeType,
              data: cleanBase64
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

    // 3. 탐색된 최신 모델 순차 호출
    var errors = [];
    for (var i = 0; i < modelQueue.length; i++) {
      var model = modelQueue[i];
      var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

      try {
        var geminiRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload)
        });

        var resText = await geminiRes.text();

        if (geminiRes.ok) {
          var resData = JSON.parse(resText);
          var rawText = resData &&
            resData.candidates &&
            resData.candidates[0] &&
            resData.candidates[0].content &&
            resData.candidates[0].content.parts &&
            resData.candidates[0].content.parts[0] &&
            resData.candidates[0].content.parts[0].text;

          if (rawText) {
            var parsed = JSON.parse(rawText);
            return sendJson(200, parsed);
          }
        } else {
          var errObj = {};
          try { errObj = JSON.parse(resText); } catch (e) {}
          var detail = (errObj.error && errObj.error.message) ? errObj.error.message : ('HTTP ' + geminiRes.status);
          errors.push('[' + model + '] ' + detail);

          // API 키 오류나 권한 오류면 즉시 반환
          if (detail.indexOf('API key not valid') !== -1 || detail.indexOf('API_KEY_INVALID') !== -1 || geminiRes.status === 403) {
            return sendJson(400, {
              error: 'API 키 오류 또는 권한 제한: ' + detail
            });
          }
        }
      } catch (innerErr) {
        errors.push('[' + model + '] ' + (innerErr.message || String(innerErr)));
      }
    }

    return sendJson(502, {
      error: 'Gemini 호출 실패: ' + (errors[0] || '응답 없음')
    });
  } catch (fatalErr) {
    return sendJson(500, {
      error: '서버 실행 오류: ' + (fatalErr && fatalErr.message ? fatalErr.message : String(fatalErr))
    });
  }
}