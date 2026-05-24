document.addEventListener('DOMContentLoaded', () => {
  // 1. 기존에 저장된 API 키 불러오기
  chrome.storage.local.get(['openaiApiKey', 'geminiApiKey'], (result) => {
    if (result.openaiApiKey) {
      document.getElementById('openai-key').value = result.openaiApiKey;
    }
    if (result.geminiApiKey) {
      document.getElementById('gemini-key').value = result.geminiApiKey;
    }
  });

  // 2. 저장 버튼 클릭 시 API 키 저장하기
  document.getElementById('save-btn').addEventListener('click', () => {
    const openaiKey = document.getElementById('openai-key').value.trim();
    const geminiKey = document.getElementById('gemini-key').value.trim();

    chrome.storage.local.set({
      openaiApiKey: openaiKey,
      geminiApiKey: geminiKey
    }, () => {
      // 저장 완료 메시지 표시
      const status = document.getElementById('status');
      status.textContent = '설정이 저장되었습니다.';
      setTimeout(() => {
        status.textContent = '';
      }, 3000); // 3초 후 메시지 사라짐
    });
  });
});