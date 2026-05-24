document.addEventListener('DOMContentLoaded', () => {
  const aiSelector = document.getElementById('ai-selector');

  // 1. 기존에 저장된 설정 불러오기
  chrome.storage.local.get(['selectedAI'], (result) => {
    if (result.selectedAI) {
      aiSelector.value = result.selectedAI;
    }
  });

  // 2. 선택 변경 시 저장하기
  aiSelector.addEventListener('change', (e) => {
    const selectedAI = e.target.value;
    chrome.storage.local.set({ selectedAI: selectedAI }, () => {
      console.log('AI 모델이 변경되었습니다:', selectedAI);
    });
  });
});