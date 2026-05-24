import * as pdfjsLib from './lib/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.mjs');

const viewerContainer = document.getElementById('viewerContainer');
let extractedDocumentData = []; // 원본 텍스트 조각들
let pdfDocument = null;
const scale = 1.5; 

// 🔥 글자 단위 정밀 매핑을 위한 전역 변수
let normalizedFullText = "";
let charToItemMap = [];

async function extractTextWithCoords(page, pageNum) {
  const textContent = await page.getTextContent();
  const pageTextData = [];

  textContent.items.forEach((item, index) => {
    if (item.str.trim() === '') return;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width;
    const height = item.transform[3] || item.height; 

    pageTextData.push({
      id: `p${pageNum}-i${index}`,
      text: item.str,
      pageNumber: pageNum,
      coords: [x, y, x + width, y + height]
    });
  });

  return pageTextData;
}

async function renderPDF(url) {
  try {
    viewerContainer.innerHTML = '<h3 style="color:white; margin-top:20px;">PDF를 불러오는 중입니다...</h3>';
    pdfDocument = await pdfjsLib.getDocument(url).promise;
    viewerContainer.innerHTML = ''; 
    extractedDocumentData = []; 
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
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

      const pageData = await extractTextWithCoords(page, pageNum);
      extractedDocumentData.push(...pageData);
    }
    
    // 🔥 [핵심] 모든 추출이 끝나면, 글자 단위로 어떤 좌표의 아이템인지 매핑합니다.
    normalizedFullText = "";
    charToItemMap = [];
    extractedDocumentData.forEach(item => {
      const normText = item.text.replace(/\s+/g, '').toLowerCase(); // 공백 제거 소문자
      for(let i=0; i < normText.length; i++) {
        normalizedFullText += normText[i];
        charToItemMap.push(item); // 각 글자가 어떤 텍스트 조각 소속인지 저장
      }
    });

  } catch (error) {
    console.error('PDF 로드 실패:', error);
  }
}

// 문단 병합 함수 (AI에게 데이터를 보낼 때만 사용)
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

// 메시지 통신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'HIGHLIGHT_EXACT_TEXT') {
    // 뷰어가 텍스트를 직접 받아서 알아서 매핑하고 그립니다.
    drawExactHighlight(request.text);
  }
  
  if (request.action === 'GET_DOCUMENT_DATA') {
    const optimizedData = mergeTextBlocks(extractedDocumentData);
    sendResponse({ data: optimizedData });
  }
});

const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get('file');
if (fileUrl) renderPDF(fileUrl);