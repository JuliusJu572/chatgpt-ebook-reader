/**
 * 翻页导航逻辑
 */

const Navigator = (() => {
  let currentBook = null;
  let batchIndex = 0;
  let pagesPerBatch = 10;
  let _onRender = null;       // 渲染后回调（用于应用书签高亮）
  let _pendingScrollTarget = null; // 渲染后滚动目标
  let _segmentMap = new Map();

  function setBook(book) {
    currentBook = book;
    batchIndex = 0;
    _segmentMap = buildSegmentMap(book);
    ensurePageIndexMap(book);
  }

  function setConfig(config) {
    if (config.pagesPerBatch) pagesPerBatch = config.pagesPerBatch;
  }

  function setBatchIndex(index) {
    batchIndex = index;
  }

  function setOnRender(fn) {
    _onRender = fn;
  }

  function getTotalBatches() {
    if (!currentBook) return 0;
    return Math.ceil(currentBook.pages.length / pagesPerBatch);
  }

  function getCurrentPages() {
    if (!currentBook) return null;

    const start = batchIndex * pagesPerBatch;
    const end = Math.min(start + pagesPerBatch, currentBook.pages.length);
    return {
      pages: currentBook.pages.slice(start, end).map(enrichPageForRender),
      startPage: start,
      endPage: end,
      totalPages: currentBook.pages.length,
      batchIndex: batchIndex,
      totalBatches: getTotalBatches()
    };
  }

  function renderCurrent(scrollTarget) {
    const data = getCurrentPages();
    if (!data) return false;

    const target = scrollTarget || _pendingScrollTarget || { type: 'batch-start' };
    _pendingScrollTarget = null;

    const success = Renderer.renderBatch(
      data.pages,
      data.startPage,
      data.totalPages,
      currentBook.title,
      target
    );

    if (success) {
      Indicator.update({
        title: currentBook.title,
        currentPage: data.startPage + 1,
        endPage: data.endPage,
        totalPages: data.totalPages,
        batchIndex: data.batchIndex,
        totalBatches: data.totalBatches
      });

      const progressLocId = getProgressLocId(data, target);
      ReadingProgress.set({
        bookId: currentBook.id,
        batchIndex: batchIndex,
        pageIndex: data.startPage,
        locId: progressLocId,
        updatedAt: new Date().toISOString()
      });

      if (_onRender) _onRender();
    }

    return success;
  }

  function nextBatch() {
    if (!currentBook) return false;
    if (batchIndex >= getTotalBatches() - 1) {
      Indicator.showMessage('已经是最后一批了');
      return false;
    }
    batchIndex++;
    return renderCurrent({ type: 'batch-start' });
  }

  function prevBatch() {
    if (!currentBook) return false;
    if (batchIndex <= 0) {
      Indicator.showMessage('已经是第一批了');
      return false;
    }
    batchIndex--;
    return renderCurrent({ type: 'batch-start' });
  }

  function getState() {
    return {
      hasBook: !!currentBook,
      bookId: currentBook?.id,
      batchIndex,
      totalBatches: getTotalBatches(),
      bookTitle: currentBook?.title
    };
  }

  function jumpToBatch(index) {
    if (!currentBook) return false;
    if (index < 0 || index >= getTotalBatches()) return false;
    batchIndex = index;
    return renderCurrent({ type: 'batch-start' });
  }

  // 跳转到书签所在的页面和段落
  function jumpToBookmark(pageIndex, paragraphIndex, locId) {
    if (!currentBook) return false;
    if (locId) return jumpToLocation(locId);
    if (pageIndex < 0 || pageIndex >= currentBook.pages.length) return false;
    const targetBatch = Math.floor(pageIndex / pagesPerBatch);
    _pendingScrollTarget = { type: 'legacy-bookmark', pageIndex, paragraphIndex };
    batchIndex = targetBatch;
    return renderCurrent();
  }

  function jumpToLocation(locId) {
    if (!currentBook || !locId) return false;
    const pageIndex = findPageIndexForLoc(locId);
    if (pageIndex === -1) return false;
    batchIndex = Math.floor(pageIndex / pagesPerBatch);
    _pendingScrollTarget = { type: 'location', locId };
    return renderCurrent();
  }

  function findPageIndexForLoc(locId) {
    if (!currentBook || !locId) return -1;
    ensurePageIndexMap(currentBook);
    if (currentBook.pageIndexByLocId && currentBook.pageIndexByLocId[locId] !== undefined) {
      return currentBook.pageIndexByLocId[locId];
    }
    for (let i = 0; i < currentBook.pages.length; i++) {
      const page = currentBook.pages[i];
      if (page && typeof page === 'object' && Array.isArray(page.segmentRefs) && page.segmentRefs.includes(locId)) {
        return page.pageIndex ?? i;
      }
    }
    return -1;
  }

  function enrichPageForRender(page) {
    if (!page || typeof page !== 'object') return page;
    if (Array.isArray(page.segments) && page.segments.length > 0) return page;
    if (!Array.isArray(page.segmentRefs)) return page;
    return {
      ...page,
      segments: page.segmentRefs.map(locId => _segmentMap.get(locId)).filter(Boolean)
    };
  }

  function buildSegmentMap(book) {
    const map = new Map();
    if (!book || !Array.isArray(book.segments)) return map;
    book.segments.forEach(segment => {
      if (segment.locId) map.set(segment.locId, segment);
    });
    return map;
  }

  function ensurePageIndexMap(book) {
    if (!book || book.pageIndexByLocId || !Array.isArray(book.pages)) return;
    const pageIndexByLocId = {};
    book.pages.forEach((page, index) => {
      if (!page || typeof page !== 'object' || !Array.isArray(page.segmentRefs)) return;
      page.segmentRefs.forEach(locId => {
        pageIndexByLocId[locId] = page.pageIndex ?? index;
      });
    });
    book.pageIndexByLocId = pageIndexByLocId;
  }

  function getProgressLocId(data, target) {
    if (target && target.locId) return target.locId;
    const firstPage = data.pages[0];
    if (firstPage && typeof firstPage === 'object') {
      if (firstPage.startLocId) return firstPage.startLocId;
      if (Array.isArray(firstPage.segmentRefs)) return firstPage.segmentRefs[0] || null;
    }
    return null;
  }

  return {
    setBook, setConfig, setBatchIndex, setOnRender,
    getCurrentPages, renderCurrent,
    nextBatch, prevBatch, getState,
    jumpToBatch, jumpToBookmark, jumpToLocation, findPageIndexForLoc
  };
})();
