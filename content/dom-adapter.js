/**
 * ChatGPT DOM 适配层
 * 集中处理页面结构定位，避免渲染逻辑误插到输入框或布局容器中。
 */

const ChatDomAdapter = (() => {
  const READER_TURN_SELECTOR = '[data-ebook-reader-turn="true"]';

  function findScrollContainer() {
    const selectors = [
      'div[class*="react-scroll-to-bottom"] > div',
      'main .overflow-y-auto',
      'main div[class*="overflow-y-auto"]'
    ];

    let fallback = null;
    for (const sel of selectors) {
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
    const prompt = document.querySelector(
      '#prompt-textarea, [data-testid="composer-root"], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]'
    );
    if (!prompt) return null;
    return prompt.closest('[data-testid="composer-root"]')
      || prompt.closest('form')
      || prompt;
  }

  function findNativeTurns() {
    const main = document.querySelector('main') || document.body;
    const turns = [];
    const seen = new Set();
    const selectors = [
      '[data-testid^="conversation-turn"]',
      'article',
      '[data-message-author-role]'
    ];

    for (const selector of selectors) {
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
    if (node.matches('[data-testid^="conversation-turn"], article')) return node;

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
    const conversation = findConversationContainer();
    if (!readerTurn || !readerTurn.isConnected) {
      return { ok: false, reason: 'reader 未插入页面' };
    }
    if (composer && (readerTurn.contains(composer) || composer.contains(readerTurn))) {
      return { ok: false, reason: 'reader 被插入到输入框区域' };
    }
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
    const scrollContainer = findScrollContainer();
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

  return {
    findScrollContainer,
    findComposer,
    findNativeTurns,
    findLastNativeTurn,
    findConversationContainer,
    validateReaderMount,
    stabilizeScrollToElement
  };
})();
