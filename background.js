// background.js 전체 코드
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0 && details.url.toLowerCase().split('?')[0].endsWith('.pdf')) {
    if (!details.url.startsWith('chrome-extension://')) {
      const extensionViewerUrl = chrome.runtime.getURL(`viewer.html?file=${encodeURIComponent(details.url)}`);
      chrome.tabs.update(details.tabId, { url: extensionViewerUrl });
    }
  }
});