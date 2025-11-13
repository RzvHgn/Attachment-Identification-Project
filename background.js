chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.emailsFound && sender.tab) {
    const count = msg.count || "!";
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#FF8C00" });
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: (emailCount) => {
        const prefix = emailCount > 1 ? `📧${emailCount} ` : "📧 ";
        if (!document.title.includes("📧")) {
          document.title = prefix + document.title;
        }
      },
      args: [count]
    });
  } else if (msg.clearBadge && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" });
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => {
        document.title = document.title.replace(/^📧\d*\s*/, "");
      }
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('paragon')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(() => {});
  }
});