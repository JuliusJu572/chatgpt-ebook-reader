/**
 * ChatGPT 聊天区域渲染引擎
 *
 * 策略：生成阅读内容，由 ReaderMountManager 负责挂载到最后一条原生消息后。
 * 支持段落级书签（悬浮图标点击添加/移除）。
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';
  let _onBookmarkToggle = null; // 书签切换回调

  // ===== Markdown → HTML =====

  function markdownToHtml(text) {
    let html = escapeHtml(text);

    // 标题（从 h6 到 h1 避免 ## 被 # 先匹配）
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 粗体、斜体
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 分隔线
    html = html.replace(/^---$/gm, '<hr>');

    // 段落包裹
    const lines = html.split('\n');
    const result = [];
    let inP = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        if (inP) { result.push('</p>'); inP = false; }
        continue;
      }
      if (/^<(h[1-6]|li|blockquote|hr)/.test(t)) {
        if (inP) { result.push('</p>'); inP = false; }
        result.push(t);
      } else {
        if (!inP) { result.push('<p>'); inP = true; }
        result.push(t);
      }
    }
    if (inP) result.push('</p>');
    return result.join('\n');
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  // ===== 消息气泡 =====

  function createBubble(page, pageInfo, pageIndex) {
    const w = document.createElement('div');
    w.className = 'ebook-message-wrapper';

    const h = document.createElement('div');
    h.className = 'ebook-page-header';
    h.textContent = pageInfo;
    w.appendChild(h);

    const c = document.createElement('div');
    c.className = 'ebook-message-content';

    const segments = getPageSegments(page);
    if (segments.length > 0) {
      segments.forEach((segment, idx) => {
        const child = createSegmentElement(segment, pageIndex, idx);
        c.appendChild(child);
      });
    } else {
      c.innerHTML = markdownToHtml(getPageText(page));

      // 为每个块级元素添加段落标识和书签图标（旧书兼容）
      let paraIdx = 0;
      for (const child of Array.from(c.children)) {
        if (child.tagName === 'HR') continue;
        decorateParagraph(child, pageIndex, paraIdx, null, paraIdx);
        paraIdx++;
      }
    }

    w.appendChild(c);
    return w;
  }

  function getPageSegments(page) {
    if (page && typeof page === 'object' && Array.isArray(page.segments)) {
      return page.segments;
    }
    return [];
  }

  function getPageText(page) {
    if (typeof page === 'string') return page;
    if (page && typeof page.text === 'string') return page.text;
    return '';
  }

  function createSegmentElement(segment, pageIndex, segmentIndex) {
    if (segment.kind === 'separator') {
      const hr = document.createElement('hr');
      if (segment.locId) hr.dataset.ebookLocId = segment.locId;
      return hr;
    }

    const tag = getSegmentTag(segment);
    const el = document.createElement(tag);
    el.textContent = segment.text || '';
    decorateParagraph(el, pageIndex, segment.paragraphIndexInSpine ?? segmentIndex, segment.locId, segmentIndex);
    return el;
  }

  function getSegmentTag(segment) {
    if (segment.kind === 'heading') {
      const level = Math.min(Math.max(segment.level || 3, 1), 6);
      return `h${level}`;
    }
    if (segment.kind === 'listItem') return 'li';
    if (segment.kind === 'blockquote') return 'blockquote';
    return 'p';
  }

  function decorateParagraph(child, pageIndex, paragraphIndex, locId, segmentIndex) {
    child.classList.add('ebook-para');
    child.dataset.ebookPage = pageIndex;
    child.dataset.ebookPara = paragraphIndex;
    child.dataset.ebookSegmentIndex = segmentIndex;
    if (locId) child.dataset.ebookLocId = locId;

    const icon = document.createElement('span');
    icon.className = 'ebook-bookmark-icon';
    icon.textContent = '🔖';
    icon.title = '添加书签';
    child.prepend(icon);
  }

  // ===== 书签 =====

  function setBookmarkCallback(fn) {
    _onBookmarkToggle = fn;
  }

  // 高亮已有书签的段落
  function applyBookmarks(bookmarks) {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    // 清除旧的高亮
    container.querySelectorAll('.ebook-bookmarked').forEach(el => {
      el.classList.remove('ebook-bookmarked');
      const icon = el.querySelector('.ebook-bookmark-icon');
      if (icon) icon.title = '添加书签';
    });
    // 应用书签
    for (const bm of bookmarks) {
      const el = findBookmarkElement(container, bm);
      if (el) {
        el.classList.add('ebook-bookmarked');
        const icon = el.querySelector('.ebook-bookmark-icon');
        if (icon) icon.title = '移除书签';
      }
    }
  }

  // 滚动到指定书签段落并闪烁高亮
  function scrollToBookmark(pageIndex, paragraphIndex, locId) {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return false;
    const el = locId
      ? findLocElement(container, locId)
      : container.querySelector(`[data-ebook-page="${pageIndex}"][data-ebook-para="${paragraphIndex}"]`);
    if (!el) return false;
    scrollElementIntoReaderView(el, 'center');
    el.classList.add('ebook-bookmark-flash');
    setTimeout(() => el.classList.remove('ebook-bookmark-flash'), 2000);
    return true;
  }

  function findBookmarkElement(container, bookmark) {
    if (bookmark.locId) {
      const byLoc = findLocElement(container, bookmark.locId);
      if (byLoc) return byLoc;
    }
    if (bookmark.pageIndex === undefined || bookmark.paragraphIndex === undefined) return null;
    return container.querySelector(
      `[data-ebook-page="${bookmark.pageIndex}"][data-ebook-para="${bookmark.paragraphIndex}"]`
    );
  }

  function findLocElement(container, locId) {
    return container.querySelector(`[data-ebook-loc-id="${escapeSelectorValue(locId)}"]`);
  }

  function escapeSelectorValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // ===== 滚动锁定 =====

  function scrollElementIntoReaderView(element, block = 'start') {
    ChatDomAdapter.stabilizeScrollToElement(element, block, { duration: 120 });
  }

  function stabilizeScrollToTarget(container, scrollTarget) {
    const target = resolveScrollTarget(container, scrollTarget);
    if (!target) return;

    ChatDomAdapter.stabilizeScrollToElement(target.element, target.block || 'start', { duration: 650 });
    setTimeout(() => flashTarget(target), 650);
  }

  function resolveScrollTarget(container, scrollTarget) {
    const target = normalizeScrollTarget(scrollTarget);
    let element = null;
    let block = 'start';

    if (target.locId) {
      element = findLocElement(container, target.locId);
      block = 'center';
    } else if (target.pageIndex !== undefined && target.paragraphIndex !== undefined) {
      element = container.querySelector(
        `[data-ebook-page="${target.pageIndex}"][data-ebook-para="${target.paragraphIndex}"]`
      );
      block = 'center';
    }

    if (!element) {
      element = container;
      block = 'start';
    }

    return { element, block, shouldFlash: !!target.locId || target.paragraphIndex !== undefined };
  }

  function normalizeScrollTarget(scrollTarget) {
    if (!scrollTarget) return { type: 'batch-start' };
    if (scrollTarget.type === 'location') return { locId: scrollTarget.locId };
    if (scrollTarget.type === 'legacy-bookmark') {
      return { pageIndex: scrollTarget.pageIndex, paragraphIndex: scrollTarget.paragraphIndex };
    }
    if (scrollTarget.locId) return { locId: scrollTarget.locId };
    return scrollTarget;
  }

  function flashTarget(target) {
    if (!target.shouldFlash || !target.element.classList.contains('ebook-para')) return;
    target.element.classList.add('ebook-bookmark-flash');
    setTimeout(() => target.element.classList.remove('ebook-bookmark-flash'), 2000);
  }

  // ===== 渲染 =====

  function clearRendered(options) {
    ReaderMountManager.clear(options);
  }

  /**
   * @param {string[]} pages
   * @param {number} startPage
   * @param {number} totalPages
   * @param {string} bookTitle
   * @param {{pageIndex:number, paragraphIndex:number}|null} scrollToTarget - 渲染后滚动到的书签段落
   */
  function renderBatch(pages, startPage, totalPages, bookTitle, scrollToTarget) {
    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ebook-reader-section';

    const divider = document.createElement('div');
    divider.className = 'ebook-divider';
    divider.innerHTML = `<span>📖 ${escapeHtml(bookTitle)}</span>`;
    container.appendChild(divider);

    pages.forEach((pageContent, idx) => {
      const pageIndex = getPageIndex(pageContent, startPage + idx);
      container.appendChild(
        createBubble(pageContent, `第 ${pageIndex + 1} 页 / 共 ${totalPages} 页`, pageIndex)
      );
    });

    const footer = document.createElement('div');
    footer.className = 'ebook-nav-hint';
    const endPage = Math.min(startPage + pages.length, totalPages);
    footer.textContent = `显示第 ${startPage + 1}-${endPage} 页 | 使用快捷键翻页`;
    container.appendChild(footer);

    // 书签图标点击事件（事件委托）
    container.addEventListener('click', (e) => {
      const icon = e.target.closest('.ebook-bookmark-icon');
      if (!icon) return;
      e.preventDefault();
      e.stopPropagation();
      const para = icon.closest('.ebook-para');
      if (!para || !_onBookmarkToggle) return;
      const pageIdx = parseInt(para.dataset.ebookPage, 10);
      const paraIdx = parseInt(para.dataset.ebookPara, 10);
      const locId = para.dataset.ebookLocId || null;
      // 取纯文本预览（去掉书签 emoji）
      const preview = para.textContent.replace(/^🔖\s*/, '').trim().substring(0, 50);
      _onBookmarkToggle(pageIdx, paraIdx, preview, para, locId);
    });

    const mounted = ReaderMountManager.mount(container);
    if (!mounted.success) {
      Indicator.showMessage(`⚠️ ${mounted.error || '阅读器挂载失败'}`);
      return false;
    }

    assertLocationRenderCount(container, pages);
    stabilizeScrollToTarget(container, scrollToTarget || { type: 'batch-start' });

    return true;
  }

  function getPageIndex(page, fallback) {
    return page && typeof page === 'object' && Number.isInteger(page.pageIndex)
      ? page.pageIndex
      : fallback;
  }

  function assertLocationRenderCount(container, pages) {
    const expected = pages.reduce((sum, page) => {
      if (!page || typeof page !== 'object') return sum;
      if (Array.isArray(page.segments)) return sum + page.segments.filter(segment => segment.kind !== 'separator').length;
      return sum;
    }, 0);
    if (!expected) return;

    const actual = container.querySelectorAll('[data-ebook-loc-id].ebook-para').length;
    if (actual !== expected) {
      console.warn('[eBook Reader] 段落定位渲染数量不一致', { expected, actual });
    }
  }

  return {
    renderBatch, clearRendered,
    setBookmarkCallback, applyBookmarks, scrollToBookmark,
    setupObserver() {}, destroyObserver() {}
  };
})();
