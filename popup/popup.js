/**
 * Popup 交互逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ===== 标签页切换 =====
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ===== 加载设置 =====
  const settings = await Settings.get();
  document.getElementById('charsPerPage').value = settings.charsPerPage;
  document.getElementById('pagesPerBatch').value = settings.pagesPerBatch;
  updateShortcutDisplays(settings.shortcuts);

  // ===== 上传功能 =====
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    const validExts = ['.pdf', '.epub', '.txt'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
      setStatus('❌ 不支持的文件格式');
      return;
    }

    showProgress(true);
    setProgress(10, '正在读取文件...');

    try {
      setProgress(30, '正在解析内容...');
      const parsed = await EbookParser.parse(file);

      setProgress(60, '正在分页...');
      const currentSettings = await Settings.get();
      const pages = EbookParser.splitIntoPages(parsed.rawText, currentSettings.charsPerPage);

      setProgress(80, '正在保存...');
      const book = {
        title: parsed.title,
        fileName: file.name,
        rawText: parsed.rawText,
        pages: pages,
        totalPages: pages.length,
        totalChars: parsed.totalChars
      };

      const bookId = await EbookDB.saveBook(book);

      setProgress(100, `✅ 解析完成！共 ${pages.length} 页`);
      setStatus(`已上传: ${parsed.title}`);

      // 通知 content script 加载此书
      sendToContent({ type: 'LOAD_BOOK', bookId });

      // 刷新书架
      await loadBookshelf();

      // 切换到书架标签
      setTimeout(() => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="bookshelf"]').classList.add('active');
        document.getElementById('tab-bookshelf').classList.add('active');
        showProgress(false);
      }, 1500);

    } catch (err) {
      console.error('解析失败:', err);
      setProgress(0, `❌ 解析失败: ${err.message}`);
      setStatus('解析失败');
    }
  }

  // ===== 书架功能 =====
  async function loadBookshelf() {
    const bookshelf = document.getElementById('bookshelf');
    const books = await EbookDB.getAllBooks();
    const progress = await ReadingProgress.get();

    if (books.length === 0) {
      bookshelf.innerHTML = '<p class="empty-hint">暂无电子书，请先上传</p>';
      return;
    }

    bookshelf.innerHTML = books.map(book => `
      <div class="book-item ${progress?.bookId === book.id ? 'active' : ''}" data-id="${book.id}">
        <div class="book-info">
          <div class="book-title">${escapeHtml(book.title)}</div>
          <div class="book-meta">${book.totalPages} 页 · ${formatSize(book.totalChars)} 字</div>
        </div>
        <div class="book-actions">
          <button class="book-btn load" title="加载此书" data-id="${book.id}">📖</button>
          <button class="book-btn delete" title="删除" data-id="${book.id}">🗑️</button>
        </div>
      </div>
    `).join('');

    // 加载按钮
    bookshelf.querySelectorAll('.book-btn.load').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const bookId = btn.dataset.id;
        sendToContent({ type: 'LOAD_BOOK', bookId });
        setStatus('已加载书籍');
        await loadBookshelf();
      });
    });

    // 删除按钮
    bookshelf.querySelectorAll('.book-btn.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const bookId = btn.dataset.id;
        if (confirm('确定要删除这本书吗？')) {
          await EbookDB.deleteBook(bookId);
          const currentProgress = await ReadingProgress.get();
          if (currentProgress?.bookId === bookId) {
            await ReadingProgress.clear();
          }
          await loadBookshelf();
          setStatus('已删除');
        }
      });
    });
  }

  // ===== 设置功能 =====
  // 快捷键录制
  const shortcutInputs = document.querySelectorAll('.shortcut-input');
  shortcutInputs.forEach(input => {
    input.addEventListener('focus', () => {
      input.classList.add('recording');
      input.textContent = '请按下快捷键组合...';
    });

    input.addEventListener('blur', () => {
      input.classList.remove('recording');
      // 恢复显示
      const action = input.dataset.action;
      const current = settings.shortcuts[action];
      if (current) {
        input.textContent = formatShortcut(current);
      }
    });

    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return;

      const shortcut = {
        alt: e.altKey,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        key: e.key
      };

      const action = input.dataset.action;
      settings.shortcuts[action] = shortcut;
      input.textContent = formatShortcut(shortcut);
      input.classList.remove('recording');
      input.blur();
    });
  });

  // 保存设置
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const newSettings = {
      charsPerPage: parseInt(document.getElementById('charsPerPage').value) || 2000,
      pagesPerBatch: parseInt(document.getElementById('pagesPerBatch').value) || 10,
      shortcuts: settings.shortcuts
    };

    await Settings.set(newSettings);
    sendToContent({ type: 'UPDATE_SETTINGS', settings: newSettings, target: 'content' });
    setStatus('✅ 设置已保存');
  });

  // ===== 工具函数 =====
  function sendToContent(message) {
    // 通过 service worker 转发，确保消息可靠送达
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('⚠️ 请先打开 ChatGPT 页面');
        console.warn('消息发送失败:', chrome.runtime.lastError.message);
      }
    });
  }

  function showProgress(show) {
    document.getElementById('uploadProgress').style.display = show ? 'block' : 'none';
    document.getElementById('uploadArea').style.display = show ? 'none' : 'block';
  }

  function setProgress(percent, text) {
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = text;
  }

  function setStatus(text) {
    document.getElementById('statusText').textContent = text;
  }

  function updateShortcutDisplays(shortcuts) {
    Object.entries(shortcuts).forEach(([action, shortcut]) => {
      const el = document.getElementById(`shortcut-${action}`);
      if (el) el.textContent = formatShortcut(shortcut);
    });
  }

  function formatShortcut(shortcut) {
    const parts = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.meta) parts.push('Meta');

    let keyName = shortcut.key;
    const keyMap = {
      'ArrowRight': '→', 'ArrowLeft': '←',
      'ArrowUp': '↑', 'ArrowDown': '↓',
      ' ': 'Space'
    };
    if (keyMap[keyName]) keyName = keyMap[keyName];
    else keyName = keyName.toUpperCase();

    parts.push(keyName);
    return parts.join(' + ');
  }

  function formatSize(chars) {
    if (chars > 10000) return (chars / 10000).toFixed(1) + '万';
    return chars.toLocaleString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 初始加载书架
  await loadBookshelf();
});
