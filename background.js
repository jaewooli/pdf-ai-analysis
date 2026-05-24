// ==========================================
// 1. PDF 자동 가로채기 로직 (누락되었던 핵심 부분)
// ==========================================
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  // 메인 프레임(전체 창)에서 발생하는 이동만 감지
  if (details.frameId !== 0) return;

  try {
    const urlObj = new URL(details.url);
    
    // 경로명이 .pdf로 끝나는지 확인
    if (urlObj.pathname.toLowerCase().endsWith('.pdf')) {
      // 이미 우리 확장 프로그램의 뷰어로 열려 있는 상태라면 무시 (무한 루프 방지)
      if (!details.url.includes(chrome.runtime.id)) {
        // 우리 뷰어 주소로 조립하여 강제 리다이렉트
        const customViewerUrl = chrome.runtime.getURL(`viewer.html?file=${encodeURIComponent(details.url)}`);
        chrome.tabs.update(details.tabId, { url: customViewerUrl });
      }
    }
  } catch (error) {
    console.error("URL 파싱 에러:", error);
  }
});

// ==========================================
// 2. 메시지 수신 및 AI 요약 로직
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_SIDE_PANEL') {
    if (sender.tab) { // 요청을 보낸 탭(뷰어)에 사이드 패널을 오픈
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
    return true;
  }
  if (request.action === 'FETCH_SUMMARY') {
    fetchSummary(request.text, request.pdfBase64)
      .then(result => sendResponse({ result }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // 비동기 응답 처리를 위해 true 반환
  }
});

async function fetchSummary(textToSummarize, pdfBase64) {
  const { selectedAI = 'local' } = await chrome.storage.local.get('selectedAI');

  let systemPrompt = "";
  try {
    const response = await fetch(chrome.runtime.getURL("instruction.txt"));
    systemPrompt = await response.text();
  } catch (error) {
    console.error("instruction.txt 파일을 읽어오는데 실패했습니다:", error);
    throw new Error("기본 지침(instruction.txt) 파일을 로드할 수 없습니다.");
  }

  try {
    switch (selectedAI) {
      case 'local':
        return await callLocalLM(textToSummarize, systemPrompt);
      case 'openai':
        return await callOpenAI(textToSummarize, systemPrompt);
      case 'gemini':
        return await callGemini(textToSummarize, pdfBase64, systemPrompt);
      default:
        throw new Error("알 수 없는 AI 모델입니다.");
    }
  } catch (error) {
    console.error("AI 요청 실패:", error);
    throw error;
  }
}

async function callLocalLM(text, systemPrompt) {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3", 
      prompt: `${systemPrompt}\n\n[분석할 논문 텍스트]\n${text}`,
      stream: false
    })
  });
  const data = await response.json();
  return data.response;
}

async function callOpenAI(text, systemPrompt) {
  const { openaiApiKey } = await chrome.storage.local.get('openaiApiKey');
  if (!openaiApiKey) throw new Error("OpenAI API 키가 설정되지 않았습니다.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `다음 텍스트를 분석해줘:\n${text}` }
      ]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(text, pdfBase64, systemPrompt) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const payload = {
    system_instruction: { 
      parts: [{ text: systemPrompt }] 
    },
    contents: [{ parts: [] }]
  };

  if (pdfBase64) {
    payload.contents[0].parts.push({ text: "첨부된 PDF 논문 파일을 제공된 지침 규칙(출력 규칙 및 양식)에 맞춰 완벽하게 분석해줘." });
    payload.contents[0].parts.push({
      inline_data: {
        mime_type: "application/pdf",
        data: pdfBase64
      }
    });
  } else {
    payload.contents[0].parts.push({ text: `다음 텍스트를 분석해줘:\n${text}` });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Gemini 통신 에러");
  
  if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts.length > 0) {
    return data.candidates[0].content.parts[0].text;
  } else {
    throw new Error("Gemini API 응답 형식이 예상과 다릅니다.");
  }
}