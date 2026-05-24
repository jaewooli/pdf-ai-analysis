import * as pdfjsLib from './lib/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.mjs');

const viewerContainer = document.getElementById('viewerContainer');
const sidebar = document.getElementById('sidebar');

// --- 1. UI 버튼 이벤트 제어 ---
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const btnSingleView = document.getElementById('btnSingleView');
const btnDoubleView = document.getElementById('btnDoubleView');
const openSidePanelBtn = document.getElementById('openSidePanelBtn');

// 썸네일 사이드바 토글
toggleSidebarBtn.addEventListener('click', () => {
  const isActive = sidebar.classList.toggle('active');
  toggleSidebarBtn.classList.toggle('active');
  toggleSidebarBtn.textContent = isActive ? '📑 썸네일 숨기기' : '📑 썸네일 열기';
});

// 1장/2장 보기 토글
btnSingleView.addEventListener('click', () => {
  viewerContainer.className = 'layout-single';
  btnSingleView.classList.add('active');
  btnDoubleView.classList.remove('active');
});

btnDoubleView.addEventListener('click', () => {
  viewerContainer.className = 'layout-double';
  btnDoubleView.classList.add('active');
  btnSingleView.classList.remove('active');
});

// 🚨 AI 사이드 패널 호출! (background로 메시지 전송)
openSidePanelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'OPEN_SIDE_PANEL' });
});


let extractedDocumentData = []; 
let pdfDocument = null;
const scale = 1.5; 
let normalizedFullText = "";
let charToItemMap = [];
let globalPdfBase64 = null;

// 텍스트 추출 함수
async function extractTextWithCoords(page, pageNum) {
  const textContent = await page.getTextContent();
  const pageTextData = [];
  textContent.items.forEach((item, index) => {
    if (item.str.trim() === '') return;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width;
    const height = item.transform[3] || item.height; 
    pageTextData.push({ id: `p${pageNum}-i${index}`, text: item.str, pageNumber: pageNum, coords: [x, y, x + width, y + height] });
  });
  return pageTextData;
}

// --- 2. 메인 렌더링 함수 (썸네일 생성 추가) ---
async function renderPDF(url) {
  try {
    viewerContainer.innerHTML = '<h3 style="color:white; margin-top:20px;">PDF를 불러오는 중입니다...</h3>';
    sidebar.innerHTML = ''; 
    
    pdfDocument = await pdfjsLib.getDocument(url).promise;
    viewerContainer.innerHTML = ''; 
    extractedDocumentData = []; 
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale });

      // 1. 메인 뷰어용 컨테이너 생성
      const pageContainer = document.createElement('div');
      pageContainer.className = 'pdf-page-container';
      pageContainer.dataset.pageNumber = pageNum;
      pageContainer.style.width = `${viewport.width}px`;
      pageContainer.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      // 🚨 [여기가 핵심!] 실제 페이지 렌더링 로직
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      pageContainer.appendChild(canvas);
      viewerContainer.appendChild(pageContainer);

      // 2. 썸네일 생성 로직
      const thumbScale = 180 / viewport.width; 
      const thumbViewport = page.getViewport({ scale: thumbScale });
      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'thumbnail-container';
      
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'thumbnail-canvas';
      thumbCanvas.width = thumbViewport.width;
      thumbCanvas.height = thumbViewport.height;
      await page.render({ canvasContext: thumbCanvas.getContext('2d'), viewport: thumbViewport }).promise;
      
      const thumbLabel = document.createElement('div');
      thumbLabel.textContent = `${pageNum} / ${pdfDocument.numPages}쪽`;
      thumbContainer.appendChild(thumbCanvas);
      thumbContainer.appendChild(thumbLabel);
      
      thumbContainer.addEventListener('click', () => { 
        pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' }); 
      });
      sidebar.appendChild(thumbContainer);

      // 3. 텍스트 데이터 추출
      const pageData = await extractTextWithCoords(page, pageNum);
      extractedDocumentData.push(...pageData);
    }

    // 🔥 [핵심 2] 원본 데이터 Base64 추출 (이게 있어야 AI가 PDF를 봅니다)
    const pdfData = await pdfDocument.getData();
    let binary = '';
    for (let i = 0; i < pdfData.byteLength; i++) { binary += String.fromCharCode(pdfData[i]); }
    globalPdfBase64 = window.btoa(binary);

  } catch (error) {
    console.error('PDF 로드 실패:', error);
  }
}

// 🔥 [핵심 3] 퍼지 매칭 하이라이트 (스마트 앵커 폴백)
function drawExactHighlight(sourceText) {
  // 동일하게 정규화
  const target = sourceText.normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  if (!target) return;

  let startIndex = normalizedFullText.indexOf(target);
  let matchLength = target.length;

  // 100% 일치가 없으면, 앞부분 20글자 + 뒷부분 20글자로 매칭 시도
  if (startIndex === -1 && target.length > 40) {
    const prefix = target.substring(0, 20);
    const suffix = target.substring(target.length - 20);
    const pIdx = normalizedFullText.indexOf(prefix);
    const sIdx = normalizedFullText.lastIndexOf(suffix);
    if (pIdx !== -1 && sIdx !== -1 && sIdx > pIdx) {
      startIndex = pIdx;
      matchLength = (sIdx + suffix.length) - pIdx;
    }
  }

  if (startIndex === -1) {
    alert("하이라이트 위치를 찾을 수 없습니다. (원문과 불일치)(원문: "+sourceText+")");
    return;
  }

  const matchedItems = new Set();
  for(let i = startIndex; i < startIndex + matchLength; i++) {
    if(charToItemMap[i]) matchedItems.add(charToItemMap[i]);
  }

  document.querySelectorAll('.highlight-box').forEach(el => el.remove());
  const itemsByPage = {};
  matchedItems.forEach(item => {
    if(!itemsByPage[item.pageNumber]) itemsByPage[item.pageNumber] = [];
    itemsByPage[item.pageNumber].push(item);
  });

  Object.keys(itemsByPage).forEach(pageNum => {
    const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
    if(!pageContainer) return;
    pdfDocument.getPage(Number(pageNum)).then(page => {
      const viewport = page.getViewport({ scale: scale });
      itemsByPage[pageNum].forEach(item => {
        const rect = viewport.convertToViewportRectangle(item.coords);
        const highlight = document.createElement('div');
        highlight.className = 'highlight-box';
        highlight.style.left = `${rect[0]}px`;
        highlight.style.top = `${Math.min(rect[1], rect[3])}px`;
        highlight.style.width = `${Math.abs(rect[2] - rect[0])}px`;
        highlight.style.height = `${Math.abs(rect[3] - rect[1])}px`;
        highlight.style.backgroundColor = 'rgba(255, 235, 59, 0.5)';
        pageContainer.appendChild(highlight);
        setTimeout(() => highlight.remove(), 3000);
      });
    });
  });
}

// ==========================================
// 메시지 통신 및 파일 변환 리스너
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'HIGHLIGHT_EXACT_TEXT') {
    drawExactHighlight(request.text);
  }
  
  if (request.action === 'GET_DOCUMENT_DATA') {
    const optimizedData = mergeTextBlocks(extractedDocumentData);
    sendResponse({ data: optimizedData });
  }
});
// ==========================================
// 🚨 [가장 중요한 부분] 여기서부터 뷰어 렌더링이 시작됩니다!
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
// fileUrl은 상단에서 let이나 const로 선언되지 않도록 주의 (여기서 선언)
window.fileUrl = urlParams.get('file'); // 글로벌로 빼서 XHR에서도 접근 가능하게 처리

if (window.fileUrl) {
  renderPDF(window.fileUrl);
} else {
  viewerContainer.innerHTML = '<h3 style="color:red; margin-top:20px;">PDF 경로를 찾을 수 없습니다.</h3>';
}

function mergeTextBlocks(rawData) {
  const mergedData = [];
  const pages = [...new Set(rawData.map(item => item.pageNumber))];

  pages.forEach(pageNum => {
    const pageItems = rawData.filter(item => item.pageNumber === pageNum);
    pageItems.sort((a, b) => b.coords[1] - a.coords[1] || a.coords[0] - b.coords[0]);

    let currentBlock = null;
    const Y_TOLERANCE = 15; 

    pageItems.forEach(item => {
      if (!currentBlock) {
        currentBlock = { ...item, id: `p${pageNum}-block${mergedData.length}` };
        return;
      }
      const yDiff = Math.abs(currentBlock.coords[1] - item.coords[1]);
      if (yDiff < Y_TOLERANCE) {
        currentBlock.text += " " + item.text;
        currentBlock.coords = [
          Math.min(currentBlock.coords[0], item.coords[0]), 
          Math.min(currentBlock.coords[1], item.coords[1]), 
          Math.max(currentBlock.coords[2], item.coords[2]), 
          Math.max(currentBlock.coords[3], item.coords[3])  
        ];
      } else {
        mergedData.push(currentBlock);
        currentBlock = { ...item, id: `p${pageNum}-block${mergedData.length}` };
      }
    });
    if (currentBlock) mergedData.push(currentBlock);
  });
  return mergedData;
}