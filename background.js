// 요약 요청을 처리하는 메인 함수
async function fetchSummary(textToSummarize) {
  // 저장된 AI 설정값 가져오기 (기본값은 'local')
  const { selectedAI = 'local' } = await chrome.storage.local.get('selectedAI');

  try {
    let summaryResult = "";

    switch (selectedAI) {
      case 'local':
        summaryResult = await callLocalLM(textToSummarize);
        break;
      case 'openai':
        summaryResult = await callOpenAI(textToSummarize);
        break;
      case 'gemini':
        summaryResult = await callGemini(textToSummarize);
        break;
      default:
        throw new Error("알 수 없는 AI 모델입니다.");
    }

    return summaryResult;

  } catch (error) {
    console.error("AI 요청 실패:", error);
    return "요청 중 오류가 발생했습니다.";
  }
}

// 개별 AI 호출 함수 예시
async function callLocalLM(text) {
  // 노트북 로컬 서버 (예: Ollama, LM Studio 등) 호출
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3", // 로컬 모델명
      prompt: `다음 텍스트를 요약해줘: ${text}`,
      stream: false
    })
  });
  const data = await response.json();
  return data.response;
}

async function callOpenAI(text) {
  // 외부 API 호출 시에는 API Key 관리가 필요합니다.
  // ... OpenAI fetch 로직 ...
  return "OpenAI 요약 결과";
}

async function callGemini(text) {
  // ... Gemini fetch 로직 ...
  return "Gemini 요약 결과";
}