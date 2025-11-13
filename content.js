(function() {
// Prevent duplicate execution
if (window.emailAttachmentHighlighter) {
  console.log('Email attachment highlighter already loaded');
  return;
}
window.emailAttachmentHighlighter = true;

const CONSTANTS = {
  DELAYS: {
    EXPAND_WAIT: 600,
    COLLAPSE_WAIT: 200,
    ROW_PROCESSING: 50,
    FILTER_RESET: 2000,
    INITIAL_START: 1000
  },
  SELECTORS: {
    TABLE_ROW: 'tr.table_row',
    EMAIL_ADDRESS: '.email_address',
    EMAIL_TIME: '.email_time',
    INLAY_INDICATOR: '.inlay-indicator',
    DATE_RANGE: '#dateRange',
    CONTACT_STATUS: '#contactStatus'
  },
  STYLES: {
    ROW_BG: '#FFF3E0',
    ROW_BORDER: '2px solid #FF9800',
    CELL_BG: '#FFE0B2',
    CELL_COLOR: '#E65100'
  },
  INDICATORS: {
    EXPANDED: '▲',
    COLLAPSED: '▼'
  }
};

// Find the correct iframe
function getTargetDocument() {
  // Check if we're already in an iframe
  if (window.self !== window.top) {
    return document;
  }
  
  // Look for iframe containing customer contacts
  const iframes = document.querySelectorAll('iframe');
  for (let iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (iframeDoc && iframeDoc.querySelector('#customerContactsWidgetTable')) {
        return iframeDoc;
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
  
  return document; // Fallback to main document
}

const targetDoc = getTargetDocument();

// State management
const state = {
  processed: new Set(),
  isRunning: false,
  hasRun: false,
  shouldStop: false,
  cache: new Map()
};

// Utility functions
const utils = {
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  safeQuerySelector: (element, selector) => {
    try {
      return element.querySelector(selector);
    } catch (error) {
      console.warn(`Query selector failed: ${selector}`, error);
      return null;
    }
  },
  
  safeQuerySelectorAll: (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (error) {
      console.warn(`Query selector all failed: ${selector}`, error);
      return [];
    }
  },
  
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
};

function resetAndRerun() {
  state.shouldStop = true;
  
  // Clear cache for fresh results
  state.cache.clear();
  
  // Clear highlights in target document only
  targetDoc.querySelectorAll('tr.table_row').forEach(row => {
    row.style.backgroundColor = '';
    row.style.border = '';
    const senderCell = row.querySelector('.email_address');
    if (senderCell) {
      senderCell.style.backgroundColor = '';
      senderCell.style.fontWeight = '';
      senderCell.style.color = '';
    }
    
    // Collapse expanded rows
    const expandButton = row.querySelector('.inlay-indicator');
    if (expandButton && expandButton.textContent.trim() === '▲') {
      expandButton.click();
    }
  });
  
  // Reset state
  state.isRunning = false;
  state.hasRun = false;
  state.shouldStop = false;
  
  setTimeout(() => highlightEmailsWithAttachments(), 1000);
}

async function checkAttachments(row) {
  try {
    const expandButton = utils.safeQuerySelector(row, CONSTANTS.SELECTORS.INLAY_INDICATOR);
    if (!expandButton || state.shouldStop) return false;
    
    const rowId = row.id;
    if (state.cache.has(rowId)) {
      return state.cache.get(rowId);
    }
    
    const wasExpanded = expandButton.textContent.trim() === CONSTANTS.INDICATORS.EXPANDED;
    
    if (!wasExpanded) {
      expandButton.click();
      await utils.sleep(CONSTANTS.DELAYS.EXPAND_WAIT);
      
      if (state.shouldStop) {
        if (expandButton.textContent.trim() === CONSTANTS.INDICATORS.EXPANDED) {
          expandButton.click();
        }
        return false;
      }
      
      const expandedRow = row.nextElementSibling;
      const hasAttachments = expandedRow?.textContent.includes('Attachments:') && 
                            !expandedRow.textContent.includes('No attachments available');
      
      expandButton.click();
      await utils.sleep(CONSTANTS.DELAYS.COLLAPSE_WAIT);
      
      // Cache result
      state.cache.set(rowId, hasAttachments);
      return hasAttachments;
    }
    
    return false;
  } catch (error) {
    console.warn('Error checking attachments:', error);
    return false;
  }
}

function getDateRangeCutoff() {
  const dateRange = targetDoc.getElementById('dateRange');
  if (!dateRange) return null;
  
  const days = parseInt(dateRange.value);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  return cutoffDate.getTime();
}

function isRowInDateRange(row) {
  const cutoff = getDateRangeCutoff();
  if (!cutoff) return true;
  
  const timeCell = row.querySelector('.email_time');
  if (!timeCell) return true;
  
  const timestamp = timeCell.getAttribute('data-timestamp');
  if (!timestamp) return true;
  
  return parseInt(timestamp) >= cutoff;
}

function getContactStatusFilter() {
  const contactStatus = targetDoc.getElementById('contactStatus');
  return contactStatus ? contactStatus.value : '0';
}

function isRowInContactStatus(row) {
  const filter = getContactStatusFilter();
  if (filter === '0') return true;
  
  const statusCell = row.querySelector('[class*="contact_status_"]');
  if (!statusCell) return true;
  
  const className = statusCell.className;
  const statusMatch = className.match(/contact_status_(\d+)/);
  
  return statusMatch && statusMatch[1] === filter;
}

async function highlightEmailsWithAttachments() {
  if (state.isRunning) {
    console.log('Already running, stopping previous execution');
    state.shouldStop = true;
    return;
  }
  
  state.isRunning = true;
  state.hasRun = true;
  state.shouldStop = false;
  
  console.log('Starting attachment search...');
  
  const rows = targetDoc.querySelectorAll('tr.table_row');
  console.log(`Found ${rows.length} rows to process`);
  
  if (rows.length === 0) {
    console.log('No rows found');
    state.isRunning = false;
    return;
  }
  
  let emailCount = 0;
  
  // Process each row with timeout protection
  for (let i = 0; i < rows.length; i++) {
    if (state.shouldStop) break;
    
    const row = rows[i];
    
    // Check if row is within date range and contact status
    if (!isRowInDateRange(row)) {
      console.log('Row outside date range, stopping');
      break;
    }
    
    if (!isRowInContactStatus(row)) {
      continue; // Skip this row but continue processing
    }
    
    const contactIdCell = row.querySelector('.contact_id');
    const senderCell = row.querySelector('.email_address');
    
    // Only process if contact type is Email
    if (contactIdCell && contactIdCell.textContent.includes(': Email') && senderCell) {
      const senderText = senderCell.textContent.trim();
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i;
      
      if (emailRegex.test(senderText)) {
        const expandButton = row.querySelector('.inlay-indicator');
        
        if (expandButton && expandButton.textContent.trim() === '▼') {
          const startTime = Date.now();
          expandButton.click();
          
          // Wait for content to load (check for spinner to disappear)
          let attempts = 0;
          let expandedRow;
          while (attempts < 20) { // Max 4 seconds
            await new Promise(resolve => setTimeout(resolve, 200));
            expandedRow = row.nextElementSibling;
            if (expandedRow && !expandedRow.querySelector('.nautilus-spinner')) {
              break;
            }
            attempts++;
          }
          
          const loadTime = Date.now() - startTime;
          console.log(`Row ${row.id} loaded in ${loadTime}ms, attempts: ${attempts}`);
          
          if (expandedRow) {
            console.log('Expanded content:', expandedRow.innerHTML.substring(0, 200));
            const attachmentLink = expandedRow.querySelector('a[data-widget-id="contact-email-attachment-widget"]');
            console.log('Found attachment link:', !!attachmentLink);
          }
          
          if (expandedRow && expandedRow.querySelector('a[data-widget-id="contact-email-attachment-widget"]')) {
            
            emailCount++;
            row.style.backgroundColor = CONSTANTS.STYLES.ROW_BG;
            row.style.border = CONSTANTS.STYLES.ROW_BORDER;
            senderCell.style.backgroundColor = CONSTANTS.STYLES.CELL_BG;
            senderCell.style.color = CONSTANTS.STYLES.CELL_COLOR;
            senderCell.style.fontWeight = 'bold';
          }
          
          // Delayed collapse after DOM update
          await new Promise(resolve => setTimeout(resolve, 800));
          expandButton.click();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
  }
  
  console.log(`Search completed. Found ${emailCount} emails with attachments.`);
  state.isRunning = false;
}

// Setup event listeners in target document
const dateRange = targetDoc.getElementById('dateRange');
const contactStatus = targetDoc.getElementById('contactStatus');

const resetHandler = utils.debounce(() => resetAndRerun(), 300);

if (dateRange) {
  dateRange.addEventListener('change', resetHandler);
}
if (contactStatus) {
  contactStatus.addEventListener('change', resetHandler);
}



// Global functions for external access
window.clearCache = () => {
  state.cache.clear();
  console.log('Cache cleared');
};

// Initialize
if (!state.hasRun) {
  setTimeout(() => highlightEmailsWithAttachments(), CONSTANTS.DELAYS.INITIAL_START);
}

console.log(`📎 Quick attachment checker loaded (${window.self !== window.top ? 'iframe' : 'main'} context)`);
console.log('Target document:', targetDoc === document ? 'main document' : 'iframe document');

})();