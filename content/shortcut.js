/**
 * 快捷键监听与管理
 */

const ShortcutManager = (() => {
  let settings = null;
  let handlers = {};

  function matchesShortcut(event, shortcutDef) {
    return ShortcutUtils.matches(event, shortcutDef);
  }

  function handleKeyDown(event) {
    if (!settings) return;

    const shortcuts = settings.shortcuts;

    if (matchesShortcut(event, shortcuts.toggle)) {
      event.preventDefault();
      event.stopPropagation();
      if (handlers.toggle) handlers.toggle();
      return;
    }

    // 以下快捷键仅在插件启用时生效
    if (!settings.enabled) return;

    if (matchesShortcut(event, shortcuts.next)) {
      event.preventDefault();
      event.stopPropagation();
      if (handlers.next) handlers.next();
    } else if (matchesShortcut(event, shortcuts.prev)) {
      event.preventDefault();
      event.stopPropagation();
      if (handlers.prev) handlers.prev();
    }
  }

  function init(currentSettings) {
    settings = currentSettings;
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function updateSettings(newSettings) {
    settings = newSettings;
  }

  function on(action, handler) {
    handlers[action] = handler;
  }

  function destroy() {
    document.removeEventListener('keydown', handleKeyDown, true);
    handlers = {};
  }

  return { init, updateSettings, on, destroy };
})();
