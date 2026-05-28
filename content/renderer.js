/**
 * ChatGPT 聊天区域渲染引擎
 * 
 * 核心策略：不往 ChatGPT 的聊天消息容器里注入内容（会触发 react-scroll-to-bottom 的
 * 自动滚动，导致滚动冲突），而是在 <main> 内创建独立的覆盖层，有自己的滚动逻辑。
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';
  const OVERLAY_ID = 'ebook-reader-overlay';

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

    const header = document.createElement('div');
    header.className = 'ebook-page-header';
    header.textContent = pageInfo;
    wrapper.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'ebook-message-content';
    contentDiv.innerHTML = markdownToHtml(content);

    wrapper.appendChild(contentDiv);
    return wrapper;
  }

  // 获取或创建覆盖层（独立于 ChatGPT 的滚动容器）
  function getOrCreateOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    // 找到 <main> 元素作为定位参考
    const main = document.querySelector('main');
    if (!main) return null;

    // 确保 main 有定位上下文
    const mainPosition = window.getComputedStyle(main).position;
    if (mainPosition === 'static') {
      main.style.position = 'relative';
    }

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'ebook-overlay';
    main.appendChild(overlay);

    return overlay;
  }

  // 清除渲染内容并移除覆盖层
  function clearRendered() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  // 渲染一批页面
  function renderBatch(pages, startPage, totalPages, bookTitle) {
    // 移除旧覆盖层
    clearRendered();

    const overlay = getOrCreateOverlay();
    if (!overlay) {
      console.warn('[eBook Reader] 无法找到 main 容器');
      return false;
    }

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ebook-reader-section';

    // 书籍标题
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

    overlay.appendChild(container);

    // 滚动到覆盖层顶部
    overlay.scrollTop = 0;

    return true;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 不再需要 MutationObserver — 覆盖层在 main 内独立存在，不会被 React 移除
  function setupObserver() {}
  function destroyObserver() {}

  return { renderBatch, clearRendered, setupObserver, destroyObserver };
})();
