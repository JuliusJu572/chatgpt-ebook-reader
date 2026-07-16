/**
 * 阅读器挂载管理
 * ChatGPT: 作为独立消息插入到最后一条原生消息之后。
 * 豆包 : 以覆盖层形式挂到消息列表容器内，隐藏原虚拟消息列表。
 */

const ReaderMountManager = (() => {
  const TURN_ID = 'ebook-reader-turn';
  const TURN_ATTR = 'data-ebook-reader-turn';
  const HIDE_CLASS = 'ebook-reader-native-hidden';

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
    }

    turn.replaceChildren(contentElement);

    if (strategy === 'overlay-in-message-list') {
      applyOverlayHostState(true);
    }

    const validation = ChatDomAdapter.validateReaderMount(turn);
    if (!validation.ok) {
      turn.remove();
      if (strategy === 'overlay-in-message-list') applyOverlayHostState(false);
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
    // 隐藏虚拟列表本身（v_list-*），保留 reader 自身
    host.querySelectorAll(':scope > [class*="v_list-"]').forEach(el => {
      if (hide) el.classList.add(HIDE_CLASS);
      else el.classList.remove(HIDE_CLASS);
    });
  }

  function clear(options = {}) {
    const anchor = ChatDomAdapter.findLastNativeTurn();
    const turn = getTurn();
    const strategy = turn?.dataset?.ebookMountStrategy || getProfile().mountStrategy || 'sibling-after-last-turn';
    if (turn) turn.remove();

    if (strategy === 'overlay-in-message-list') {
      applyOverlayHostState(false);
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
