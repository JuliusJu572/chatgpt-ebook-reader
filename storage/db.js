/**
 * 存储层封装
 * - EbookDB: 通过 service worker 中介访问 IndexedDB（解决 content script origin 隔离问题）
 * - Settings: chrome.storage.local 直接访问（所有上下文共享）
 * - ReadingProgress: chrome.storage.local 直接访问
 */

console.log('[eBook Reader] db.js 加载中...');

const EbookDB = (() => {
  const DB_NAME = 'chatgpt-ebook-reader';
  const DB_VERSION = 1;
  const STORE_NAME = 'ebooks';
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk

  // 判断当前是否在扩展 origin（popup / service worker 可直接访问 IndexedDB）
  function isExtensionContext() {
    return !!(chrome.runtime && chrome.runtime.getURL &&
      location.origin === new URL(chrome.runtime.getURL('')).origin);
  }

  // ===== 直接 IndexedDB 访问（popup / service worker） =====
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

  async function directSave(book) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(book);
      tx.oncomplete = () => resolve(book.id);
      tx.onerror = (e) => reject(e.target.error || new Error('IndexedDB 写入失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
  }

  async function directGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error || new Error('IndexedDB 读取失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
  }

  async function directGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const books = (request.result || []).map(b => ({
          id: b.id, title: b.title, fileName: b.fileName,
          totalPages: b.totalPages, totalChars: b.totalChars, uploadedAt: b.uploadedAt
        }));
        resolve(books);
      };
      request.onerror = (e) => reject(e.target.error || new Error('IndexedDB 读取失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
  }

  async function directDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error || new Error('IndexedDB 删除失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
  }

  // ===== 分块传输（content script 通过 port 获取大数据） =====
  function getBookChunked(bookId) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'book-transfer' });
      const chunks = [];
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') {
          chunks.push(msg.data);
        } else if (msg.type === 'DONE') {
          port.disconnect();
          try {
            const json = chunks.join('');
            resolve(JSON.parse(json));
          } catch (e) {
            reject(new Error('分块数据解析失败'));
          }
        } else if (msg.type === 'ERROR') {
          port.disconnect();
          reject(new Error(msg.error));
        }
      });
      port.onDisconnect.addListener(() => {
        if (chunks.length === 0) reject(new Error('连接断开'));
      });
      port.postMessage({ type: 'GET_BOOK', bookId });
    });
  }

  function sendMsg(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ===== 公共 API =====
  async function saveBook(book) {
    book.id = book.id || `book_${Date.now()}`;
    book.uploadedAt = book.uploadedAt || new Date().toISOString();
    if (isExtensionContext()) {
      await directSave(book);
      return book.id;
    }
    // content script: 分块发送保存
    const json = JSON.stringify(book);
    if (json.length < CHUNK_SIZE) {
      const resp = await sendMsg({ type: 'DB_SAVE_BOOK', book });
      if (!resp.success) throw new Error(resp.error);
      return resp.bookId;
    }
    return saveBookChunked(book, json);
  }

  function saveBookChunked(book, json) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'book-save' });
      port.onMessage.addListener((msg) => {
        if (msg.type === 'SAVE_OK') {
          port.disconnect();
          resolve(msg.bookId);
        } else if (msg.type === 'ERROR') {
          port.disconnect();
          reject(new Error(msg.error));
        }
      });
      port.onDisconnect.addListener(() => {
        reject(new Error('保存连接断开'));
      });
      // 发送元数据
      port.postMessage({ type: 'SAVE_START', id: book.id });
      // 分块发送
      for (let i = 0; i < json.length; i += CHUNK_SIZE) {
        port.postMessage({ type: 'CHUNK', data: json.slice(i, i + CHUNK_SIZE) });
      }
      port.postMessage({ type: 'SAVE_END' });
    });
  }

  async function getBook(id) {
    if (isExtensionContext()) {
      return directGet(id);
    }
    // content script: 使用分块传输获取大文件
    return getBookChunked(id);
  }

  async function getAllBooks() {
    if (isExtensionContext()) {
      return directGetAll();
    }
    const resp = await sendMsg({ type: 'DB_GET_ALL_BOOKS' });
    return resp.success ? resp.books : [];
  }

  async function deleteBook(id) {
    if (isExtensionContext()) {
      return directDelete(id);
    }
    const resp = await sendMsg({ type: 'DB_DELETE_BOOK', bookId: id });
    if (!resp.success) throw new Error(resp.error);
  }

  return { saveBook, getBook, getAllBooks, deleteBook };
})();

// 设置和进度管理
const Settings = (() => {
  const DEFAULTS = {
    charsPerPage: 2000,
    pagesPerBatch: 10,
    enabled: true,
    shortcuts: ShortcutUtils.getDefaultShortcuts()
  };

  async function get() {
    return new Promise((resolve) => {
      chrome.storage.local.get('settings', (result) => {
        resolve({ ...DEFAULTS, ...result.settings });
      });
    });
  }

  async function set(settings) {
    const current = await get();
    const merged = { ...current, ...settings };
    return new Promise((resolve) => {
      chrome.storage.local.set({ settings: merged }, resolve);
    });
  }

  return { get, set, DEFAULTS };
})();

const ReadingProgress = (() => {
  async function get() {
    return new Promise((resolve) => {
      chrome.storage.local.get('readingProgress', (result) => {
        resolve(result.readingProgress || null);
      });
    });
  }

  async function set(progress) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ readingProgress: progress }, resolve);
    });
  }

  async function clear() {
    return new Promise((resolve) => {
      chrome.storage.local.remove('readingProgress', resolve);
    });
  }

  return { get, set, clear };
})();

// 书签管理（段落级别）
const Bookmarks = (() => {
  function _key(bookId) { return `bookmarks_${bookId}`; }

  async function getAll(bookId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(_key(bookId), (result) => {
        resolve(result[_key(bookId)] || []);
      });
    });
  }

  async function _save(bookId, list) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [_key(bookId)]: list }, resolve);
    });
  }

  function normalizeBookmark(pageIndexOrBookmark, paragraphIndex, preview, locId) {
    if (typeof pageIndexOrBookmark === 'object' && pageIndexOrBookmark !== null) {
      return {
        locId: pageIndexOrBookmark.locId || null,
        pageIndex: pageIndexOrBookmark.pageIndex,
        paragraphIndex: pageIndexOrBookmark.paragraphIndex,
        preview: pageIndexOrBookmark.preview || '',
        createdAt: pageIndexOrBookmark.createdAt
      };
    }
    return {
      locId: locId || null,
      pageIndex: pageIndexOrBookmark,
      paragraphIndex,
      preview: preview || ''
    };
  }

  function sameBookmark(a, b) {
    if (a.locId && b.locId) return a.locId === b.locId;
    return a.pageIndex === b.pageIndex && a.paragraphIndex === b.paragraphIndex;
  }

  function sortBookmarks(list) {
    list.sort((a, b) =>
      (a.pageIndex ?? Number.MAX_SAFE_INTEGER) - (b.pageIndex ?? Number.MAX_SAFE_INTEGER) ||
      (a.paragraphIndex ?? Number.MAX_SAFE_INTEGER) - (b.paragraphIndex ?? Number.MAX_SAFE_INTEGER) ||
      String(a.locId || '').localeCompare(String(b.locId || ''))
    );
  }

  async function add(bookId, pageIndexOrBookmark, paragraphIndex, preview, locId) {
    const bookmark = normalizeBookmark(pageIndexOrBookmark, paragraphIndex, preview, locId);
    const list = await getAll(bookId);
    if (list.some(b => sameBookmark(b, bookmark))) return false;
    list.push({ ...bookmark, createdAt: bookmark.createdAt || new Date().toISOString() });
    sortBookmarks(list);
    await _save(bookId, list);
    return true;
  }

  async function remove(bookId, pageIndexOrBookmark, paragraphIndex) {
    const bookmark = normalizeBookmark(pageIndexOrBookmark, paragraphIndex);
    let list = await getAll(bookId);
    list = list.filter(b => !sameBookmark(b, bookmark));
    await _save(bookId, list);
  }

  async function toggle(bookId, pageIndexOrBookmark, paragraphIndex, preview, locId) {
    const bookmark = normalizeBookmark(pageIndexOrBookmark, paragraphIndex, preview, locId);
    const list = await getAll(bookId);
    const exists = list.some(b => sameBookmark(b, bookmark));
    if (exists) {
      await remove(bookId, bookmark);
      return false; // removed
    } else {
      await add(bookId, bookmark);
      return true; // added
    }
  }

  // 找到当前页面之后的下一个书签（循环）
  async function findNext(bookId, currentPage) {
    const list = await getAll(bookId);
    if (list.length === 0) return null;
    const after = list.find(b => b.pageIndex > currentPage);
    return after || list[0];
  }

  async function removeAll(bookId) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(_key(bookId), resolve);
    });
  }

  async function reindex(bookId, pageIndexByLocId) {
    if (!pageIndexByLocId) return;
    const list = await getAll(bookId);
    let changed = false;
    const next = list.map(bookmark => {
      if (!bookmark.locId || pageIndexByLocId[bookmark.locId] === undefined) return bookmark;
      const pageIndex = pageIndexByLocId[bookmark.locId];
      if (bookmark.pageIndex === pageIndex) return bookmark;
      changed = true;
      return { ...bookmark, pageIndex };
    });
    if (changed) {
      sortBookmarks(next);
      await _save(bookId, next);
    }
  }

  return { getAll, add, remove, toggle, findNext, removeAll, reindex };
})();
