/**
 * ChatGPT 聊天区域渲染引擎
 *
 * 策略：注入到 ChatGPT 聊天容器底部（看起来像新消息），同时通过
 * 滚动锁定机制阻止 react-scroll-to-bottom 的自动滚动。
 * 支持段落级书签（悬浮图标点击添加/移除）。
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';
  let _onBookmarkToggle = null; // 书签切换回调

  // ===== DOM 查找 =====

  function findScrollContainer() {
    const selectors = [
      'div[class*="react-scroll-to-bottom"] > div',
      'main .overflow-y-auto',
      'main div[class*="overflow-y-auto"]',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const cs = window.getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
      }
    }
    const main = document.querySelector('main');
    if (!main) return null;
    let best = null, bestH = 0;
    for (const el of main.querySelectorAll('div')) {
      const cs = window.getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10 &&
          el.scrollHeight > bestH) {
        best = el;
        bestH = el.scrollHeight;
      }
    }
    return best;
  }

  function findChatContainer() {
    const sc = findScrollContainer();
    if (sc) {
      return sc.querySelector(':scope > .flex.flex-col')
          || sc.querySelector('.flex.flex-col')
          || sc;
    }
    return document.querySelector('main');
  }

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

  function createBubble(content, pageInfo, pageIndex) {
    const w = document.createElement('div');
    w.className = 'ebook-message-wrapper';

    const h = document.createElement('div');
    h.className = 'ebook-page-header';
    h.textContent = pageInfo;
    w.appendChild(h);

    const c = document.createElement('div');
    c.className = 'ebook-message-content';
    c.innerHTML = markdownToHtml(content);

    // 为每个块级元素添加段落标识和书签图标
    let paraIdx = 0;
    for (const child of Array.from(c.children)) {
      if (child.tagName === 'HR') continue;
      child.classList.add('ebook-para');
      child.dataset.ebookPage = pageIndex;
      child.dataset.ebookPara = paraIdx;
      // 书签图标（hover 时显示）
      const icon = document.createElement('span');
      icon.className = 'ebook-bookmark-icon';
      icon.textContent = '🔖';
      icon.title = '添加书签';
      child.prepend(icon);
      paraIdx++;
    }

    w.appendChild(c);
    return w;
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
      const el = container.querySelector(
        `[data-ebook-page="${bm.pageIndex}"][data-ebook-para="${bm.paragraphIndex}"]`
      );
      if (el) {
        el.classList.add('ebook-bookmarked');
        const icon = el.querySelector('.ebook-bookmark-icon');
        if (icon) icon.title = '移除书签';
      }
    }
  }

  // 滚动到指定书签段落并闪烁高亮
  function scrollToBookmark(pageIndex, paragraphIndex) {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return false;
    const el = container.querySelector(
      `[data-ebook-page="${pageIndex}"][data-ebook-para="${paragraphIndex}"]`
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ebook-bookmark-flash');
    setTimeout(() => el.classList.remove('ebook-bookmark-flash'), 2000);
    return true;
  }

  // ===== 滚动锁定 =====

  function withScrollLock(scrollContainer, fn, afterUnlock) {
    if (!scrollContainer) { fn(); return; }

    const savedTop = scrollContainer.scrollTop;
    let locked = true;

    const unlock = () => { locked = false; cleanup(); };
    scrollContainer.addEventListener('wheel', unlock, { once: true, passive: true });
    scrollContainer.addEventListener('touchmove', unlock, { once: true, passive: true });

    const proto = Element.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop');

    if (desc && desc.set) {
      Object.defineProperty(scrollContainer, 'scrollTop', {
        get() { return desc.get.call(this); },
        set(v) { if (!locked) desc.set.call(this, v); },
        configurable: true,
      });
    }
    const origScrollTo = scrollContainer.scrollTo;
    const origScroll = scrollContainer.scroll;
    scrollContainer.scrollTo = function(...a) { if (!locked) origScrollTo.apply(this, a); };
    scrollContainer.scroll = function(...a) { if (!locked) origScroll.apply(this, a); };

    fn();

    const timer = setTimeout(() => { locked = false; cleanup(); }, 1500);

    function cleanup() {
      clearTimeout(timer);
      if (desc && desc.set) delete scrollContainer.scrollTop;
      scrollContainer.scrollTo = origScrollTo;
      scrollContainer.scroll = origScroll;
      scrollContainer.removeEventListener('wheel', unlock);
      scrollContainer.removeEventListener('touchmove', unlock);
      // afterUnlock: 函数则执行，元素则 scrollIntoView，否则恢复原位
      if (typeof afterUnlock === 'function') {
        afterUnlock();
      } else if (afterUnlock instanceof HTMLElement) {
        try { afterUnlock.scrollIntoView({ behavior: 'instant', block: 'start' }); } catch (_) {}
      } else {
        try { desc.set.call(scrollContainer, savedTop); } catch (_) {}
      }
    }
  }

  // ===== 渲染 =====

  function clearRendered() {
    const el = document.getElementById(CONTAINER_ID);
    if (el) el.remove();
  }

  /**
   * @param {string[]} pages
   * @param {number} startPage
   * @param {number} totalPages
   * @param {string} bookTitle
   * @param {{pageIndex:number, paragraphIndex:number}|null} scrollToTarget - 渲染后滚动到的书签段落
   */
  function renderBatch(pages, startPage, totalPages, bookTitle, scrollToTarget) {
    clearRendered();

    const chatContainer = findChatContainer();
    if (!chatContainer) {
      console.warn('[eBook Reader] 无法找到 ChatGPT 聊天容器');
      return false;
    }

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ebook-reader-section';

    const divider = document.createElement('div');
    divider.className = 'ebook-divider';
    divider.innerHTML = `<span>📖 ${escapeHtml(bookTitle)}</span>`;
    container.appendChild(divider);

    pages.forEach((pageContent, idx) => {
      const pageIndex = startPage + idx;
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
      const pageIdx = parseInt(para.dataset.ebookPage);
      const paraIdx = parseInt(para.dataset.ebookPara);
      // 取纯文本预览（去掉书签 emoji）
      const preview = para.textContent.replace(/^🔖\s*/, '').trim().substring(0, 50);
      _onBookmarkToggle(pageIdx, paraIdx, preview, para);
    });

    // 注入 + 滚动锁定
    const scrollContainer = findScrollContainer();
    const afterUnlock = scrollToTarget
      ? () => {
          const el = container.querySelector(
            `[data-ebook-page="${scrollToTarget.pageIndex}"][data-ebook-para="${scrollToTarget.paragraphIndex}"]`
          );
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.classList.add('ebook-bookmark-flash');
            setTimeout(() => el.classList.remove('ebook-bookmark-flash'), 2000);
          } else {
            container.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        }
      : container; // 默认滚动到内容开头

    withScrollLock(scrollContainer, () => {
      chatContainer.appendChild(container);
    }, afterUnlock);

    return true;
  }

  return {
    renderBatch, clearRendered,
    setBookmarkCallback, applyBookmarks, scrollToBookmark,
    setupObserver() {}, destroyObserver() {}
  };
})();
