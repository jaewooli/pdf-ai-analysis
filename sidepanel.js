document.addEventListener('DOMContentLoaded', () => {
  const toggleConfigBtn = document.getElementById('toggleConfigBtn');
  const configContent = document.getElementById('configContent');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  
  const aiSelector = document.getElementById('ai-selector');
  const openaiKeyInput = document.getElementById('openai-key');
  const deepseekKeyInput = document.getElementById('deepseek-key');
  const geminiKeyInput = document.getElementById('gemini-key');
  const devModeCheckbox = document.getElementById('dev-mode');
  const statusMsg = document.getElementById('statusMsg');

  // 1. Load Settings Safely
  chrome.storage.local.get(['selectedAI', 'openaiApiKey', 'deepseekApiKey', 'geminiApiKey', 'devMode'], (result) => {
    if (!result) return;
    if (result.selectedAI) aiSelector.value = result.selectedAI;
    if (result.openaiApiKey) openaiKeyInput.value = result.openaiApiKey;
    if (result.deepseekApiKey) deepseekKeyInput.value = result.deepseekApiKey;
    if (result.geminiApiKey) geminiKeyInput.value = result.geminiApiKey;
    if (result.devMode !== undefined) devModeCheckbox.checked = result.devMode;
  });

  // 2. Load All History
  loadAllHistory();

  // --- Listeners ---
  toggleConfigBtn.addEventListener('click', () => {
    configContent.classList.toggle('active');
  });

  saveConfigBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      selectedAI: aiSelector.value || 'local',
      openaiApiKey: openaiKeyInput.value.trim() || '',
      deepseekApiKey: deepseekKeyInput.value.trim() || '',
      geminiApiKey: geminiKeyInput.value.trim() || '',
      devMode: devModeCheckbox.checked
    }, () => {
      statusMsg.textContent = '✅ 저장 완료';
      setTimeout(() => { statusMsg.textContent = ''; }, 2000);
    });
  });

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('모든 기록을 삭제하시겠습니까?')) {
      chrome.storage.local.get(null, (items) => {
        if (!items) return;
        const keysToRemove = Object.keys(items).filter(k => k.startsWith('analysis_'));
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            document.getElementById('analysisList').innerHTML = '<div style="color:#adb5bd; text-align:center; padding:40px;">삭제 완료</div>';
          });
        }
      });
    }
  });

  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
});

/**
 * Robustly find the active PDF viewer tab
 */
async function getActiveViewerTab() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !tab.url.includes('viewer.html')) {
    const allTabs = await chrome.tabs.query({ url: chrome.runtime.getURL('viewer.html*') });
    if (allTabs.length > 0) {
      tab = allTabs[0];
    }
  }
  return tab;
}

async function runAnalysis() {
  try {
    const tab = await getActiveViewerTab();
    if (!tab || !tab.url) {
      alert("분석할 수 있는 PDF 화면을 찾을 수 없습니다.\n\n1. PDF가 우리 프로그램 전용 뷰어로 열려 있는지 확인해주세요.\n2. 로컬 파일(file://)인 경우, 확장 프로그램 설정에서 '파일 URL에 대한 액세스 허용'을 켜주어야 합니다.");
      return;
    }
    const url = tab.url;
    const tabId = tab.id;
    const cardId = getUrlId(url);

    // Rollback: Removed collapseAllCards() here
    renderCard(url, {
      fileName: "분석 진행 중...",
      firstResult: "### 분석 준비\n잠시만 기다려주세요...",
      elapsed: 0
    }, true);

    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed++;
      const timerSpan = document.querySelector(`[data-timer-url="${cardId}"]`);
      if (timerSpan) timerSpan.textContent = `${elapsed}초`;
    }, 1000);

    const textRes = await chrome.tabs.sendMessage(tabId, { action: 'GET_DOCUMENT_DATA' }).catch(e => null);
    if (!textRes) {
      clearInterval(timer);
      throw new Error("PDF 뷰어와 연결할 수 없습니다. 페이지를 새로고침 해주세요.");
    }

    const fileName = textRes.fileName || "알 수 없는 문서";
    const fullText = (textRes.data && Array.isArray(textRes.data)) ? textRes.data.map(i => i.text).join(' ') : "";
    const fileRes = await chrome.tabs.sendMessage(tabId, { action: 'GET_PDF_FILE' }).catch(e => null);
    const pdfBase64 = fileRes?.base64 || null;

    const stage1Res = await chrome.runtime.sendMessage({
      action: 'FETCH_FIRST_ANALYSIS',
      text: fullText,
      pdfBase64: pdfBase64
    }).catch(e => ({ error: e.message }));

    if (stage1Res.error) throw new Error(stage1Res.error);

    const firstResult = stage1Res.result;
    const step1Data = { fileName, firstResult, elapsed, timestamp: Date.now() };
    chrome.storage.local.set({ [`analysis_${url}`]: step1Data });
    renderCard(url, step1Data, true);

    const stage2Res = await chrome.runtime.sendMessage({
      action: 'FETCH_FINAL_SUMMARY',
      firstAnalysis: firstResult,
      text: fullText,
      pdfBase64: pdfBase64
    }).catch(e => ({ error: e.message }));

    if (stage2Res.error) throw new Error(stage2Res.error);

    const finalResult = stage2Res.result;
    clearInterval(timer);
    
    const finalData = { fileName, firstResult, finalResult, elapsed, timestamp: Date.now() };
    chrome.storage.local.set({ [`analysis_${url}`]: finalData });
    renderCard(url, finalData, true);

  } catch (err) {
    console.error("Analysis Crash:", err);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      renderCard(tabs[0].url, {
        fileName: "오류 발생",
        firstResult: `❌ 분석 중 오류가 발생했습니다: ${err.message}`,
        elapsed: 0
      }, true);
    }
  }
}

function getUrlId(url) {
  if (!url || typeof url !== 'string') return 'c-default';
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return 'c' + Math.abs(hash).toString(36);
}

function renderCard(url, data, isExpanded = true) {
  if (!url) return;
  const list = document.getElementById('analysisList');
  if (!list) return;

  const cardId = getUrlId(url);
  let card = document.getElementById(cardId);
  
  if (!card) {
    const placeholder = document.getElementById('placeholder');
    if (placeholder) placeholder.remove();
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'result-card';
    list.prepend(card);
  }

  const isFinal = !!data.finalResult;
  const content = data.finalResult || data.firstResult || "분석 정보를 불러올 수 없습니다.";

  card.innerHTML = `
    <div class="card-header" id="h_${cardId}" style="cursor: pointer;">
      <span class="card-title">📄 ${data.fileName || "문서 분석"}</span>
      <div style="display:flex; align-items:center;">
        <span class="card-timer" data-timer-url="${cardId}">${data.elapsed || 0}초</span>
        <span class="toggle-icon">${isExpanded ? '▼' : '▶'}</span>
      </div>
    </div>
    <div class="card-body" id="b_${cardId}" style="display: ${isExpanded ? 'block' : 'none'};">
      <div class="status-badge ${isFinal ? 'status-done' : 'status-loading'}">
        ${isFinal ? '최종 완료' : '진행 중...'}
      </div>
      <div class="markdown-body">
        ${processMarkdown(content)}
      </div>
    </div>
  `;

  // Rollback: Simplified toggle (no auto-collapse of others)
  const header = document.getElementById(`h_${cardId}`);
  if (header) {
    header.onclick = (e) => {
      e.stopPropagation();
      const body = document.getElementById(`b_${cardId}`);
      const icon = header.querySelector('.toggle-icon');
      if (body && icon) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▼' : '▶';
      }
    };
  }

  if (isExpanded) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * Loads all saved analyses and renders them.
 * The current tab's result is expanded, others are collapsed.
 */
async function loadAllHistory() {
  const tab = await getActiveViewerTab();
  const currentUrl = tab?.url || null;

  chrome.storage.local.get(null, (allData) => {
    if (!allData) return;
    
    const analysisKeys = Object.keys(allData).filter(k => k.startsWith('analysis_'));
    if (analysisKeys.length === 0) return;

    // Sort by timestamp: Oldest first because we use prepend() in renderCard
    // (Oldest prepended first -> Newest prepended last = Newest at top)
    const sortedKeys = analysisKeys.sort((a, b) => (allData[a].timestamp || 0) - (allData[b].timestamp || 0));

    sortedKeys.forEach(key => {
      const url = key.replace('analysis_', '');
      const data = allData[key];
      if (data) {
        const isCurrent = (url === currentUrl);
        renderCard(url, data, isCurrent);
      }
    });
  });
}

function processMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return "결과가 비어있습니다.";
  let html = raw
    .replace(/\(\*\*원문\s*근거\*\*\s*:\s*"(.*?)"\)/g, (m, q) => {
      if (!q) return "";
      let clean = q.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safe = clean.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<span class="clickable-quote" data-quote="${safe}">🔍</span>`;
    })
    .replace(/(?:-\s*)?\*\*원문\s*근거\*\*\s*:\s*([\s\S]*?)(?=\n\s*- |\n\s*#|$)/g, (m, q) => {
      if (!q) return "";
      let clean = q.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safe = clean.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<div style="margin-top:10px;"><span class="clickable-quote" data-quote="${safe}">🔍 원문 하이라이트</span></div>`;
    });

  html = html
    .replace(/^###\s+(.*$)/gim, '<h3>$1</h3>')
    .replace(/^##\s+(.*$)/gim, '<h2>$1</h2>')
    .replace(/^#\s+(.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/^\s*-\s+(.*$)/gim, '<div class="list-item"><span class="list-dot">•</span><span>$1</span></div>')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/gim, '<br>')
    .replace(/```markdown|```/g, '');
  return html;
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('clickable-quote')) {
    const quote = e.target.getAttribute('data-quote');
    if (!quote) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'HIGHLIGHT_EXACT_TEXT', text: quote }).catch(e => null);
    });
    const consoleBox = document.getElementById('sourceConsole');
    const textBox = document.getElementById('sourceText');
    if (consoleBox && textBox) {
      textBox.textContent = `"${quote}"`;
      consoleBox.style.display = 'block';
    }
  }
});

const closeBtn = document.getElementById('closeConsoleBtn');
if (closeBtn) {
  closeBtn.onclick = () => {
    const consoleBox = document.getElementById('sourceConsole');
    if (consoleBox) consoleBox.style.display = 'none';
  };
}
