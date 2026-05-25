document.addEventListener('DOMContentLoaded', () => {
  const toggleConfigBtn = document.getElementById('toggleConfigBtn');
  const configContent = document.getElementById('configContent');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  
  const aiSelector = document.getElementById('ai-selector');
  const openaiKeyInput = document.getElementById('openai-key');
  const deepseekKeyInput = document.getElementById('deepseek-key');
  const geminiKeyInput = document.getElementById('gemini-key');
  const devModeCheckbox = document.getElementById('dev-mode');
  const statusSpan = document.getElementById('status');

  const analysisList = document.getElementById('analysisList');

  chrome.storage.local.get(['selectedAI', 'openaiApiKey', 'deepseekApiKey', 'geminiApiKey', 'devMode'], (result) => {
    if (result.selectedAI) aiSelector.value = result.selectedAI;
    if (result.openaiApiKey) openaiKeyInput.value = result.openaiApiKey;
    if (result.deepseekApiKey) deepseekKeyInput.value = result.deepseekApiKey;
    if (result.geminiApiKey) geminiKeyInput.value = result.geminiApiKey;
    if (result.devMode !== undefined) devModeCheckbox.checked = result.devMode;
  });

  // 🔥 [Multi-Document] Load all analyses on start
  loadAllAnalyses();

  aiSelector.addEventListener('change', (e) => {
    chrome.storage.local.set({ selectedAI: e.target.value });
  });

  toggleConfigBtn.addEventListener('click', () => {
    configContent.classList.toggle('active');
  });

  saveConfigBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      selectedAI: aiSelector.value,
      openaiApiKey: openaiKeyInput.value.trim(),
      deepseekApiKey: deepseekKeyInput.value.trim(),
      geminiApiKey: geminiKeyInput.value.trim(),
      devMode: devModeCheckbox.checked
    }, () => {
      statusSpan.textContent = '저장됨!';
      setTimeout(() => { statusSpan.textContent = ''; }, 2000);
    });
  });
});

/**
 * Loads all saved analyses and renders them as collapsed cards,
 * except for the one matching the current tab.
 */
function loadAllAnalyses() {
  chrome.storage.local.get(null, (allData) => {
    const analysisKeys = Object.keys(allData).filter(key => key.startsWith('analysis_'));
    const analysisList = document.getElementById('analysisList');
    
    // Clear list to avoid duplicates
    analysisList.innerHTML = '';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs && tabs.length > 0 ? tabs[0].url : null;

      // Sort by timestamp (newest first)
      const sortedKeys = analysisKeys.sort((a, b) => (allData[b].timestamp || 0) - (allData[a].timestamp || 0));

      sortedKeys.forEach(key => {
        const url = key.replace('analysis_', '');
        const data = allData[key];
        // Ensure data is valid
        if (data) {
           const isCurrent = url === currentUrl;
           renderAnalysisCard(url, data, isCurrent);
        }
      });
    });
  });
}

function renderAnalysisCard(url, data, isExpanded = false) {
  const analysisList = document.getElementById('analysisList');
  const cardId = `card_${btoa(url).substring(0, 16).replace(/[/+=]/g, '')}`;
  
  let existingCard = document.getElementById(cardId);
  if (!existingCard) {
    existingCard = document.createElement('div');
    existingCard.id = cardId;
    existingCard.className = 'card';
    existingCard.style.padding = '0';
    existingCard.style.overflow = 'hidden';
    existingCard.style.border = '1px solid #ddd';
    existingCard.style.marginBottom = '10px';
    // 🔥 New cards always go to the top
    analysisList.prepend(existingCard);
  } else if (isExpanded) {
    // 🔥 If updating an existing card and expanding it, move it to top
    analysisList.prepend(existingCard);
  }

  const contentHtml = data.finalResult || data.firstResult || "분석 대기 중...";
  const isFinal = !!data.finalResult;

  existingCard.innerHTML = `
    <div class="card-header" style="background: ${isExpanded ? '#007bff' : '#f0f0f0'}; color: ${isExpanded ? 'white' : '#333'}; padding: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 13px;">
      <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;">
        📄 ${data.fileName || "알 수 없는 문서"}
      </div>
      <span class="toggle-icon">${isExpanded ? '▼' : '▶'}</span>
    </div>
    <div class="card-body" style="display: ${isExpanded ? 'block' : 'none'}; padding: 12px; max-height: 500px; overflow-y: auto; background: white;">
      <div style="font-size: 11px; margin-bottom: 8px; color: ${isFinal ? '#28a745' : '#856404'}; font-weight: bold;">
        ${isFinal ? '✅ 최종 분석 완료' : '⚡ 1차 요약 완료'} (${data.elapsed || 0}초)
      </div>
      <div class="markdown-body">
        ${processMarkdown(contentHtml)}
      </div>
    </div>
  `;

  const header = existingCard.querySelector('.card-header');
  header.onclick = () => {
    const body = existingCard.querySelector('.card-body');
    const icon = existingCard.querySelector('.toggle-icon');
    const isOpening = body.style.display === 'none';
    
    // Collapse all others if opening this one
    if (isOpening) {
      document.querySelectorAll('.card-body').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.card-header').forEach(el => {
        el.style.background = '#f0f0f0';
        el.style.color = '#333';
      });
      document.querySelectorAll('.toggle-icon').forEach(el => el.textContent = '▶');
    }

    body.style.display = isOpening ? 'block' : 'none';
    header.style.background = isOpening ? '#007bff' : '#f0f0f0';
    header.style.color = isOpening ? 'white' : '#333';
    icon.textContent = isOpening ? '▼' : '▶';
  };

  if (isExpanded) {
    existingCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.getElementById('analyzeBtn').addEventListener('click', () => {
  let elapsedSeconds = 0;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;

    const currentTabId = tabs[0].id;
    const currentUrl = tabs[0].url;

    // 1. Get placeholder data to show "Analyzing..."
    const initialData = {
      fileName: "분석 중...",
      firstResult: "문서를 분석 중입니다. 잠시만 기다려주세요...",
      elapsed: 0,
      timestamp: Date.now()
    };

    // Collapse all others
    document.querySelectorAll('.card-body').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.card-header').forEach(el => {
      el.style.background = '#f0f0f0';
      el.style.color = '#333';
    });
    document.querySelectorAll('.toggle-icon').forEach(el => el.textContent = '▶');

    renderAnalysisCard(currentUrl, initialData, true);

    const timerInterval = setInterval(() => {
      elapsedSeconds++;
    }, 1000);

    // 1. 문서 텍스트 추출
    chrome.tabs.sendMessage(
      currentTabId,
      { action: 'GET_DOCUMENT_DATA' },
      (textResponse) => {

        const currentFileName = textResponse?.fileName || "알 수 없는 문서";

        let fullText =
          textResponse && textResponse.data
            ? textResponse.data.map(item => item.text).join(' ')
            : "";

        // 2. PDF 파일 추출
        chrome.tabs.sendMessage(
          currentTabId,
          { action: 'GET_PDF_FILE' },
          (fileResponse) => {

            const pdfBase64 =
              fileResponse && fileResponse.base64
                ? fileResponse.base64
                : null;

            chrome.runtime.sendMessage(
              {
                action: 'FETCH_FIRST_ANALYSIS',
                text: fullText,
                pdfBase64: pdfBase64
              },
              (firstResponse) => {

                if (!firstResponse || firstResponse.error) {
                  clearInterval(timerInterval);
                  const errorData = {
                    fileName: currentFileName,
                    firstResult: `❌ 1차 분석 에러: ${firstResponse?.error || "통신 실패"}`,
                    elapsed: elapsedSeconds,
                    timestamp: Date.now()
                  };
                  renderAnalysisCard(currentUrl, errorData, true);
                  return;
                }

                const firstAnalysisResult = firstResponse.result;
                const step1Data = {
                  fileName: currentFileName,
                  firstResult: firstAnalysisResult,
                  elapsed: elapsedSeconds,
                  timestamp: Date.now()
                };
                
                chrome.storage.local.set({ [`analysis_${currentUrl}`]: step1Data });
                renderAnalysisCard(currentUrl, step1Data, true);
                
                chrome.runtime.sendMessage(
                  {
                    action: 'FETCH_FINAL_SUMMARY',
                    firstAnalysis: firstAnalysisResult,
                    text: fullText,
                    pdfBase64: pdfBase64
                  },
                  (secondResponse) => {

                    clearInterval(timerInterval);

                    if (!secondResponse || secondResponse.error) {
                      const errorData2 = {
                        fileName: currentFileName,
                        firstResult: firstAnalysisResult,
                        finalResult: `❌ 2차 분석 에러: ${secondResponse?.error || "통신 실패"}`,
                        elapsed: elapsedSeconds,
                        timestamp: Date.now()
                      };
                      renderAnalysisCard(currentUrl, errorData2, true);
                      return;
                    }

                    const rawResult = secondResponse.result;  
                    const step2Data = {
                      fileName: currentFileName,
                      firstResult: firstAnalysisResult,
                      finalResult: rawResult,
                      elapsed: elapsedSeconds,
                      timestamp: Date.now()
                    };

                    chrome.storage.local.set({ [`analysis_${currentUrl}`]: step2Data });
                    renderAnalysisCard(currentUrl, step2Data, true);
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// 🔥 클릭 이벤트: 돋보기 버튼을 누르면 원문 텍스트를 뷰어로 전송하고 콘솔에 표시
document.getElementById('analysisList').addEventListener('click', (e) => {
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

      const sourceConsole = document.getElementById('sourceConsole');
      const sourceTextElement = document.getElementById('sourceText');
      if (sourceConsole && sourceTextElement) {
        sourceTextElement.textContent = `"${quoteText}"`;
        sourceConsole.style.display = 'block';
        document.getElementById('analysisList').style.marginBottom = '160px';
      }
    }
  }
});

// 🔥 콘솔 닫기 버튼 이벤트
document.getElementById('closeConsoleBtn').addEventListener('click', () => {
  document.getElementById('sourceConsole').style.display = 'none';
  document.getElementById('analysisList').style.marginBottom = '0px';
});


function processMarkdown(rawResult) {
  if (!rawResult) return "";

  // 1. 인라인 원문 근거 처리 ( (**원문 근거**: "...") )
  let processedResult = rawResult.replace(
    /\(\*\*원문\s*근거\*\*\s*:\s*"(.*?)"\)/g,
    (match, quoteText) => {
      if (!quoteText || quoteText.trim().length === 0) return "";
      let cleanQuote = quoteText.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safeQuote = cleanQuote.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<span class="clickable-quote" data-quote="${safeQuote}" title="${safeQuote}">🔍</span>`;
    }
  );

  // 2. 블록형 원문 근거 처리
  processedResult = processedResult.replace(
    /(?:-\s*)?\*\*원문\s*근거\*\*\s*:\s*([\s\S]*?)(?=\n\s*- |\n\s*#|$)/g,
    (match, quoteText) => {
      if (!quoteText || quoteText.trim().length === 0) return "";
      let cleanQuote = quoteText.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safeQuote = cleanQuote.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<div style="margin-top:4px;"><span class="clickable-quote" data-quote="${safeQuote}">🔍 원문 하이라이트</span></div>`;
    }
  );

  processedResult = processedResult
    .replace(/^###\s+(.*$)/gim, '<h3>$1</h3>')
    .replace(/^##\s+(.*$)/gim, '<h2>$1</h2>')
    .replace(/^#\s+(.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/^\s*-\s+(.*$)/gim, '<div class="list-item">• $1</div>')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/gim, '<br>')
    .replace(/```markdown/, '')
    .replace(/```/, '');

  return processedResult;
}
