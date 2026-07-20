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

  // 渲染后自动应用书签高亮
  Navigator.setOnRender(async () => {
    const state = Navigator.getState();
    if (state.bookId) {
      const bookmarks = await Bookmarks.getAll(state.bookId);
      Renderer.applyBookmarks(bookmarks);
    }
  });

  // 书签图标点击回调
  Renderer.setBookmarkCallback(async (pageIndex, paragraphIndex, preview, paraElement, locId) => {
    const state = Navigator.getState();
    if (!state.bookId) return;
    const added = await Bookmarks.toggle(state.bookId, {
      locId,
      pageIndex,
      paragraphIndex,
      preview
    });
    if (added) {
      paraElement.classList.add('ebook-bookmarked');
      const icon = paraElement.querySelector('.ebook-bookmark-icon');
      if (icon) icon.title = '移除书签';
      Indicator.showMessage(`🔖 已添加书签`);
    } else {
      paraElement.classList.remove('ebook-bookmarked');
      const icon = paraElement.querySelector('.ebook-bookmark-icon');
      if (icon) icon.title = '添加书签';
      Indicator.showMessage(`❌ 已移除书签`);
    }
  });

  // ===== 快捷键处理器 =====

  ShortcutManager.on('toggle', async () => {
    settings.enabled = !settings.enabled;
    await Settings.set({ enabled: settings.enabled });
    ShortcutManager.updateSettings(settings);
    Indicator.setEnabled(settings.enabled);

    if (!settings.enabled) {
      Renderer.clearRendered({ restoreToLastNative: true });
      Indicator.showMessage('插件已禁用');
    } else {
      Indicator.showMessage('插件已启用');
      if (Navigator.getState().hasBook) {
        Navigator.renderCurrent({ type: 'open-reader' });
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

  // 书签跳转按钮（悬浮窗中）
  Indicator.setOnJumpBookmark(async () => {
    const state = Navigator.getState();
    if (!state.hasBook) {
      Indicator.showMessage('请先在插件中上传电子书');
      return;
    }
    const lastVisiblePage = state.batchIndex * settings.pagesPerBatch + settings.pagesPerBatch - 1;
    const next = await Bookmarks.findNext(state.bookId, lastVisiblePage);
    if (!next) {
      Indicator.showMessage('📭 没有书签，hover 段落点击 🔖 添加');
      return;
    }
    Navigator.jumpToBookmark(next.pageIndex, next.paragraphIndex, next.locId);
    Indicator.showMessage(`🔖 跳转到书签: ${next.preview || '第' + (next.pageIndex + 1) + '页'}`);
  });

  // ===== 恢复阅读进度 =====
  const progress = await ReadingProgress.get();
  if (progress && progress.bookId) {
    try {
      const book = await EbookDB.getBook(progress.bookId);
      if (book) {
        Navigator.setBook(book);
        Navigator.setBatchIndex(progress.batchIndex || 0);
        if (settings.enabled) {
          setTimeout(() => {
            if (progress.locId && Navigator.jumpToLocation(progress.locId)) return;
            Navigator.renderCurrent({ type: 'restore-progress' });
          }, 2000);
        }
        console.log(`[eBook Reader] 恢复阅读: ${book.title}, 批次 ${progress.batchIndex}`);
      }
    } catch (e) {
      console.warn('[eBook Reader] 恢复阅读进度失败:', e);
    }
  }

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true;
  });

  async function handleMessage(message, sendResponse) {
    try {
      switch (message.type) {
        case 'LOAD_BOOK': {
          try {
            const book = await EbookDB.getBook(message.bookId);
            if (book) {
              Navigator.setBook(book);
              Navigator.setBatchIndex(0);
              if (settings.enabled) {
                Navigator.renderCurrent({ type: 'open-reader' });
              }
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: '书籍未找到' });
            }
          } catch (e) {
            sendResponse({ success: false, error: e.message });
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
          const jumped = Navigator.jumpToBookmark(message.pageIndex, message.paragraphIndex, message.locId);
          if (jumped) {
            Indicator.showMessage(`🔖 跳转到书签`);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: '书签位置未找到' });
          }
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
          try {
            const rBook = await EbookDB.getBook(message.bookId);
            if (rBook && rBook.rawText) {
              rBook.pages = EbookParser.splitIntoPages(rBook, message.charsPerPage);
              rBook.totalPages = rBook.pages.length;
              rBook.parserVersion = EbookParser.PARSER_VERSION || rBook.parserVersion;
              await Bookmarks.reindex(rBook.id, rBook.pageIndexByLocId);
              await EbookDB.saveBook(rBook);
              Navigator.setBook(rBook);
              Navigator.setBatchIndex(0);
              if (settings.enabled) {
                Navigator.renderCurrent({ type: 'batch-start' });
              }
              sendResponse({ success: true, totalPages: rBook.totalPages });
            } else {
              sendResponse({ success: false, error: '书籍数据不完整' });
            }
          } catch (e) {
            sendResponse({ success: false, error: e.message });
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

  // 监听 storage 变化同步设置
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
