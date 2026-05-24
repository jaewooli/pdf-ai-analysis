// sidepanel.js 전체 코드 (파싱 데이터 전체 표시 버전)

document.getElementById('analyzeBtn').addEventListener('click', () => {
  const summaryArea = document.getElementById('summaryArea');
  summaryArea.innerHTML = '<div class="card">문서 데이터를 뷰어에서 가져오는 중...</div>';

  // 1. 현재 활성화된 크롬 탭(뷰어) 찾기
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const currentTabId = tabs[0].id;

    // 2. 뷰어에 데이터 요청
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_DOCUMENT_DATA' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.data) {
        summaryArea.innerHTML = '<div class="card" style="color:#dc3545;">데이터를 가져오지 못했습니다. PDF 뷰어가 완전히 로드되었는지 확인하세요.</div>';
        return;
      }

      const docData = response.data;
      summaryArea.innerHTML = `<div class="card" style="font-weight:bold; color:#007bff;">
        ✅ 파싱 성공! 총 ${docData.length}개의 문단 블록을 찾았습니다.<br>
        아래 텍스트를 클릭하면 원문 위치로 이동하며 하이라이트됩니다.
      </div>`;

      // 3. 추출된 전체 데이터를 사이드 패널에 표시할 배열로 변환
      const parsedResults = [];
      
      // 제한 없이 모든 docData를 순회합니다.
      for (let i = 0; i < docData.length; i++) {
        parsedResults.push({
          // 화면에 보여줄 텍스트 (페이지 번호와 함께 파싱된 실제 텍스트 전체를 보여줌)
          text: `[페이지 ${docData[i].pageNumber}] ${docData[i].text}`,
          source: {
            pageNumber: docData[i].pageNumber,
            coords: docData[i].coords // 실제 좌표 매핑
          }
        });
      }

      // 4. 화면에 렌더링
      renderSummary(parsedResults, currentTabId);
    });
  });
});

// 화면에 결과를 그리고 클릭 이벤트를 달아주는 함수
function renderSummary(summaryData, tabId) {
  const summaryArea = document.getElementById('summaryArea');

  summaryData.forEach(item => {
    const div = document.createElement('div');
    div.className = 'sentence card';
    
    // 텍스트가 너무 길면 보기 불편할 수 있으니 CSS로 약간의 스타일을 줍니다.
    div.textContent = item.text;
    div.style.cursor = 'pointer';
    div.style.marginBottom = '8px';
    div.style.fontSize = '12px'; // 원문 확인용이므로 글씨를 약간 작게
    div.style.lineHeight = '1.4';

    // 요약본 클릭 시 원문 하이라이트 명령 발송
    div.addEventListener('click', () => {
      chrome.tabs.sendMessage(tabId, {
        action: 'HIGHLIGHT_ORIGINAL',
        data: item.source 
      });
    });

    summaryArea.appendChild(div);
  });
}