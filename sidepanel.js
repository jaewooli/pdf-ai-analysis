document.getElementById('analyzeBtn').addEventListener('click', () => {
  const summaryArea = document.getElementById('summaryArea');
  summaryArea.innerHTML = '<div class="card">문서를 분석 중입니다...</div>';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const currentTabId = tabs[0].id;

    chrome.tabs.sendMessage(currentTabId, { action: 'GET_DOCUMENT_DATA' }, (response) => {
      if (!response || !response.data) return;
      const docData = response.data; 

      // AI 서버 통신 시뮬레이션
      setTimeout(() => {
        const aiResponse = [
          {
            summary: "첫 번째 부분의 핵심 요약입니다.",
            // AI가 뱉어낸 실제 문장 (테스트용으로 뷰어 데이터의 특정 문장을 가져옴)
            sourceText: docData[0].text.substring(0, 50) 
          },
          {
            summary: "두 번째 부분의 핵심 요약입니다.",
            sourceText: docData[1].text.substring(0, 50)
          }
        ];

        renderSummary(aiResponse, currentTabId);
      }, 1000);
    });
  });
});

function renderSummary(aiData, tabId) {
  const summaryArea = document.getElementById('summaryArea');
  summaryArea.innerHTML = '<div class="card" style="background:#eef7ff;">✅ AI 분석이 완료되었습니다. 요약을 클릭해보세요!</div>'; 

  aiData.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'sentence card';
    div.style.cursor = 'pointer';
    div.style.marginBottom = '8px';
    div.innerHTML = `<strong>💡 요약 ${index + 1}:</strong> ${item.summary}`;

    div.addEventListener('click', () => {
      // 사이드 패널은 좌표 계산 없이 "원문 텍스트"만 뷰어에 쏴줍니다.
      chrome.tabs.sendMessage(tabId, {
        action: 'HIGHLIGHT_EXACT_TEXT',
        text: item.sourceText
      });
    });

    summaryArea.appendChild(div);
  });
}