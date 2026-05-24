document.addEventListener('DOMContentLoaded', () => {
  const toggleConfigBtn = document.getElementById('toggleConfigBtn');
  const configContent = document.getElementById('configContent');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  
  const aiSelector = document.getElementById('ai-selector');
  const openaiKeyInput = document.getElementById('openai-key');
  const geminiKeyInput = document.getElementById('gemini-key');
  const statusSpan = document.getElementById('status');

  chrome.storage.local.get(['selectedAI', 'openaiApiKey', 'geminiApiKey'], (result) => {
    if (result.selectedAI) aiSelector.value = result.selectedAI;
    if (result.openaiApiKey) openaiKeyInput.value = result.openaiApiKey;
    if (result.geminiApiKey) geminiKeyInput.value = result.geminiApiKey;
  });

  toggleConfigBtn.addEventListener('click', () => {
    configContent.classList.toggle('active');
  });

  saveConfigBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      selectedAI: aiSelector.value,
      openaiApiKey: openaiKeyInput.value.trim(),
      geminiApiKey: geminiKeyInput.value.trim()
    }, () => {
      statusSpan.textContent = '저장됨!';
      setTimeout(() => { statusSpan.textContent = ''; }, 2000);
    });
  });
});

document.getElementById('analyzeBtn').addEventListener('click', () => {
  const summaryArea = document.getElementById('summaryArea');
  let elapsedSeconds = 0;
  
  summaryArea.innerHTML = `
    <div class="card" style="text-align: center; line-height: 1.5;">
      문서를 분석 중입니다...<br><br>
      <strong style="color: #007bff; font-size: 16px;">⏱️ <span id="timerSpan">0</span>초</strong>
    </div>`;

  const timerInterval = setInterval(() => {
    elapsedSeconds++;
    const timerSpan = document.getElementById('timerSpan');
    if (timerSpan) timerSpan.textContent = elapsedSeconds;
  }, 1000);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const currentTabId = tabs[0].id;

    chrome.tabs.sendMessage(currentTabId, { action: 'GET_DOCUMENT_DATA' }, (textResponse) => {
      let fullText = textResponse && textResponse.data ? textResponse.data.map(item => item.text).join(' ') : "";

      chrome.tabs.sendMessage(currentTabId, { action: 'GET_PDF_FILE' }, (fileResponse) => {
        const pdfBase64 = fileResponse && fileResponse.base64 ? fileResponse.base64 : null;

        chrome.runtime.sendMessage({ action: 'FETCH_SUMMARY', text: fullText, pdfBase64: pdfBase64 }, (aiResponse) => {
          clearInterval(timerInterval);

          if (!aiResponse || aiResponse.error) {
            summaryArea.innerHTML = `<div class="card" style="color:red;">에러: ${aiResponse ? aiResponse.error : "통신 실패"}</div>`;
            return;
          }

          let rawResult = aiResponse.result;

          // 🔥 1. "원문 근거" 텍스트를 숨기고 [🔍 원문 하이라이트] 버튼으로 완벽 치환
          // (정규식을 아주 유연하게 짜서 마크다운 기호가 붙어있어도 텍스트만 정확히 날려버립니다)
          let processedResult = rawResult.replace(
            /(?:-\s*)?\*\*원문 근거\*\*\s*:\s*"?([^"\n]+)"?/g,
            (match, quoteText) => {
              const safeQuote = quoteText.replace(/"/g, '&quot;');
              // 실제 긴 문장은 유저에게 안 보이고 이 버튼 하나만 남습니다.
              return `<span class="clickable-quote" data-quote="${safeQuote}">🔍 원문 하이라이트</span>`;
            }
          );

          // 🔥 2. 깔끔한 마크다운 파서 적용 (제목, 볼드체, 리스트, 줄바꿈 렌더링)
          processedResult = processedResult
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
            .replace(/^\s*-\s+(.*$)/gim, '<div class="list-item">• $1</div>')
            .replace(/\n/gim, '<br>');

          // 3. 화면에 출력
          summaryArea.innerHTML = `
            <div class="card" style="background:#eef7ff; margin-bottom: 10px;">
              ✅ 분석 완료 (소요 시간: <strong>${elapsedSeconds}초</strong>)
            </div>
            <div class="card markdown-body">${processedResult}</div>
          `;
        });
      });
    });
  });
});

// 🔥 클릭 이벤트: 돋보기 버튼을 누르면 원문 텍스트를 뷰어로 전송
document.getElementById('summaryArea').addEventListener('click', (e) => {
  if (e.target.classList.contains('clickable-quote')) {
    const quoteText = e.target.getAttribute('data-quote');
    
    if (quoteText) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'HIGHLIGHT_EXACT_TEXT', 
          text: quoteText 
        });
      });
    }
  }
});