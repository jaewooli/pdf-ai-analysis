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
    sidebar.innerHTML = ''; // 사이드바 초기화
    
    pdfDocument = await pdfjsLib.getDocument(url).promise;
    viewerContainer.innerHTML = ''; 
    extractedDocumentData = []; 
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      
      // [메인 캔버스 렌더링]
      const viewport = page.getViewport({ scale: scale });
      const pageContainer = document.createElement('div');
      pageContainer.className = 'pdf-page-container';
      pageContainer.dataset.pageNumber = pageNum;
      pageContainer.style.width = `${viewport.width}px`;
      pageContainer.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      pageContainer.appendChild(canvas);
      viewerContainer.appendChild(pageContainer);

      // 🖼️ [썸네일 캔버스 렌더링 추가]
      const thumbScale = 180 / viewport.width; // 썸네일 가로를 180px로 맞춤
      const thumbViewport = page.getViewport({ scale: thumbScale });
      
      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'thumbnail-container';
      
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'thumbnail-canvas';
      thumbCanvas.width = thumbViewport.width;
      thumbCanvas.height = thumbViewport.height;
      const thumbCtx = thumbCanvas.getContext('2d');
      
      // 메인 렌더링 직후 작은 캔버스에 한 번 더 렌더링
      await page.render({ canvasContext: thumbCtx, viewport: thumbViewport }).promise;
      
      const thumbLabel = document.createElement('div');
      thumbLabel.textContent = `${pageNum} / ${pdfDocument.numPages}`;
      
      thumbContainer.appendChild(thumbCanvas);
      thumbContainer.appendChild(thumbLabel);
      
      // 썸네일 클릭 시 해당 페이지로 스무스하게 스크롤 이동!
      thumbContainer.addEventListener('click', () => {
        pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      sidebar.appendChild(thumbContainer);

      // 텍스트 데이터 추출
      const pageData = await extractTextWithCoords(page, pageNum);
      extractedDocumentData.push(...pageData);
    }
    
    normalizedFullText = "";
    charToItemMap = [];
    extractedDocumentData.forEach(item => {
      const normText = item.text.replace(/\s+/g, '').toLowerCase(); 
      for(let i=0; i < normText.length; i++) {
        normalizedFullText += normText[i];
        charToItemMap.push(item); 
      }
    });

    const pdfData = await pdfDocument.getData();
    let binary = '';
    for (let i = 0; i < pdfData.byteLength; i++) {
      binary += String.fromCharCode(pdfData[i]);
    }
    globalPdfBase64 = window.btoa(binary);

  } catch (error) {
    console.error('PDF 로드 실패:', error);
    viewerContainer.innerHTML = '<h3 style="color:red; margin-top:20px;">PDF를 열 수 없습니다.</h3>';
  }
}
// ... 이하 생략 (기존 drawExactHighlight 등의 함수 유지) ...

// 🔥 [새로운 기능] 정확한 텍스트에만 진짜 형광펜처럼 여러 박스 그리기
function drawExactHighlight(sourceText) {
  // 1. 찾을 텍스트 정규화
  const target = sourceText.replace(/\s+/g, '').toLowerCase();
  const startIndex = normalizedFullText.indexOf(target);

  if (startIndex === -1) {
    alert("원문에서 해당 텍스트를 찾을 수 없습니다.");
    return;
  }

  const endIndex = startIndex + target.length;
  const matchedItems = new Set(); // 중복 방지를 위한 Set

  // 2. 해당 글자 인덱스에 속하는 원본 텍스트 조각들을 모두 모음
  for(let i = startIndex; i < endIndex; i++) {
    matchedItems.add(charToItemMap[i]);
  }

  // 3. 페이지별로 아이템 그룹화
  const itemsByPage = {};
  matchedItems.forEach(item => {
    if(!itemsByPage[item.pageNumber]) itemsByPage[item.pageNumber] = [];
    itemsByPage[item.pageNumber].push(item);
  });

  // 기존 하이라이트 제거
  document.querySelectorAll('.highlight-box').forEach(el => el.remove());

  let firstPage = null;

  // 4. 찾은 조각들마다 각각 하이라이트 박스 생성 (진짜 형광펜 효과)
  Object.keys(itemsByPage).forEach(pageNum => {
    if(!firstPage) firstPage = pageNum;
    const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
    if(!pageContainer) return;

    pdfDocument.getPage(Number(pageNum)).then(page => {
      const viewport = page.getViewport({ scale: scale });
      
      itemsByPage[pageNum].forEach(item => {
        const rect = viewport.convertToViewportRectangle(item.coords);
        const [left, top, right, bottom] = rect;
        const width = Math.abs(right - left);
        const height = Math.abs(bottom - top);
        const renderTop = Math.min(top, bottom);

        const highlight = document.createElement('div');
        highlight.className = 'highlight-box';
        highlight.style.left = `${left}px`;
        highlight.style.top = `${renderTop}px`;
        highlight.style.width = `${width}px`;
        highlight.style.height = `${height}px`;
        // 기존 테두리를 없애고 배경색만 강조하여 진짜 글씨에 친 형광펜처럼 보이게 함
        highlight.style.border = 'none'; 
        highlight.style.backgroundColor = 'rgba(255, 235, 59, 0.5)';
        
        pageContainer.appendChild(highlight);

        setTimeout(() => {
          highlight.style.opacity = '0';
          setTimeout(() => highlight.remove(), 500);
        }, 3000);
      });
    });
  });

  // 5. 첫 번째 매칭된 페이지로 스크롤
  if(firstPage) {
    const targetPage = document.querySelector(`.pdf-page-container[data-page-number="${firstPage}"]`);
    targetPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
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