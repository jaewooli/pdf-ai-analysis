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
      statusMsg.textContent = 'Settings Saved';
      setTimeout(() => { statusMsg.textContent = ''; }, 2000);
    });
  });

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all analysis history?')) {
      chrome.storage.local.get(null, (items) => {
        if (!items) return;
        const keysToRemove = Object.keys(items).filter(k => k.startsWith('analysis_'));
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            document.getElementById('analysisList').innerHTML = '<div style="color:#adb5bd; text-align:center; padding:40px;">History Cleared</div>';
          });
        }
      });
    }
  });

  document.getElementById('explainSecurityBtn').addEventListener('click', () => {
    alert("Security Information:\nYour API keys are stored safely in your browser's local storage (chrome.storage.local). They are never sent to external servers except for direct communication with the AI providers.");
  });

  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
});

// Track URLs currently being analyzed
const analyzingUrls = new Set();

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
  const tab = await getActiveViewerTab();
  if (!tab || !tab.url) {
    alert("Could not find a valid PDF viewer tab.\n\n1. Ensure the PDF is opened in our viewer.\n2. If it's a local file, enable 'Allow access to file URLs' in extension settings.");
    return;
  }
  
  const url = tab.url;
  const isCurrentlyAnalyzing = await chrome.runtime.sendMessage({ action: 'IS_ANALYZING', url: url });
  if (isCurrentlyAnalyzing?.analyzing || analyzingUrls.has(url)) {
    alert("Analysis is already in progress for this document.");
    return;
  }

  let timer = null;
  try {
    analyzingUrls.add(url);
    const tabId = tab.id;
    const cardId = getUrlId(url);

    // 1. Initial State before getting data
    renderCard(url, {
      fileName: "Analyzing...",
      firstResult: "### Preparation\nPlease wait while we process the document...",
      elapsed: 0
    }, true);

    const textRes = await chrome.tabs.sendMessage(tabId, { action: 'GET_DOCUMENT_DATA' }).catch(e => null);
    if (!textRes) {
      throw new Error("Could not connect to PDF viewer. Please refresh the page.");
    }

    if (!analyzingUrls.has(url)) return;

    // 2. Update with Actual Filename
    const fileName = textRes.fileName || "Unknown Document";
    renderCard(url, {
      fileName: `Analyzing ${fileName}`,
      firstResult: "### Preparation\nPlease wait while we process the document...",
      elapsed: 0
    }, true);

    // Start Timer
    let elapsed = 0;
    timer = setInterval(() => {
      elapsed++;
      const timerSpan = document.querySelector(`[data-timer-url="${cardId}"]`);
      if (timerSpan) timerSpan.textContent = `${elapsed}s`;
    }, 1000);

    const fullText = (textRes.data && Array.isArray(textRes.data)) ? textRes.data.map(i => i.text).join(' ') : "";
    const fileRes = await chrome.tabs.sendMessage(tabId, { action: 'GET_PDF_FILE' }).catch(e => null);
    const pdfBase64 = fileRes?.base64 || null;

    if (!analyzingUrls.has(url)) { clearInterval(timer); return; }

    const stage1Res = await chrome.runtime.sendMessage({
      action: 'FETCH_FIRST_ANALYSIS',
      url: url,
      text: fullText,
      pdfBase64: pdfBase64
    }).catch(e => ({ error: e.message }));

    if (!analyzingUrls.has(url)) { clearInterval(timer); return; }
    if (stage1Res.error) {
      if (stage1Res.error === 'STOPPED') return;
      throw new Error(stage1Res.error);
    }

    const firstResult = stage1Res.result;
    const step1Data = { fileName, firstResult, elapsed, timestamp: Date.now() };
    chrome.storage.local.set({ [`analysis_${url}`]: step1Data });
    renderCard(url, step1Data, true);

    if (!analyzingUrls.has(url)) { clearInterval(timer); return; }

    const stage2Res = await chrome.runtime.sendMessage({
      action: 'FETCH_FINAL_SUMMARY',
      url: url,
      firstAnalysis: firstResult,
      text: fullText,
      pdfBase64: pdfBase64
    }).catch(e => ({ error: e.message }));

    if (timer) clearInterval(timer);
    if (!analyzingUrls.has(url)) return;
    if (stage2Res.error) {
      if (stage2Res.error === 'STOPPED') return;
      throw new Error(stage2Res.error);
    }

    const finalResult = stage2Res.result;
    const finalData = { fileName, firstResult, finalResult, elapsed, timestamp: Date.now() };
    chrome.storage.local.set({ [`analysis_${url}`]: finalData });
    
    // FINAL RENDER: This will remove the stop button because analyzingUrls.delete(url) happens in finally
    analyzingUrls.delete(url); 
    renderCard(url, finalData, true);

  } catch (err) {
    console.error("Analysis Crash:", err);
    if (timer) clearInterval(timer);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      renderCard(tabs[0].url, {
        fileName: "Error Occurred",
        firstResult: `Analysis failed: ${err.message}`,
        elapsed: 0
      }, true);
    }
  } finally {
    if (timer) clearInterval(timer);
    analyzingUrls.delete(url);
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
  const isAnalyzing = analyzingUrls.has(url);
  const content = data.finalResult || data.firstResult || "No analysis data found.";

  card.innerHTML = `
    <div class="card-header" id="h_${cardId}" style="cursor: pointer;">
      <span class="card-title">${data.fileName || "Document Analysis"}</span>
      <div style="display:flex; align-items:center;">
        <span class="card-timer" data-timer-url="${cardId}">${data.elapsed || 0}s</span>
        ${isAnalyzing ? `<button class="stop-btn" data-url="${url}">Stop</button>` : ''}
        <span class="toggle-icon" style="margin-left:8px;">${isExpanded ? 'Collapse' : 'Expand'}</span>
      </div>
    </div>
    <div class="card-body" id="b_${cardId}" style="display: ${isExpanded ? 'block' : 'none'};">
      <div class="status-badge ${isFinal ? 'status-done' : 'status-loading'}">
        ${isFinal ? 'Completed' : 'Processing'}
      </div>
      <div class="markdown-body">
        ${processMarkdown(content)}
      </div>
    </div>
  `;

  // Stop button handler
  const stopBtn = card.querySelector('.stop-btn');
  if (stopBtn) {
    stopBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to stop the analysis?')) {
        const urlToStop = stopBtn.getAttribute('data-url');
        analyzingUrls.delete(urlToStop);
        chrome.runtime.sendMessage({ action: 'STOP_ANALYSIS', url: urlToStop });
        
        // Update UI to show stopped status
        renderCard(urlToStop, {
          ...data,
          firstResult: (data.firstResult || "") + "\n\nAnalysis stopped by user."
        }, true);
      }
    };
  }

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
        icon.textContent = isHidden ? 'Collapse' : 'Expand';
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
  if (!raw || typeof raw !== 'string') return "No content to display.";
  let html = raw
    .replace(/\(\*\*Source\*\*\s*:\s*"(.*?)"\)/g, (m, q) => {
      if (!q) return "";
      // Handle potential multiple sentences by just cleaning whitespace and keeping the text together
      let clean = q.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safe = clean.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<span class="clickable-quote" data-quote="${safe}">Source</span>`;
    })
    .replace(/(?:-\s*)?\*\*Source\*\*\s*:\s*([\s\S]*?)(?=\n\s*- |\n\s*#|$)/g, (m, q) => {
      if (!q) return "";
      let clean = q.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
      let safe = clean.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<div style="margin-top:10px;"><span class="clickable-quote" data-quote="${safe}">View Source Context</span></div>`;
    });


  html = html
    .replace(/^###\s+(.*$)/gim, '<h3>$1</h3>')
    .replace(/^##\s+(.*$)/gim, '<h2>$1</h2>')
    .replace(/^#\s+(.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/^\s*-\s+(.*$)/gim, '<div class="list-item"><span class="list-dot">&bull;</span><span>$1</span></div>')
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
