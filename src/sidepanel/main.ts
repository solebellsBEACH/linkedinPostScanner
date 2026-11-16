const link = document.getElementById('open-dashboard');
if (link) {
  link.setAttribute('href', chrome.runtime.getURL('dashboard.html#/overview'));
}

console.log('[PR] sidepanel ready');
