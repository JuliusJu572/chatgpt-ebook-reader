/**
 * 阅读器挂载管理
 * 负责把阅读内容作为一条独立消息插入到最后一条 ChatGPT 原生消息之后。
 */

const ReaderMountManager = (() => {
  const TURN_ID = 'ebook-reader-turn';
  const TURN_ATTR = 'data-ebook-reader-turn';

  function getTurn() {
    return document.getElementById(TURN_ID);
  }

  function mount(contentElement) {
    let turn = getTurn();
    if (!turn) {
      turn = document.createElement('div');
      turn.id = TURN_ID;
      turn.className = 'ebook-reader-turn';
      turn.setAttribute(TURN_ATTR, 'true');

      const lastTurn = ChatDomAdapter.findLastNativeTurn();
      const conversation = ChatDomAdapter.findConversationContainer();
      if (lastTurn?.parentElement) {
        lastTurn.after(turn);
      } else if (conversation) {
        conversation.appendChild(turn);
      } else {
        console.warn('[eBook Reader] 无法定位消息列表，阅读器未挂载');
        return { success: false, error: '无法定位消息列表' };
      }
    } else {
      const lastTurn = ChatDomAdapter.findLastNativeTurn();
      if (lastTurn?.parentElement && turn.previousElementSibling !== lastTurn) {
        lastTurn.after(turn);
      }
    }

    turn.replaceChildren(contentElement);

    const validation = ChatDomAdapter.validateReaderMount(turn);
    if (!validation.ok) {
      turn.remove();
      console.warn('[eBook Reader] 阅读器挂载失败:', validation.reason);
      return { success: false, error: validation.reason };
    }

    return { success: true, turn, content: contentElement };
  }

  function clear(options = {}) {
    const anchor = ChatDomAdapter.findLastNativeTurn();
    const turn = getTurn();
    if (turn) turn.remove();

    if (options.restoreToLastNative && anchor) {
      afterLayout(() => ChatDomAdapter.stabilizeScrollToElement(anchor, 'end', { duration: 500 }));
    }
  }

  function afterLayout(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  return { getTurn, mount, clear };
})();
