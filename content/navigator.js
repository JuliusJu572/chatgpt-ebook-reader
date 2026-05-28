/**
 * 翻页导航逻辑
 */

const Navigator = (() => {
  let currentBook = null;
  let batchIndex = 0;
  let pagesPerBatch = 10;
  let _onRender = null;       // 渲染后回调（用于应用书签高亮）
  let _pendingBookmark = null; // 跳转书签时暂存目标段落

  function setBook(book) {
    currentBook = book;
    batchIndex = 0;
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
      pages: currentBook.pages.slice(start, end),
      startPage: start,
      endPage: end,
      totalPages: currentBook.pages.length,
      batchIndex: batchIndex,
      totalBatches: getTotalBatches()
    };
  }

  function renderCurrent() {
    const data = getCurrentPages();
    if (!data) return false;

    // 取出并清空待跳转书签
    const bookmark = _pendingBookmark;
    _pendingBookmark = null;

    const success = Renderer.renderBatch(
      data.pages,
      data.startPage,
      data.totalPages,
      currentBook.title,
      bookmark // 传给 renderer 用于渲染后滚动
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

      ReadingProgress.set({
        bookId: currentBook.id,
        batchIndex: batchIndex
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
    return renderCurrent();
  }

  function prevBatch() {
    if (!currentBook) return false;
    if (batchIndex <= 0) {
      Indicator.showMessage('已经是第一批了');
      return false;
    }
    batchIndex--;
    return renderCurrent();
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
    return renderCurrent();
  }

  // 跳转到书签所在的页面和段落
  function jumpToBookmark(pageIndex, paragraphIndex) {
    if (!currentBook) return false;
    if (pageIndex < 0 || pageIndex >= currentBook.pages.length) return false;
    const targetBatch = Math.floor(pageIndex / pagesPerBatch);
    _pendingBookmark = { pageIndex, paragraphIndex };
    batchIndex = targetBatch;
    return renderCurrent();
  }

  return {
    setBook, setConfig, setBatchIndex, setOnRender,
    getCurrentPages, renderCurrent,
    nextBatch, prevBatch, getState,
    jumpToBatch, jumpToBookmark
  };
})();
