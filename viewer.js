// 1. PDF.js 모듈 불러오기 및 워커 설정
import * as pdfjsLib from './lib/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.mjs');

// 2. 전역 변수 설정
const viewerContainer = document.getElementById('viewerContainer');
let extractedDocumentData = [];
let pdfDocument = null;
const scale = 1.5; // PDF 화면 확대 배율

// 3. 특정 페이지의 텍스트와 좌표를 추출하는 함수
async function extractTextWithCoords(page, pageNum) {
  const textContent = await page.getTextContent();
  const pageTextData = [];

  textContent.items.forEach((item, index) => {
    if (item.str.trim() === '') return; // 공백 제외

    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width;
    const height = item.transform[3] || item.height; 

    const coords = [x, y, x + width, y + height];

    pageTextData.push({
      id: `p${pageNum}-i${index}`,
      text: item.str,
      pageNumber: pageNum,
      coords: coords
    });
  });

  return pageTextData;
}

// 4. PDF 렌더링 및 데이터 추출 메인 함수
async function renderPDF(url) {
  try {
    viewerContainer.innerHTML = '<h3 style="color:white; margin-top:20px;">PDF를 불러오는 중입니다...</h3>';
    
    pdfDocument = await pdfjsLib.getDocument(url).promise;
    viewerContainer.innerHTML = ''; // 로딩 메시지 제거
    extractedDocumentData = []; 
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale });

      // 화면에 그릴 컨테이너 생성
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

      // 텍스트 및 좌표 추출
      const pageData = await extractTextWithCoords(page, pageNum);
      extractedDocumentData.push(...pageData);
    }
    
    console.log("📄 문서 추출 완료! 총 텍스트 조각 수:", extractedDocumentData.length);

  } catch (error) {
    console.error('PDF 로드 실패:', error);
    viewerContainer.innerHTML = `<h3 style="color:#ff6b6b; margin-top:20px;">PDF를 불러오지 못했습니다.<br>보안(CORS) 문제이거나 파일 경로가 잘못되었습니다.</h3>`;
  }
}

// 5. 텍스트 블록 병합 함수
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

// 6. 하이라이트 박스 그리기 함수 (누락되었던 부분!)
function drawHighlight(pageNumber, pdfCoords) {
  const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNumber}"]`);
  if (!pageContainer || !pdfDocument) return;

  pageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

  pdfDocument.getPage(pageNumber).then(page => {
    const viewport = page.getViewport({ scale: scale });
    const rect = viewport.convertToViewportRectangle(pdfCoords);
    
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

    // 기존 하이라이트 지우기
    document.querySelectorAll('.highlight-box').forEach(el => el.remove());
    pageContainer.appendChild(highlight);

    setTimeout(() => {
      highlight.style.opacity = '0';
      setTimeout(() => highlight.remove(), 500);
    }, 3000);
  });
}

// 7. 메시지 통신 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'HIGHLIGHT_ORIGINAL') {
    drawHighlight(request.data.pageNumber, request.data.coords);
  }
  
  if (request.action === 'GET_DOCUMENT_DATA') {
    const optimizedData = mergeTextBlocks(extractedDocumentData);
    console.log(`[최적화 완료] 원본 ${extractedDocumentData.length}개 -> 병합 ${optimizedData.length}개`);
    sendResponse({ data: optimizedData });
  }
});

// 8. ★가장 중요: URL에서 파일 경로를 읽어와 렌더링을 시작하는 최초 실행부!★
const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get('file');

if (fileUrl) {
  renderPDF(fileUrl);
} else {
  viewerContainer.innerHTML = '<h3 style="color:white; margin-top:20px;">표시할 PDF 파일이 없습니다.</h3>';
}