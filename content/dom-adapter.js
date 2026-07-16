/**
 * DOM 适配层（ChatGPT / 豆包）
 * 根据 hostname 选择对应的 SiteProfile，集中处理页面结构定位，
 * 避免渲染逻辑误插到输入框或布局容器中。
 */

const ChatDomAdapter = (() => {
  const READER_TURN_SELECTOR = '[data-ebook-reader-turn="true"]';

  // ================== SiteProfile 抽象 ==================
  // 每个站点提供：
  //   scrollSelectors: string[] 用于寻找滚动容器的候选选择器
  //   composerSelector: string   输入框相关元素选择器
  //   composerCloseSelectors: string[] 输入框最外层包装选择器
  //   turnSelectors: string[]   原生消息的候选选择器
  //   isMessageNode(el): boolean 判断给定节点是否是消息元素
  //   normalizeTurn(node): Element | null 把命中节点归一化到"整条消息"
  //   findConversationContainer(): Element | null (可选) 自定义会话容器
  //   mountStrategy: 'sibling-after-last-turn' | 'overlay-in-message-list'
  //   overlayHostSelector?: string (mountStrategy 为 overlay 时用)

  const ChatGPTProfile = {
    name: 'chatgpt',
    scrollSelectors: [
      'div[class*="react-scroll-to-bottom"] > div',
      'main .overflow-y-auto',
      'main div[class*="overflow-y-auto"]'
    ],
    composerSelector:
      '#prompt-textarea, [data-testid="composer-root"], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
    composerWrapSelectors: ['[data-testid="composer-root"]', 'form'],
    turnSelectors: [
      '[data-testid^="conversation-turn"]',
      'article',
      '[data-message-author-role]'
    ],
    isTurnMatch(node) {
      return node.matches('[data-testid^="conversation-turn"], article');
    },
    isRenderableTurn(el) {
      return !!el.querySelector('[data-message-author-role]')
        || el.matches('[data-testid^="conversation-turn"], article')
        || !!el.textContent.trim();
    },
    mountStrategy: 'sibling-after-last-turn'
  };

  const DoubaoProfile = {
    name: 'doubao',
    scrollSelectors: [
      '[class*="v_list_scroller"]',
      'main [class*="overflow-y-auto"]'
    ],
    composerSelector: '#input-engine-container textarea, textarea.semi-input-textarea, #input-engine-container',
    composerWrapSelectors: ['#input-engine-container'],
    turnSelectors: [
      '.v_list_row',
      '[data-target-id="message-box-target-id"]'
    ],
    isTurnMatch(node) {
      return node.matches('.v_list_row');
    },
    isRenderableTurn(el) {
      if (!el.matches('.v_list_row')) return false;
      // 跳过虚拟列表首尾占位行（textContent 为空、高度极小）
      if (!el.textContent.trim() && el.offsetHeight < 20) return false;
      return true;
    },
    normalizeTurn(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
      if (node.matches('.v_list_row')) return node;
      const row = node.closest('.v_list_row');
      return row || null;
    },
    findConversationContainer() {
      // 挂载父容器：虚拟列表的 scroller_content（虚拟行与 reader 的公共父）
      return document.querySelector('[class*="v_list_scroller"] .scroller_content')
          || document.querySelector('[class*="message-list-"]');
    },
    mountStrategy: 'append-in-scroller-content',
    // 计算虚拟列表当前的总内容高度：scroll_holder.transform 的 Y 值（大小锚）
    computeVirtualListHeight() {
      const holder = document.querySelector('[class*="v_list_scroller"] .scroll_holder, [data-name="scroll_holder"]');
      if (!holder) return 0;
      const m = getComputedStyle(holder).transform.match(/matrix\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 6) return parts[5] || 0;
      }
      return holder.offsetTop || 0;
    }
  };

  function detectProfile() {
    const host = location.hostname;
    if (host.includes('doubao.com')) return DoubaoProfile;
    return ChatGPTProfile;
  }

  const profile = detectProfile();

  // ================== 通用逻辑 ==================

  function findScrollContainer() {
    let fallback = null;
    for (const sel of profile.scrollSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = window.getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
        if (!fallback && el.clientHeight > 0) fallback = el;
        if (el.scrollHeight > el.clientHeight + 10) return el;
      }
    }

    if (fallback) return fallback;

    const main = document.querySelector('main');
    if (main) {
      let best = null;
      let bestH = 0;
      for (const el of main.querySelectorAll('div')) {
        const cs = window.getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
            el.clientHeight > 0 &&
            el.scrollHeight > bestH) {
          best = el;
          bestH = el.scrollHeight;
        }
      }
      if (best) return best;
    }

    return document.scrollingElement || document.documentElement;
  }

  function findComposer() {
    const prompt = document.querySelector(profile.composerSelector);
    if (!prompt) return null;
    for (const sel of profile.composerWrapSelectors) {
      const wrap = prompt.closest(sel);
      if (wrap) return wrap;
    }
    return prompt;
  }

  function findNativeTurns() {
    const main = document.querySelector('main') || document.body;
    const turns = [];
    const seen = new Set();

    for (const selector of profile.turnSelectors) {
      for (const node of main.querySelectorAll(selector)) {
        const turn = normalizeTurnElement(node);
        if (!turn || seen.has(turn)) continue;
        if (turn.matches(READER_TURN_SELECTOR) || turn.closest(READER_TURN_SELECTOR)) continue;
        if (isComposerRelated(turn)) continue;
        if (!isRenderableTurn(turn)) continue;
        seen.add(turn);
        turns.push(turn);
      }
    }

    return turns.sort((a, b) =>
      a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }

  function normalizeTurnElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

    if (typeof profile.normalizeTurn === 'function') {
      return profile.normalizeTurn(node);
    }

    if (profile.isTurnMatch(node)) return node;

    const testIdTurn = node.closest('[data-testid^="conversation-turn"]');
    if (testIdTurn) return testIdTurn;

    const article = node.closest('article');
    if (article) return article;

    const scrollContainer = findScrollContainer();
    let current = node;
    while (current.parentElement && current.parentElement !== scrollContainer) {
      current = current.parentElement;
      if (current.matches(READER_TURN_SELECTOR)) return null;
    }
    return current === node ? node : current;
  }

  function isComposerRelated(el) {
    const composer = findComposer();
    return !!composer && (composer === el || composer.contains(el) || el.contains(composer));
  }

  function isRenderableTurn(el) {
    if (typeof profile.isRenderableTurn === 'function') {
      return profile.isRenderableTurn(el);
    }
    if (!isVisible(el) && !el.textContent.trim()) return false;
    return !!el.querySelector('[data-message-author-role]')
      || el.matches('[data-testid^="conversation-turn"], article')
      || !!el.textContent.trim();
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
  }

  function findLastNativeTurn() {
    const turns = findNativeTurns();
    return turns.length ? turns[turns.length - 1] : null;
  }

  function findConversationContainer() {
    if (typeof profile.findConversationContainer === 'function') {
      const c = profile.findConversationContainer();
      if (c) return c;
    }

    const turns = findNativeTurns();
    const composer = findComposer();
    const lastTurn = turns.length ? turns[turns.length - 1] : null;

    if (lastTurn?.parentElement && (!composer || !lastTurn.parentElement.contains(composer))) {
      return lastTurn.parentElement;
    }

    if (turns.length > 1) {
      const common = findDeepestCommonAncestor(turns);
      if (common && (!composer || !common.contains(composer))) return common;
    }

    const scrollContainer = findScrollContainer();
    if (scrollContainer && (!composer || !scrollContainer.contains(composer))) {
      return scrollContainer;
    }

    return null;
  }

  function findOverlayHost() {
    // 兼容旧策略（若 profile 仍定义了 overlayHostSelector）
    if (!profile.overlayHostSelector) return null;
    return document.querySelector(profile.overlayHostSelector);
  }

  function findScrollerContent() {
    // 豆包虚拟列表的 scroller_content 容器（挂载父）
    return document.querySelector('[class*="v_list_scroller"] .scroller_content');
  }

  function computeVirtualListHeight() {
    if (typeof profile.computeVirtualListHeight === 'function') {
      return profile.computeVirtualListHeight();
    }
    return 0;
  }

  function findDeepestCommonAncestor(elements) {
    let current = elements[0]?.parentElement || null;
    while (current) {
      if (elements.every(el => current.contains(el))) return current;
      current = current.parentElement;
    }
    return null;
  }

  function validateReaderMount(readerTurn) {
    const composer = findComposer();
    if (!readerTurn || !readerTurn.isConnected) {
      return { ok: false, reason: 'reader 未插入页面' };
    }
    if (composer && (readerTurn.contains(composer) || composer.contains(readerTurn))) {
      return { ok: false, reason: 'reader 被插入到输入框区域' };
    }

    // overlay 策略跳过 conversation container 包含性检查
    if (profile.mountStrategy === 'overlay-in-message-list') {
      return { ok: true };
    }

    // append-in-scroller 策略：只要 reader 在 scroller_content 内即算成功
    if (profile.mountStrategy === 'append-in-scroller-content') {
      const sc = findScrollerContent();
      if (sc && !sc.contains(readerTurn)) {
        return { ok: false, reason: 'reader 不在虚拟滚动容器中' };
      }
      return { ok: true };
    }

    const conversation = findConversationContainer();
    if (conversation && !conversation.contains(readerTurn)) {
      return { ok: false, reason: 'reader 不在消息列表容器中' };
    }
    if (readerTurn.parentElement && composer && readerTurn.parentElement.contains(composer)) {
      return { ok: false, reason: 'reader 父容器包含输入框，挂载层级过高' };
    }
    return { ok: true };
  }

  function stabilizeScrollToElement(element, block = 'start', options = {}) {
    if (!element) return;
    const scrollContainer = resolveScrollContainerFor(element);
    const duration = options.duration ?? 650;
    let cancelled = false;
    const startedAt = performance.now();
    const cancel = () => { cancelled = true; };

    scrollContainer.addEventListener('wheel', cancel, { passive: true });
    scrollContainer.addEventListener('touchmove', cancel, { passive: true });

    const tick = () => {
      if (cancelled) return cleanup();
      setScrollTop(scrollContainer, getTargetScrollTop(scrollContainer, element, block));
      if (performance.now() - startedAt < duration) {
        requestAnimationFrame(tick);
      } else {
        cleanup();
      }
    };

    requestAnimationFrame(tick);

    function cleanup() {
      scrollContainer.removeEventListener('wheel', cancel);
      scrollContainer.removeEventListener('touchmove', cancel);
    }
  }

  // Reader 使用自己的滚动容器（Doubao overlay 场景），此时优先滚动 reader 内部容器
  function resolveScrollContainerFor(element) {
    if (!element) return findScrollContainer();
    const readerScroll = element.closest('.ebook-reader-scroll');
    if (readerScroll) return readerScroll;
    const readerTurn = element.closest(READER_TURN_SELECTOR);
    if (readerTurn) {
      const innerScroll = readerTurn.querySelector('.ebook-reader-scroll');
      if (innerScroll && innerScroll.contains(element)) return innerScroll;
    }
    return findScrollContainer();
  }

  function getTargetScrollTop(scrollContainer, element, block) {
    const containerRect = getScrollContainerRect(scrollContainer);
    const elementRect = element.getBoundingClientRect();
    let top = getScrollTop(scrollContainer) + elementRect.top - containerRect.top;

    if (block === 'center') {
      top -= Math.max(0, (containerRect.height - elementRect.height) / 2);
    } else if (block === 'end') {
      top -= Math.max(0, containerRect.height - elementRect.height - 24);
    }

    return Math.max(0, top);
  }

  function getScrollContainerRect(scrollContainer) {
    if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
      return { top: 0, height: window.innerHeight };
    }
    const rect = scrollContainer.getBoundingClientRect();
    return { top: rect.top, height: scrollContainer.clientHeight };
  }

  function getScrollTop(scrollContainer) {
    return scrollContainer === document.scrollingElement || scrollContainer === document.documentElement
      ? window.scrollY || scrollContainer.scrollTop
      : scrollContainer.scrollTop;
  }

  function setScrollTop(scrollContainer, top) {
    if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
      window.scrollTo({ top, behavior: 'auto' });
    } else {
      scrollContainer.scrollTop = top;
    }
  }

  function getProfile() {
    return profile;
  }

  return {
    findScrollContainer,
    findComposer,
    findNativeTurns,
    findLastNativeTurn,
    findConversationContainer,
    findOverlayHost,
    findScrollerContent,
    computeVirtualListHeight,
    validateReaderMount,
    stabilizeScrollToElement,
    getProfile
  };
})();
