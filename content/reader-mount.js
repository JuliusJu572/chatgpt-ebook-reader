/**
 * 阅读器挂载管理
 * ChatGPT: 作为独立消息插入到最后一条原生消息之后（sibling-after-last-turn）。
 * 豆包    : 作为普通流子元素插入到虚拟列表滚动容器 .scroller_content 中，
 *          位于所有虚拟消息行之后（append-in-scroller-content），
 *          通过 margin-top 让 reader 出现在虚拟消息高度之下，
 *          用户在同一个滚动区往上滑即可看到历史消息。
 */

const ReaderMountManager = (() => {
  const TURN_ID = 'ebook-reader-turn';
  const TURN_ATTR = 'data-ebook-reader-turn';
  const HIDE_CLASS = 'ebook-reader-native-hidden';
  const OFFSET_VAR = '--ebook-doubao-virtual-height';

  let virtualHeightObserver = null;

  function getTurn() {
    return document.getElementById(TURN_ID);
  }

  function getProfile() {
    return (typeof ChatDomAdapter.getProfile === 'function')
      ? ChatDomAdapter.getProfile()
      : { mountStrategy: 'sibling-after-last-turn' };
  }

  function mount(contentElement) {
    const profile = getProfile();
    const strategy = profile.mountStrategy || 'sibling-after-last-turn';

    let turn = getTurn();
    if (!turn) {
      turn = document.createElement('div');
      turn.id = TURN_ID;
      turn.className = 'ebook-reader-turn';
      turn.setAttribute(TURN_ATTR, 'true');
      turn.dataset.ebookMountStrategy = strategy;
      if (strategy === 'overlay-in-message-list') {
        turn.classList.add('ebook-reader-turn--overlay', 'ebook-reader-scroll');
      } else if (strategy === 'append-in-scroller-content') {
        turn.classList.add('ebook-reader-turn--doubao-inline');
      }

      const attached = attachTurn(turn, strategy);
      if (!attached) {
        console.warn('[eBook Reader] 无法定位消息列表，阅读器未挂载');
        return { success: false, error: '无法定位消息列表' };
      }
    } else if (strategy === 'sibling-after-last-turn') {
      const lastTurn = ChatDomAdapter.findLastNativeTurn();
      if (lastTurn?.parentElement && turn.previousElementSibling !== lastTurn) {
        lastTurn.after(turn);
      }
    } else if (strategy === 'append-in-scroller-content') {
      // 保持位于 list_items 之后
      const sc = ChatDomAdapter.findScrollerContent();
      if (sc && turn.parentElement !== sc) sc.appendChild(turn);
    }

    turn.replaceChildren(contentElement);

    if (strategy === 'overlay-in-message-list') {
      applyOverlayHostState(true);
    } else if (strategy === 'append-in-scroller-content') {
      syncDoubaoVirtualOffset(turn);
      ensureVirtualHeightObserver(turn);
    }

    const validation = ChatDomAdapter.validateReaderMount(turn);
    if (!validation.ok) {
      turn.remove();
      if (strategy === 'overlay-in-message-list') applyOverlayHostState(false);
      teardownVirtualHeightObserver();
      console.warn('[eBook Reader] 阅读器挂载失败:', validation.reason);
      return { success: false, error: validation.reason };
    }

    return { success: true, turn, content: contentElement };
  }

  function attachTurn(turn, strategy) {
    if (strategy === 'overlay-in-message-list') {
      const host = ChatDomAdapter.findOverlayHost();
      if (!host) return false;
      host.appendChild(turn);
      return true;
    }

    if (strategy === 'append-in-scroller-content') {
      const scrollerContent = ChatDomAdapter.findScrollerContent();
      if (!scrollerContent) return false;
      scrollerContent.appendChild(turn);
      return true;
    }

    const lastTurn = ChatDomAdapter.findLastNativeTurn();
    const conversation = ChatDomAdapter.findConversationContainer();
    if (lastTurn?.parentElement) {
      lastTurn.after(turn);
      return true;
    }
    if (conversation) {
      conversation.appendChild(turn);
      return true;
    }
    return false;
  }

  function applyOverlayHostState(hide) {
    const host = ChatDomAdapter.findOverlayHost();
    if (!host) return;
    host.querySelectorAll(':scope > [class*="v_list-"]').forEach(el => {
      if (hide) el.classList.add(HIDE_CLASS);
      else el.classList.remove(HIDE_CLASS);
    });
  }

  function syncDoubaoVirtualOffset(turn) {
    if (!turn) return;
    const h = ChatDomAdapter.computeVirtualListHeight();
    // 用一个 spacer 兄弟节点占位，避免 margin 与 .scroller_content 合并塌陷。
    let spacer = turn.previousElementSibling;
    if (!spacer || !spacer.classList?.contains('ebook-reader-doubao-spacer')) {
      spacer = document.createElement('div');
      spacer.className = 'ebook-reader-doubao-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      turn.parentElement?.insertBefore(spacer, turn);
    }
    spacer.style.height = `${Math.max(0, h)}px`;
    // margin-top 保留为兼容旧路径，实际由 spacer 占位
    turn.style.marginTop = '0px';
    turn.style.setProperty(OFFSET_VAR, `${Math.max(0, h)}px`);
  }

  function ensureVirtualHeightObserver(turn) {
    teardownVirtualHeightObserver();
    const holder = document.querySelector('[class*="v_list_scroller"] .scroll_holder, [data-name="scroll_holder"]');
    if (!holder) return;
    // 监听 scroll_holder 的 style/transform 变化（虚拟总高度发生变化时）
    virtualHeightObserver = new MutationObserver(() => syncDoubaoVirtualOffset(turn));
    virtualHeightObserver.observe(holder, { attributes: true, attributeFilter: ['style'] });
  }

  function teardownVirtualHeightObserver() {
    if (virtualHeightObserver) {
      virtualHeightObserver.disconnect();
      virtualHeightObserver = null;
    }
  }

  function clear(options = {}) {
    const anchor = ChatDomAdapter.findLastNativeTurn();
    const turn = getTurn();
    const strategy = turn?.dataset?.ebookMountStrategy || getProfile().mountStrategy || 'sibling-after-last-turn';
    // 移除 spacer（如果存在）
    if (turn) {
      const spacer = turn.previousElementSibling;
      if (spacer && spacer.classList?.contains('ebook-reader-doubao-spacer')) spacer.remove();
      turn.remove();
    }

    if (strategy === 'overlay-in-message-list') {
      applyOverlayHostState(false);
    } else if (strategy === 'append-in-scroller-content') {
      teardownVirtualHeightObserver();
    }

    if (options.restoreToLastNative && anchor) {
      afterLayout(() => ChatDomAdapter.stabilizeScrollToElement(anchor, 'end', { duration: 500 }));
    }
  }

  function afterLayout(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  return { getTurn, mount, clear };
})();
