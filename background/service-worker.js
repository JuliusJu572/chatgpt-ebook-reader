/**
 * 后台 Service Worker
 * - 扩展安装初始化
 * - 作为 IndexedDB 数据中介（content script 无法访问扩展 origin 的 IndexedDB）
 * - 消息路由
 */

// ===== IndexedDB 操作（在扩展 origin 中） =====
const DB_NAME = 'chatgpt-ebook-reader';
const DB_VERSION = 1;
const STORE_NAME = 'ebooks';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function dbSaveBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(book);
    tx.oncomplete = () => resolve(book.id);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const books = request.result.map(b => ({
        id: b.id, title: b.title, fileName: b.fileName,
        totalPages: b.totalPages, totalChars: b.totalChars, uploadedAt: b.uploadedAt
      }));
      resolve(books);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function dbDeleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ===== 安装事件 =====
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      settings: {
        charsPerPage: 2000,
        pagesPerBatch: 10,
        enabled: true,
        shortcuts: {
          toggle: { alt: true, shift: true, key: 'e' },
          next: { alt: true, shift: true, key: 'ArrowRight' },
          prev: { alt: true, shift: true, key: 'ArrowLeft' },
          bookmark: { alt: true, shift: true, key: 'b' },
          jumpBookmark: { alt: true, shift: true, key: 'j' }
        }
      }
    });
    console.log('[eBook Reader] 扩展安装完成');
  }
});

// ===== 消息处理 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // 异步 sendResponse
});

async function handleMessage(message, sender) {
  switch (message.type) {
    // ---- 数据库操作（由 popup 和 content script 共用）----
    case 'DB_SAVE_BOOK': {
      const bookId = await dbSaveBook(message.book);
      return { success: true, bookId };
    }
    case 'DB_GET_BOOK': {
      const book = await dbGetBook(message.bookId);
      return book ? { success: true, book } : { success: false, error: '书籍未找到' };
    }
    case 'DB_GET_ALL_BOOKS': {
      const books = await dbGetAllBooks();
      return { success: true, books };
    }
    case 'DB_DELETE_BOOK': {
      await dbDeleteBook(message.bookId);
      return { success: true };
    }

    // ---- 转发消息到 content script ----
    case 'LOAD_BOOK':
    case 'UPDATE_SETTINGS':
    case 'REPARSE_BOOK':
    case 'JUMP_BOOKMARK': {
      return forwardToContentScript(message);
    }

    // ---- content script 请求 ----
    case 'GET_BOOK_FOR_CONTENT': {
      const book = await dbGetBook(message.bookId);
      return book ? { success: true, book } : { success: false, error: '书籍未找到' };
    }

    default:
      return { success: false, error: '未知消息类型' };
  }
}

async function forwardToContentScript(message) {
  const tabs = await chrome.tabs.query({
    url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  });
  if (tabs.length === 0) {
    return { success: false, error: '未找到 ChatGPT 标签页' };
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      resolve(response || { success: false, error: '内容脚本未响应' });
    });
  });
}
