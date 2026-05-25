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

  // 🔥 [NEW] Toggle Logic for Summary Result
  const summaryArea = document.getElementById('summaryArea');
  const summaryContainer = document.getElementById('summaryContainer');
  const summaryHeader = document.getElementById('summaryHeader');
  const summaryToggleIcon = document.getElementById('summaryToggleIcon');

  function toggleSummary(forceOpen = null) {
    const isCurrentlyHidden = summaryArea.style.display === 'none';
    const shouldShow = forceOpen !== null ? forceOpen : isCurrentlyHidden;
    
    summaryArea.style.display = shouldShow ? 'block' : 'none';
    summaryToggleIcon.textContent = shouldShow ? '▼' : '▶';
  }

  summaryHeader.addEventListener('click', () => toggleSummary());

  chrome.storage.local.get(['selectedAI', 'openaiApiKey', 'deepseekApiKey', 'geminiApiKey', 'devMode'], (result) => {
    if (result.selectedAI) aiSelector.value = result.selectedAI;
    if (result.openaiApiKey) openaiKeyInput.value = result.openaiApiKey;
    if (result.deepseekApiKey) deepseekKeyInput.value = result.deepseekApiKey;
    if (result.geminiApiKey) geminiKeyInput.value = result.geminiApiKey;
    if (result.devMode !== undefined) devModeCheckbox.checked = result.devMode;
  });

  // 🔥 [NEW] Check for existing analysis on load
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const currentUrl = tabs[0].url;
    
    chrome.storage.local.get(`analysis_${currentUrl}`, (data) => {
      const saved = data[`analysis_${currentUrl}`];
      if (saved) {
        summaryContainer.style.display = 'block';
        toggleSummary(true);
        if (saved.finalResult) {
          renderFinalAnalysis(saved.finalResult, saved.elapsed, saved.fileName);
        } else if (saved.firstResult) {
          renderFirstAnalysis(saved.firstResult, saved.elapsed, saved.fileName);
        }
      }
    });
  });

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

document.getElementById('analyzeBtn').addEventListener('click', () => {
  const summaryArea = document.getElementById('summaryArea');
  let elapsedSeconds = 0;

  summaryArea.innerHTML = `
    <div class="card" style="text-align: center; line-height: 1.5;">
      문서를 분석 중입니다...<br><br>
      <strong style="color: #007bff; font-size: 16px;">
        ⏱️ <span id="timerSpan">0</span>초
      </strong>
    </div>`;

  const timerInterval = setInterval(() => {
    elapsedSeconds++;

    const timerSpan = document.getElementById('timerSpan');

    if (timerSpan) {
      timerSpan.textContent = elapsedSeconds;
    }
  }, 1000);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;

    const currentTabId = tabs[0].id;

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
        
        summaryArea.innerHTML = `
          <div class="card" style="text-align: center; line-height: 1.5;">
            <div style="font-size: 11px; color: #666; margin-bottom: 8px;">📄 분석 중: ${currentFileName}</div>
            문서를 분석 중입니다...<br><br>
            <strong style="color: #007bff; font-size: 16px;">
              ⏱️ <span id="timerSpan">0</span>초
            </strong>
          </div>`;

        // 2. PDF 파일 추출
        chrome.tabs.sendMessage(
          currentTabId,
          { action: 'GET_PDF_FILE' },
          (fileResponse) => {

            const pdfBase64 =
              fileResponse && fileResponse.base64
                ? fileResponse.base64
                : null;

            // ============================================
            // 🔥 1차 AI 요청
            // ============================================

            chrome.runtime.sendMessage(
              {
                action: 'FETCH_FIRST_ANALYSIS',
                text: fullText,
                pdfBase64: pdfBase64
              },
              (firstResponse) => {

                if (!firstResponse || firstResponse.error) {
                  clearInterval(timerInterval);

                  summaryArea.innerHTML = `
                    <div class="card" style="color:red;">
                      1차 분석 에러:
                      ${firstResponse ? firstResponse.error : "통신 실패"}
                    </div>`;

                  return;
                }

                const firstAnalysisResult = firstResponse.result;
                renderFirstAnalysis(firstAnalysisResult, elapsedSeconds, currentFileName);
                
                // 🔥 [NEW] Save 1st analysis
                chrome.storage.local.set({
                  [`analysis_${currentUrl}`]: {
                    firstResult: firstAnalysisResult,
                    fileName: currentFileName,
                    elapsed: elapsedSeconds,
                    timestamp: Date.now()
                  }
                });
                
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
                      summaryArea.innerHTML = `
                        <div class="card" style="color:red;">
                          <div style="font-size: 11px; opacity: 0.7; margin-bottom: 4px;">📄 ${currentFileName}</div>
                          2차 분석 에러:
                          ${secondResponse ? secondResponse.error : "통신 실패"}
                        </div>`;
                      return;
                    }

                    let rawResult = secondResponse.result;  

                    // 🔥 [NEW] Save Final analysis
                    chrome.storage.local.set({
                      [`analysis_${currentUrl}`]: {
                        firstResult: firstAnalysisResult,
                        finalResult: rawResult,
                        fileName: currentFileName,
                        elapsed: elapsedSeconds,
                        timestamp: Date.now()
                      }
                    });

                    // ============================================
                    // 🔥 최종 출력 (processMarkdown에서 모든 처리 담당)
                    // ============================================
                    renderFinalAnalysis(rawResult, elapsedSeconds, currentFileName);
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
document.getElementById('summaryArea').addEventListener('click', (e) => {
  if (e.target.classList.contains('clickable-quote')) {
    const quoteText = e.target.getAttribute('data-quote');
    
    if (quoteText) {
      // 1. PDF 뷰어에 하이라이트 요청 전송
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'HIGHLIGHT_EXACT_TEXT', 
          text: quoteText 
        });
      });

      // 2. 사이드 패널 하단 콘솔에 원문 텍스트 표시
      const sourceConsole = document.getElementById('sourceConsole');
      const sourceTextElement = document.getElementById('sourceText');
      if (sourceConsole && sourceTextElement) {
        sourceTextElement.textContent = `"${quoteText}"`;
        sourceConsole.style.display = 'block';
        // 분석 영역 하단 여백 추가 (콘솔에 가려지지 않게)
        document.getElementById('summaryArea').style.marginBottom = '160px';
      }
    }
  }
});

// 🔥 콘솔 닫기 버튼 이벤트
document.getElementById('closeConsoleBtn').addEventListener('click', () => {
  document.getElementById('sourceConsole').style.display = 'none';
  document.getElementById('summaryArea').style.marginBottom = '0px';
});


function processMarkdown(rawResult) {
  if (!rawResult) return "";

  // 1. 인라인 원문 근거 처리 ( (**원문 근거**: "...") )
  let processedResult = rawResult.replace(
    /\(\*\*원문\s*근거\*\*\s*:\s*"(.*?)"\)/g,
    (match, quoteText) => {
      if (!quoteText || quoteText.trim().length === 0) return "";
      
      // Normalize quote: remove hyphenated line breaks for better matching
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

      return `
        <div style="margin-top:4px;">
          <span
            class="clickable-quote"
            data-quote="${safeQuote}">
            🔍 원문 하이라이트
          </span>
        </div>`;
    }
  );

  processedResult = processedResult
    .replace(/^###\s+(.*$)/gim, '<h3>$1</h3>')
    .replace(/^##\s+(.*$)/gim, '<h2>$1</h2>')
    .replace(/^#\s+(.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(
      /^\s*-\s+(.*$)/gim,
      '<div class="list-item">• $1</div>'
    )
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/gim, '<br>')
    .replace(/```markdown/, '')
    .replace(/```/, '');

  return processedResult;
}

function renderFirstAnalysis(rawText, elapsedSeconds, fileName) {

  const summaryArea =
    document.getElementById('summaryArea');

  summaryArea.innerHTML = `
    <div class="card"
      style="
        background:#fff8e1;
        margin-bottom:10px;
      ">
      <div style="font-size: 11px; color: #856404; margin-bottom: 4px;">📄 ${fileName}</div>
      ⚡ 빠른 분석 완료
      (<strong>${elapsedSeconds}초</strong>)

      <br><br>

      <small style="color:#666;">
        현재 더 정교한 분석을 진행 중입니다...
      </small>
    </div>

    <div class="card markdown-body">
      ${processMarkdown(rawText)}
    </div>
  `;
}

function renderFinalAnalysis(rawText, elapsedSeconds, fileName) {

  const summaryArea =
    document.getElementById('summaryArea');

  summaryArea.innerHTML = `
    <div class="card"
      style="
        background:#eef7ff;
        margin-bottom:10px;
      ">
      <div style="font-size: 11px; color: #004085; margin-bottom: 4px;">📄 ${fileName}</div>
      ✅ 최종 분석 완료
      (<strong>${elapsedSeconds}초</strong>)
    </div>

    <div class="card markdown-body">
      ${processMarkdown(rawText)}
    </div>
  `;
}