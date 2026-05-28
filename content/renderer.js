/**
 * ChatGPT 聊天区域渲染引擎
 * 在 ChatGPT 对话界面注入模拟 response 消息气泡
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';
  let observer = null;
  let isRendering = false; // 防止 observer 循环触发

  // 查找 ChatGPT 的聊天消息列表容器
  function findChatContainer() {
    const selectors = [
      '[class*="react-scroll-to-bottom"]',
      'main [role="presentation"]',
      'main .flex.flex-col',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const scrollable = el.querySelector('[class*="react-scroll-to-bottom"]') || el;
        const inner = scrollable.querySelector('.flex.flex-col') || scrollable;
        return inner;
      }
    }

    const main = document.querySelector('main');
    if (main) return main;
    return null;
  }

  // 简易 Markdown → HTML 转换
  function markdownToHtml(text) {
    let html = escapeHtml(text);

    // 标题（必须在行首）
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 粗体和斜体
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 无序列表项
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

    // 有序列表项
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 引用块
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 分隔线
    html = html.replace(/^---$/gm, '<hr>');

    // 段落：将连续非标签行包裹为 <p>
    const lines = html.split('\n');
    const result = [];
    let inParagraph = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        continue;
      }
      // 如果是块级元素，直接输出
      if (/^<(h[1-6]|li|blockquote|hr)/.test(trimmed)) {
        if (inParagraph) { result.push('</p>'); inParagraph = false; }
        result.push(trimmed);
      } else {
        if (!inParagraph) { result.push('<p>'); inParagraph = true; }
        result.push(trimmed);
      }
    }
    if (inParagraph) result.push('</p>');

    return result.join('\n');
  }

  // 创建电子书内容的消息气泡
  function createMessageBubble(content, pageInfo) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ebook-message-wrapper';
    wrapper.setAttribute('data-ebook-reader', 'true');

    // 页码头部
    const header = document.createElement('div');
    header.className = 'ebook-page-header';
    header.textContent = pageInfo;
    wrapper.appendChild(header);

    // 消息内容区域 — 使用 Markdown 渲染
    const contentDiv = document.createElement('div');
    contentDiv.className = 'ebook-message-content markdown-body';
    contentDiv.innerHTML = markdownToHtml(content);

    wrapper.appendChild(contentDiv);
    return wrapper;
  }

  // 清除之前渲染的电子书内容
  function clearRendered() {
    isRendering = true;
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
    isRendering = false;
  }

  // 渲染一批页面到聊天区域
  function renderBatch(pages, startPage, totalPages, bookTitle, shouldScroll = true) {
    isRendering = true;

    // 先移除旧内容
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();

    const chatContainer = findChatContainer();
    if (!chatContainer) {
      console.warn('[eBook Reader] 无法找到 ChatGPT 聊天容器');
      isRendering = false;
      return false;
    }

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ebook-reader-section';

    // 书籍标题分隔线
    const divider = document.createElement('div');
    divider.className = 'ebook-divider';
    divider.innerHTML = `<span>📖 ${escapeHtml(bookTitle)}</span>`;
    container.appendChild(divider);

    // 渲染每一页
    pages.forEach((pageContent, index) => {
      const pageNum = startPage + index + 1;
      const pageInfo = `第 ${pageNum} 页 / 共 ${totalPages} 页`;
      const bubble = createMessageBubble(pageContent, pageInfo);
      container.appendChild(bubble);
    });

    // 底部导航提示
    const footer = document.createElement('div');
    footer.className = 'ebook-nav-hint';
    const endPage = Math.min(startPage + pages.length, totalPages);
    footer.textContent = `显示第 ${startPage + 1}-${endPage} 页 | 使用快捷键翻页`;
    container.appendChild(footer);

    // 插入到聊天容器的最前面（而不是最后面）
    chatContainer.prepend(container);

    // 滚动到内容顶部
    if (shouldScroll) {
      requestAnimationFrame(() => {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // 延迟解除渲染锁，避免 observer 误触发
    setTimeout(() => { isRendering = false; }, 300);

    return true;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 监听 DOM 变化，在 React 重新渲染后保留内容
  function setupObserver(rerenderCallback) {
    if (observer) observer.disconnect();

    const chatContainer = findChatContainer();
    if (!chatContainer) return;

    observer = new MutationObserver(() => {
      // 渲染过程中忽略变化
      if (isRendering) return;

      // 仅在容器确实被移除时才重新渲染
      const ourContainer = document.getElementById(CONTAINER_ID);
      if (!ourContainer && rerenderCallback) {
        setTimeout(() => {
          if (!document.getElementById(CONTAINER_ID)) {
            rerenderCallback();
          }
        }, 500);
      }
    });

    // 只监听直接子节点变化，不监听 subtree（减少误触发）
    observer.observe(chatContainer, { childList: true, subtree: false });
  }

  function destroyObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  return { renderBatch, clearRendered, setupObserver, destroyObserver, findChatContainer };
})();
