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
  toggleSidebarBtn.textContent = isActive ? 'Hide Thumbnails' : 'Show Thumbnails';
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
    viewerContainer.innerHTML = '<h3 style="margin-top:20px;">Loading PDF...</h3>';
    sidebar.innerHTML = ''; 
    
    pdfDocument = await pdfjsLib.getDocument(url).promise;
    viewerContainer.innerHTML = ''; 
    extractedDocumentData = []; 
    
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale });

      // 1. 메인 뷰어용 컨테이너 생성
      const pageContainer = document.createElement('div');
      pageContainer.className = 'page pdf-page-container';
      pageContainer.dataset.pageNumber = pageNum;
      pageContainer.style.width = `${viewport.width}px`;
      pageContainer.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      pageContainer.appendChild(canvas);

      (async () => {
        try {
          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';

          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;

          // PDF.js TextLayer는 내부적으로 --scale-factor 변수를 사용하여 폰트 크기를 결정합니다.
          textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
          pageContainer.style.setProperty('--scale-factor', viewport.scale);
          pageContainer.style.setProperty('--total-scale-factor', viewport.scale);

          pageContainer.appendChild(textLayerDiv);

          const textContent = await page.getTextContent();


          if (pdfjsLib.TextLayer) {
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport: viewport
            });
            await textLayer.render();
            console.log(`Page ${pageNum} text layer rendered via TextLayer class.`);
          } else if (pdfjsLib.renderTextLayer) {
            await pdfjsLib.renderTextLayer({
              textContent: textContent,
              container: textLayerDiv,
              viewport: viewport,
              textDivs: []
            }).promise;
          }
        } catch (e) {
          console.error(`Page ${pageNum} text layer failed:`, e);
        }
      })();

      viewerContainer.appendChild(pageContainer);

      const thumbScale = 160 / viewport.width; 
      const thumbViewport = page.getViewport({ scale: thumbScale });
      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'thumbnail-container';
      thumbContainer.dataset.pageNumber = pageNum;
      if (pageNum === 1) thumbContainer.classList.add('active');
      
      const thumbWrapper = document.createElement('div');
      thumbWrapper.className = 'thumbnail-wrapper';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'thumbnail-canvas';
      thumbCanvas.width = thumbViewport.width;
      thumbCanvas.height = thumbViewport.height;
      await page.render({ canvasContext: thumbCanvas.getContext('2d'), viewport: thumbViewport }).promise;
      
      const thumbLabel = document.createElement('div');
      thumbLabel.className = 'thumbnail-label';
      thumbLabel.textContent = `${pageNum} / ${pdfDocument.numPages}`;
      
      thumbWrapper.appendChild(thumbCanvas);
      thumbContainer.appendChild(thumbWrapper);
      thumbContainer.appendChild(thumbLabel);
      
      thumbContainer.addEventListener('click', () => { 
        pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateActiveThumbnail(pageNum);
      });
      sidebar.appendChild(thumbContainer);

      const pageData = await extractTextWithCoords(page, pageNum);
      extractedDocumentData.push(...pageData);
    }

    
    const pdfData = await pdfDocument.getData();
    let binary = '';
    for (let i = 0; i < pdfData.byteLength; i++) { binary += String.fromCharCode(pdfData[i]); }
    globalPdfBase64 = window.btoa(binary);


    buildSearchIndex();

  } catch (error) {
    console.error('PDF 로드 실패:', error);
  }
}


function buildSearchIndex() {
  normalizedFullText = "";
  charToItemMap = [];

  extractedDocumentData.forEach(item => {
  
    let itemText = item.text;
    if (itemText.trim().endsWith('-')) {
      itemText = itemText.trim().slice(0, -1);
    }

    const normalizedItemText = itemText
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]/g, '');

    for (let i = 0; i < normalizedItemText.length; i++) {
      normalizedFullText += normalizedItemText[i];
      charToItemMap.push(item);
    }
  });
  console.log("Search Index built. Length:", normalizedFullText.length);
}

function drawExactHighlight(sourceText) {
  if (!sourceText) return;
  
  // Normalize target text: Remove hyphens that might have been part of line-breaks in the source
  const target = sourceText
    .replace(/(\w)-\s+(\w)/g, '$1$2') 
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
    
  if (!target) return;

  let startIndex = normalizedFullText.indexOf(target);
  let matchLength = target.length;

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
    alert("Could not locate the highlight position. (Source text mismatch)");
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

  Object.keys(itemsByPage).forEach((pageNum, index) => {
    const pageContainer = document.querySelector(`.pdf-page-container[data-page-number="${pageNum}"]`);
    if(!pageContainer) return;
    pdfDocument.getPage(Number(pageNum)).then(page => {
      const viewport = page.getViewport({ scale: scale });
      itemsByPage[pageNum].forEach((item, itemIdx) => {
        const rect = viewport.convertToViewportRectangle(item.coords);
        const highlight = document.createElement('div');
        highlight.className = 'highlight-box';
        highlight.style.left = `${rect[0]}px`;
        highlight.style.top = `${Math.min(rect[1], rect[3])}px`;
        highlight.style.width = `${Math.abs(rect[2] - rect[0])}px`;
        highlight.style.height = `${Math.abs(rect[3] - rect[1])}px`;
        highlight.style.backgroundColor = 'rgba(255, 235, 59, 0.5)';
        pageContainer.appendChild(highlight);

        if (index === 0 && itemIdx === 0) {
          highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        setTimeout(() => highlight.remove(), 3000);
      });
    });
  });
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'HIGHLIGHT_EXACT_TEXT') {
    drawExactHighlight(request.text);
  }
  
  if (request.action === 'GET_DOCUMENT_DATA') {
    const optimizedData = mergeTextBlocks(extractedDocumentData);
    let fileName = "Unknown Document";
    try {
      if (window.fileUrl) {
        const url = new URL(window.fileUrl);
        fileName = decodeURIComponent(url.pathname.split('/').pop());
      }
    } catch (e) {}
    sendResponse({ 
      data: optimizedData,
      fileName: fileName
    });
  }

  if (request.action === 'GET_PDF_FILE') {
    sendResponse({ base64: globalPdfBase64 });
  }
});

const urlParams = new URLSearchParams(window.location.search);
window.fileUrl = urlParams.get('file'); 
if (window.fileUrl) {
  renderPDF(window.fileUrl);
} else {
  viewerContainer.innerHTML = '<h3 style="color:red; margin-top:20px;">PDF path not found.</h3>';
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

// Update active thumbnail based on scroll position
viewerContainer.addEventListener('scroll', () => {
  const pages = document.querySelectorAll('.pdf-page-container');
  let currentPage = 1;
  pages.forEach(page => {
    const rect = page.getBoundingClientRect();
    if (rect.top < window.innerHeight / 2 && rect.bottom > window.innerHeight / 2) {
      currentPage = parseInt(page.dataset.pageNumber);
    }
  });
  updateActiveThumbnail(currentPage);
}, { passive: true });

function updateActiveThumbnail(pageNum) {
  document.querySelectorAll('.thumbnail-container').forEach(thumb => {
    thumb.classList.toggle('active', parseInt(thumb.dataset.pageNumber) === pageNum);
  });
}
