/**
 * 翻页导航逻辑
 */

const Navigator = (() => {
  let currentBook = null;     // 当前加载的书籍数据
  let batchIndex = 0;         // 当前批次索引（从 0 开始）
  let pagesPerBatch = 10;     // 每批页数

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

  function renderCurrent(shouldScroll = true) {
    const data = getCurrentPages();
    if (!data) return false;

    const success = Renderer.renderBatch(
      data.pages,
      data.startPage,
      data.totalPages,
      currentBook.title,
      shouldScroll
    );

    if (success) {
      // 更新指示器
      Indicator.update({
        title: currentBook.title,
        currentPage: data.startPage + 1,
        endPage: data.endPage,
        totalPages: data.totalPages,
        batchIndex: data.batchIndex,
        totalBatches: data.totalBatches
      });

      // 保存进度
      ReadingProgress.set({
        bookId: currentBook.id,
        batchIndex: batchIndex
      });
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
      batchIndex,
      totalBatches: getTotalBatches(),
      bookTitle: currentBook?.title
    };
  }

  return { setBook, setConfig, setBatchIndex, getCurrentPages, renderCurrent, nextBatch, prevBatch, getState };
})();
