/**
 * Shared shortcut helpers.
 * Keeps popup recording/display and content-script matching in sync.
 */

const ShortcutUtils = (() => {
  const MODIFIER_KEYS = new Set(['Alt', 'Shift', 'Control', 'Meta']);

  function isMacOS() {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    return /mac|iphone|ipad|ipod/i.test(platform) || /mac os|iphone|ipad|ipod/i.test(userAgent);
  }

  function normalizeKey(key) {
    if (key === 'Spacebar') return ' ';
    return key || '';
  }

  function normalizeShortcut(shortcut) {
    return {
      alt: !!shortcut?.alt,
      shift: !!shortcut?.shift,
      ctrl: !!shortcut?.ctrl,
      meta: !!shortcut?.meta,
      key: normalizeKey(shortcut?.key)
    };
  }

  function modifierState(event) {
    return {
      alt: !!event.altKey,
      shift: !!event.shiftKey,
      ctrl: !!event.ctrlKey,
      meta: !!event.metaKey
    };
  }

  function matchesModifiers(event, shortcut) {
    const expected = normalizeShortcut(shortcut);
    const actual = modifierState(event);

    if (expected.alt !== actual.alt || expected.shift !== actual.shift) {
      return false;
    }

    // Compatibility: shortcuts saved as Ctrl on Windows/Linux should still be
    // usable as Command on macOS. Physical Control continues to work too.
    if (isMacOS() && expected.ctrl && !expected.meta) {
      return actual.ctrl !== actual.meta;
    }

    return expected.ctrl === actual.ctrl && expected.meta === actual.meta;
  }

  function matches(event, shortcut) {
    const expected = normalizeShortcut(shortcut);
    if (!expected.key) return false;

    const actualKey = normalizeKey(event.key);
    return matchesModifiers(event, expected) &&
      actualKey.toLowerCase() === expected.key.toLowerCase();
  }

  function fromEvent(event) {
    return {
      alt: !!event.altKey,
      shift: !!event.shiftKey,
      ctrl: !!event.ctrlKey,
      meta: !!event.metaKey,
      key: normalizeKey(event.key)
    };
  }

  function isModifierKey(key) {
    return MODIFIER_KEYS.has(key);
  }

  function format(shortcut) {
    const normalized = normalizeShortcut(shortcut);
    const parts = [];
    const mac = isMacOS();
    const labels = mac
      ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
      : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };

    if (normalized.ctrl) parts.push(labels.ctrl);
    if (normalized.alt) parts.push(labels.alt);
    if (normalized.shift) parts.push(labels.shift);
    if (normalized.meta) parts.push(labels.meta);

    let keyName = normalized.key;
    const keyMap = {
      ArrowRight: '→',
      ArrowLeft: '←',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ' ': 'Space',
      Escape: 'Esc'
    };
    if (keyMap[keyName]) {
      keyName = keyMap[keyName];
    } else {
      keyName = keyName.toUpperCase();
    }

    parts.push(keyName);
    return parts.join(mac ? ' ' : ' + ');
  }

  function getDefaultShortcuts() {
    if (isMacOS()) {
      return {
        toggle: { meta: true, shift: true, key: 'e' },
        next: { meta: true, shift: true, key: 'ArrowRight' },
        prev: { meta: true, shift: true, key: 'ArrowLeft' }
      };
    }

    return {
      toggle: { alt: true, shift: true, key: 'e' },
      next: { alt: true, shift: true, key: 'ArrowRight' },
      prev: { alt: true, shift: true, key: 'ArrowLeft' }
    };
  }

  return { matches, fromEvent, format, isModifierKey, isMacOS, getDefaultShortcuts };
})();
