/**
 * 内容脚本主入口
 * 初始化所有模块，协调工作流
 */

(async function main() {
  console.log('[eBook Reader] 初始化中...');

  // 加载设置
  let settings = await Settings.get();

  // 创建状态指示器
  Indicator.create();
  Indicator.setEnabled(settings.enabled);

  // 初始化快捷键
  ShortcutManager.init(settings);

  // 配置导航器
  Navigator.setConfig({ pagesPerBatch: settings.pagesPerBatch });

  // 快捷键处理器
  ShortcutManager.on('toggle', async () => {
    settings.enabled = !settings.enabled;
    await Settings.set({ enabled: settings.enabled });
    ShortcutManager.updateSettings(settings);
    Indicator.setEnabled(settings.enabled);

    if (!settings.enabled) {
      Renderer.clearRendered();
      Indicator.showMessage('插件已禁用');
    } else {
      Indicator.showMessage('插件已启用');
      if (Navigator.getState().hasBook) {
        Navigator.renderCurrent();
      }
    }
  });

  ShortcutManager.on('next', () => {
    if (!Navigator.getState().hasBook) {
      Indicator.showMessage('请先在插件中上传电子书');
      return;
    }
    Navigator.nextBatch();
  });

  ShortcutManager.on('prev', () => {
    if (!Navigator.getState().hasBook) {
      Indicator.showMessage('请先在插件中上传电子书');
      return;
    }
    Navigator.prevBatch();
  });

  ShortcutManager.on('bookmark', async () => {
    const state = Navigator.getState();
    if (!state.hasBook) {
      Indicator.showMessage('请先在插件中上传电子书');
      return;
    }
    const label = `第 ${state.batchIndex * settings.pagesPerBatch + 1} 页`;
    const added = await Bookmarks.toggle(state.bookId, state.batchIndex, label);
    if (added) {
      Indicator.showMessage(`🔖 已添加书签 (批次 ${state.batchIndex + 1})`);
    } else {
      Indicator.showMessage(`❌ 已移除书签 (批次 ${state.batchIndex + 1})`);
    }
  });

  ShortcutManager.on('jumpBookmark', async () => {
    const state = Navigator.getState();
    if (!state.hasBook) {
      Indicator.showMessage('请先在插件中上传电子书');
      return;
    }
    const next = await Bookmarks.findNext(state.bookId, state.batchIndex);
    if (!next) {
      Indicator.showMessage('📭 没有书签，按 Alt+Shift+B 添加');
      return;
    }
    Navigator.jumpToBatch(next.batchIndex);
    Indicator.showMessage(`🔖 跳转到书签: ${next.label}`);
  });

  // 尝试恢复上次阅读进度
  const progress = await ReadingProgress.get();
  if (progress && progress.bookId) {
    try {
      // 通过 service worker 获取书籍数据
      const resp = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'GET_BOOK_FOR_CONTENT', bookId: progress.bookId },
          resolve
        );
      });
      if (resp && resp.success && resp.book) {
        const book = resp.book;
        Navigator.setBook(book);
        Navigator.setBatchIndex(progress.batchIndex || 0);
        if (settings.enabled) {
          // 等待 ChatGPT 页面完全加载后渲染
          setTimeout(() => {
            Navigator.renderCurrent();
          }, 2000);
        }
        console.log(`[eBook Reader] 恢复阅读: ${book.title}, 批次 ${progress.batchIndex}`);
      }
    } catch (e) {
      console.warn('[eBook Reader] 恢复阅读进度失败:', e);
    }
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true; // 异步 sendResponse
  });

  async function handleMessage(message, sendResponse) {
    try {
      switch (message.type) {
        case 'LOAD_BOOK': {
          // 通过 service worker 获取书籍数据
          const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage(
              { type: 'GET_BOOK_FOR_CONTENT', bookId: message.bookId },
              resolve
            );
          });
          if (resp && resp.success && resp.book) {
            Navigator.setBook(resp.book);
            Navigator.setBatchIndex(0);
            if (settings.enabled) {
              Navigator.renderCurrent();
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: '书籍未找到' });
          }
          break;
        }

        case 'UPDATE_SETTINGS': {
          settings = { ...settings, ...message.settings };
          await Settings.set(settings);
          ShortcutManager.updateSettings(settings);
          Navigator.setConfig({ pagesPerBatch: settings.pagesPerBatch });
          Indicator.setEnabled(settings.enabled);
          sendResponse({ success: true });
          break;
        }

        case 'JUMP_BOOKMARK': {
          if (!Navigator.getState().hasBook) {
            sendResponse({ success: false, error: '未加载书籍' });
            break;
          }
          Navigator.jumpToBatch(message.batchIndex);
          Indicator.showMessage(`🔖 跳转到批次 ${message.batchIndex + 1}`);
          sendResponse({ success: true });
          break;
        }

        case 'GET_STATE': {
          sendResponse({
            success: true,
            state: {
              ...Navigator.getState(),
              enabled: settings.enabled
            }
          });
          break;
        }

        case 'REPARSE_BOOK': {
          // 通过 service worker 获取书籍数据
          const rResp = await new Promise(resolve => {
            chrome.runtime.sendMessage(
              { type: 'GET_BOOK_FOR_CONTENT', bookId: message.bookId },
              resolve
            );
          });
          if (rResp && rResp.success && rResp.book && rResp.book.rawText) {
            const rBook = rResp.book;
            rBook.pages = splitIntoPages(rBook.rawText, message.charsPerPage);
            rBook.totalPages = rBook.pages.length;
            // 保存更新后的书籍（通过 service worker）
            await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: 'DB_SAVE_BOOK', book: rBook }, resolve);
            });
            Navigator.setBook(rBook);
            Navigator.setBatchIndex(0);
            if (settings.enabled) {
              Navigator.renderCurrent();
            }
            sendResponse({ success: true, totalPages: rBook.totalPages });
          } else {
            sendResponse({ success: false, error: '书籍数据不完整' });
          }
          break;
        }

        default:
          sendResponse({ success: false, error: '未知消息类型' });
      }
    } catch (e) {
      console.error('[eBook Reader] 消息处理错误:', e);
      sendResponse({ success: false, error: e.message });
    }
  }

  // 监听 storage 变化以同步设置
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = changes.settings.newValue;
      ShortcutManager.updateSettings(settings);
      Navigator.setConfig({ pagesPerBatch: settings.pagesPerBatch });
      Indicator.setEnabled(settings.enabled);
    }
  });

  console.log('[eBook Reader] 初始化完成');
})();

// 工具函数：文本分页
function splitIntoPages(text, charsPerPage) {
  const pages = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + charsPerPage, text.length);
    // 尽量在段落或句子边界分割
    if (end < text.length) {
      const slice = text.substring(i, end);
      const lastPara = slice.lastIndexOf('\n\n');
      const lastNewline = slice.lastIndexOf('\n');
      const lastPeriod = Math.max(
        slice.lastIndexOf('。'),
        slice.lastIndexOf('.'),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？')
      );

      if (lastPara > charsPerPage * 0.5) {
        end = i + lastPara + 2;
      } else if (lastNewline > charsPerPage * 0.5) {
        end = i + lastNewline + 1;
      } else if (lastPeriod > charsPerPage * 0.5) {
        end = i + lastPeriod + 1;
      }
    }

    const page = text.substring(i, end).trim();
    if (page) pages.push(page);
    i = end;
  }
  return pages;
}
