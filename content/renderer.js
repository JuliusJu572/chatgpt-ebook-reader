/**
 * ChatGPT 聊天区域渲染引擎
 * 在 ChatGPT 对话界面注入模拟 response 消息气泡
 */

const Renderer = (() => {
  const CONTAINER_ID = 'ebook-reader-container';
  let observer = null;

  // 查找 ChatGPT 的聊天消息列表容器
  function findChatContainer() {
    // ChatGPT 使用 role="presentation" 的容器包裹对话
    // 尝试多种选择器以提高健壮性
    const selectors = [
      '[class*="react-scroll-to-bottom"]',
      'main [role="presentation"]',
      'main .flex.flex-col',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        // 找到最内层的滚动容器
        const scrollable = el.querySelector('[class*="react-scroll-to-bottom"]') || el;
        const inner = scrollable.querySelector('.flex.flex-col') || scrollable;
        return inner;
      }
    }

    // 最后回退：查找 main 元素内的第一个大容器
    const main = document.querySelector('main');
    if (main) return main;

    return null;
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

    // 消息内容区域
    const contentDiv = document.createElement('div');
    contentDiv.className = 'ebook-message-content';

    // 将文本按段落分割并渲染
    const paragraphs = content.split(/\n\s*\n|\n/);
    paragraphs.forEach(para => {
      const trimmed = para.trim();
      if (!trimmed) return;
      const p = document.createElement('p');
      p.textContent = trimmed;
      contentDiv.appendChild(p);
    });

    wrapper.appendChild(contentDiv);
    return wrapper;
  }

  // 清除之前渲染的电子书内容
  function clearRendered() {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
  }

  // 渲染一批页面到聊天区域
  function renderBatch(pages, startPage, totalPages, bookTitle) {
    clearRendered();

    const chatContainer = findChatContainer();
    if (!chatContainer) {
      console.warn('[eBook Reader] 无法找到 ChatGPT 聊天容器');
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

    chatContainer.appendChild(container);

    // 滚动到底部
    container.scrollIntoView({ behavior: 'smooth', block: 'end' });

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

    observer = new MutationObserver((mutations) => {
      // 检查我们的容器是否被移除
      const ourContainer = document.getElementById(CONTAINER_ID);
      if (!ourContainer && rerenderCallback) {
        // 延迟重新渲染，避免和 React 冲突
        setTimeout(() => rerenderCallback(), 100);
      }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });
  }

  function destroyObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  return { renderBatch, clearRendered, setupObserver, destroyObserver, findChatContainer };
})();
