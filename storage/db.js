/**
 * 存储层封装
 * - EbookDB: 通过 service worker 中介访问 IndexedDB（解决 content script origin 隔离问题）
 * - Settings: chrome.storage.local 直接访问（所有上下文共享）
 * - ReadingProgress: chrome.storage.local 直接访问
 */

const EbookDB = (() => {
  // 所有 IndexedDB 操作通过 service worker 代理
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

  async function saveBook(book) {
    book.id = book.id || `book_${Date.now()}`;
    book.uploadedAt = book.uploadedAt || new Date().toISOString();
    const resp = await sendMsg({ type: 'DB_SAVE_BOOK', book });
    if (!resp.success) throw new Error(resp.error);
    return resp.bookId;
  }

  async function getBook(id) {
    const resp = await sendMsg({ type: 'DB_GET_BOOK', bookId: id });
    return resp.success ? resp.book : null;
  }

  async function getAllBooks() {
    const resp = await sendMsg({ type: 'DB_GET_ALL_BOOKS' });
    return resp.success ? resp.books : [];
  }

  async function deleteBook(id) {
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
    shortcuts: {
      toggle: { alt: true, shift: true, key: 'e' },
      next: { alt: true, shift: true, key: 'ArrowRight' },
      prev: { alt: true, shift: true, key: 'ArrowLeft' }
    }
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
