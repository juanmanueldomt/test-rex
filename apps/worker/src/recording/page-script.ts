// Installed in every page of a recording session (`addInitScript`). Plain JavaScript in a
// string so no build step rewrites it: it runs in the browser, not in Node.
export const RECORDER_PAGE_SCRIPT = String.raw`(() => {
  if (window.__testrex) return;
  const TEST_ID = 'data-testid';
  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label', '[role]',
    '[contenteditable=""]', '[contenteditable="true"]', '[onclick]', '[' + TEST_ID + ']',
  ].join(',');
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const NON_TEXT_INPUTS = ['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden'];

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    switch (tag) {
      case 'button': return 'button';
      case 'a': return el.hasAttribute('href') ? 'link' : null;
      case 'select': return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'textarea': return 'textbox';
      case 'option': return 'option';
      case 'img': return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'nav': return 'navigation';
      case 'dialog': return 'dialog';
      case 'li': return 'listitem';
      case 'ul': case 'ol': return 'list';
      case 'table': return 'table';
      case 'tr': return 'row';
      case 'td': return 'cell';
      case 'th': return 'columnheader';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'input':
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return el.getAttribute('list') ? 'combobox' : 'searchbox';
        if (['text', 'email', 'tel', 'url', 'password', ''].includes(type)) {
          return type === 'password' ? null : el.getAttribute('list') ? 'combobox' : 'textbox';
        }
        return null;
      default: return null;
    }
  }

  function textOfIds(ids) {
    return norm(ids.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
  }

  function labelText(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) return textOfIds(labelledBy);
    if (el.labels && el.labels.length) {
      // The label's own words: controls nested in it (the select itself, its options) are left out.
      return norm(Array.from(el.labels).map((label) => {
        const copy = label.cloneNode(true);
        copy.querySelectorAll('input, select, textarea, button').forEach((control) => control.remove());
        return copy.textContent;
      }).join(' '));
    }
    return '';
  }

  function nameOf(el, role) {
    const aria = norm(el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) return textOfIds(labelledBy);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) {
      return norm(el.value) || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '');
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      return labelText(el) || norm(el.getAttribute('title')) || norm(el.getAttribute('placeholder'));
    }
    if (tag === 'img') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title'));
    const fromContent = ['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'checkbox', 'radio',
      'switch', 'cell', 'columnheader', 'rowheader', 'treeitem', 'listitem'];
    if (fromContent.includes(role)) return norm(el.innerText || el.textContent) || norm(el.getAttribute('title'));
    return norm(el.getAttribute('title'));
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = roleOf(el);
    const rect = el.getBoundingClientRect();
    const editable = tag === 'textarea' || el.isContentEditable || (tag === 'input' && !NON_TEXT_INPUTS.includes(type));
    return {
      tag,
      role,
      name: role ? nameOf(el, role).slice(0, 200) : '',
      testId: el.getAttribute(TEST_ID) || '',
      label: tag === 'input' || tag === 'select' || tag === 'textarea' ? labelText(el).slice(0, 200) : '',
      placeholder: el.getAttribute('placeholder') || '',
      alt: el.getAttribute('alt') || '',
      title: el.getAttribute('title') || '',
      text: norm(el.innerText || el.textContent).slice(0, 200),
      editable,
      checkable: tag === 'input' && (type === 'checkbox' || type === 'radio'),
      checked: tag === 'input' && (type === 'checkbox' || type === 'radio') ? Boolean(el.checked) : null,
      value: tag === 'input' || tag === 'textarea' || tag === 'select' ? String(el.value) : null,
      options: tag === 'select'
        ? Array.from(el.options).map((option) => ({ value: option.value, label: norm(option.label || option.textContent) }))
        : null,
      cssPath: cssPath(el),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }

  function at(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest(INTERACTIVE) || el;
  }

  function active() {
    const el = document.activeElement;
    return el && el !== document.body && el !== document.documentElement ? el : null;
  }

  Object.defineProperty(window, '__testrex', { value: { describe, at, active }, enumerable: false });
})();`;
