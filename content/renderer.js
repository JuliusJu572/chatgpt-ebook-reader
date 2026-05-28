/**
 * ChatGPT 聊天区域渲染引擎
 *
 * 策略：注入到 ChatGPT 聊天容器底部（看起来像新消息），同时通过
 * 滚动锁定机制阻止 react-scroll-to-bottom 的自动滚动。
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';

  // ===== DOM 查找 =====

  // 找到 ChatGPT 的可滚动容器
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
    // 兜底：在 main 内寻找最大的可滚动元素
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

  // 找到消息列表容器（scroll container 的直接子级 flex-col）
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

    // 标题
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

  function createBubble(content, pageInfo) {
    const w = document.createElement('div');
    w.className = 'ebook-message-wrapper';

    const h = document.createElement('div');
    h.className = 'ebook-page-header';
    h.textContent = pageInfo;
    w.appendChild(h);

    const c = document.createElement('div');
    c.className = 'ebook-message-content';
    c.innerHTML = markdownToHtml(content);
    w.appendChild(c);
    return w;
  }

  // ===== 滚动锁定 =====
  // 在内容注入期间冻结滚动位置，防止 react-scroll-to-bottom 自动滚到底部。
  // 用户主动滚动（wheel/touch）时立即解锁。

  function withScrollLock(scrollContainer, fn, scrollTarget) {
    if (!scrollContainer) { fn(); return; }

    const savedTop = scrollContainer.scrollTop;
    let locked = true;

    // 用户主动滚动时立即解锁
    const unlock = () => { locked = false; cleanup(); };
    scrollContainer.addEventListener('wheel', unlock, { once: true, passive: true });
    scrollContainer.addEventListener('touchmove', unlock, { once: true, passive: true });

    // 冻结 scrollTop setter 和 scrollTo/scroll 方法
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

    // 执行注入
    fn();

    // 1.5 秒后自动解锁
    const timer = setTimeout(() => { locked = false; cleanup(); }, 1500);

    function cleanup() {
      clearTimeout(timer);
      if (desc && desc.set) delete scrollContainer.scrollTop;
      scrollContainer.scrollTo = origScrollTo;
      scrollContainer.scroll = origScroll;
      scrollContainer.removeEventListener('wheel', unlock);
      scrollContainer.removeEventListener('touchmove', unlock);
      // 滚动到目标元素顶部（电子书内容开头），否则恢复原位
      if (scrollTarget) {
        try { scrollTarget.scrollIntoView({ behavior: 'instant', block: 'start' }); } catch (_) {}
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

  function renderBatch(pages, startPage, totalPages, bookTitle) {
    clearRendered();

    const chatContainer = findChatContainer();
    if (!chatContainer) {
      console.warn('[eBook Reader] 无法找到 ChatGPT 聊天容器');
      return false;
    }

    // 构建内容
    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ebook-reader-section';

    const divider = document.createElement('div');
    divider.className = 'ebook-divider';
    divider.innerHTML = `<span>📖 ${escapeHtml(bookTitle)}</span>`;
    container.appendChild(divider);

    pages.forEach((pageContent, idx) => {
      const num = startPage + idx + 1;
      container.appendChild(createBubble(pageContent, `第 ${num} 页 / 共 ${totalPages} 页`));
    });

    const footer = document.createElement('div');
    footer.className = 'ebook-nav-hint';
    const endPage = Math.min(startPage + pages.length, totalPages);
    footer.textContent = `显示第 ${startPage + 1}-${endPage} 页 | 使用快捷键翻页`;
    container.appendChild(footer);

    // 在滚动锁定保护下注入到聊天底部，解锁后滚动到内容开头
    const scrollContainer = findScrollContainer();
    withScrollLock(scrollContainer, () => {
      chatContainer.appendChild(container);
    }, container);

    return true;
  }

  function setupObserver() {}
  function destroyObserver() {}

  return { renderBatch, clearRendered, setupObserver, destroyObserver };
})();
