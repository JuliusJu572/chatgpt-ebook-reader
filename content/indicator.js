/**
 * 页面状态指示器
 * 在 ChatGPT 页面右下角显示阅读进度
 */

const Indicator = (() => {
  const INDICATOR_ID = 'ebook-reader-indicator';
  let indicatorEl = null;
  let messageTimeout = null;
  let _onJumpBookmark = null;

  function create() {
    if (document.getElementById(INDICATOR_ID)) {
      indicatorEl = document.getElementById(INDICATOR_ID);
      return;
    }

    indicatorEl = document.createElement('div');
    indicatorEl.id = INDICATOR_ID;
    indicatorEl.className = 'ebook-indicator';
    indicatorEl.innerHTML = `
      <div class="ebook-indicator-header">
        <span class="ebook-indicator-icon">📖</span>
        <span class="ebook-indicator-title">未加载书籍</span>
        <button class="ebook-indicator-bookmark" title="跳转到下一个书签">🔖</button>
        <button class="ebook-indicator-close" title="最小化">×</button>
      </div>
      <div class="ebook-indicator-progress">
        <span class="ebook-indicator-pages">-</span>
        <div class="ebook-indicator-bar-container">
          <div class="ebook-indicator-bar" style="width: 0%"></div>
        </div>
      </div>
      <div class="ebook-indicator-status">插件已启用 ✅</div>
      <div class="ebook-indicator-message" style="display:none"></div>
    `;
    document.body.appendChild(indicatorEl);

    // 最小化按钮
    indicatorEl.querySelector('.ebook-indicator-close').addEventListener('click', () => {
      indicatorEl.classList.toggle('ebook-indicator-minimized');
    });

    // 书签跳转按钮
    indicatorEl.querySelector('.ebook-indicator-bookmark').addEventListener('click', () => {
      if (_onJumpBookmark) _onJumpBookmark();
    });
  }

  function setOnJumpBookmark(fn) {
    _onJumpBookmark = fn;
  }

  function update(data) {
    if (!indicatorEl) create();

    const titleEl = indicatorEl.querySelector('.ebook-indicator-title');
    const pagesEl = indicatorEl.querySelector('.ebook-indicator-pages');
    const barEl = indicatorEl.querySelector('.ebook-indicator-bar');

    if (data.title) {
      titleEl.textContent = data.title;
    }

    if (data.currentPage !== undefined && data.totalPages !== undefined) {
      pagesEl.textContent = `第 ${data.currentPage}-${data.endPage} 页 / 共 ${data.totalPages} 页`;
      const percent = (data.endPage / data.totalPages) * 100;
      barEl.style.width = `${percent}%`;
    }
  }

  function setEnabled(enabled) {
    if (!indicatorEl) create();
    const statusEl = indicatorEl.querySelector('.ebook-indicator-status');
    statusEl.textContent = enabled ? '插件已启用 ✅' : '插件已禁用 ❌';
    indicatorEl.classList.toggle('ebook-indicator-disabled', !enabled);
  }

  function showMessage(msg) {
    if (!indicatorEl) create();
    const msgEl = indicatorEl.querySelector('.ebook-indicator-message');
    msgEl.textContent = msg;
    msgEl.style.display = 'block';
    clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => {
      msgEl.style.display = 'none';
    }, 2000);
  }

  function show() {
    if (!indicatorEl) create();
    indicatorEl.style.display = 'block';
  }

  function hide() {
    if (indicatorEl) indicatorEl.style.display = 'none';
  }

  function destroy() {
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  }

  return { create, update, setEnabled, showMessage, show, hide, destroy, setOnJumpBookmark };
})();
