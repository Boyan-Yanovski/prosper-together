/* Which language the game speaks.

   The page is written in English: its markup and the game's scripts hold the
   English text. Another language lies beside it in a file of its own (German:
   game-language-de.js) and is laid over the English as the page loads, before
   the game's own script reads the page. So changing the language reloads the
   page; the choice is kept in this browser.

   A translation has five parts:
     title        the name on the browser's tab.
     page         the markup's own text, by element: its data-ui-key, or #id.
                  An element's child elements (an icon, a figure the game
                  fills in, a highlighted word) keep their place as {0}, {1},
                  … in the order the English has them; a child with text of
                  its own is translated under its own name.
     styles       typography an element has in this language only, by the
                  same names, as CSS ("font-size: 12px").
     attributes   labels the markup keeps in attributes, by their English.
     text         what the scripts write as the game runs, by its English,
                  with {} wherever a value is put in. The translation names
                  the values {0}, {1}, …, or is a function of them where the
                  wording depends on a number.

   The scripts mark their text with T (a template: T`Turn ${n}`) or tr (a
   plain string: tr(player.role)). In English both give the text back as it
   is written.

   The UI editor edits whichever language its preview shows. English is
   written into the page; another language's page and styles parts are
   written into its file (see ui-editor/editor.js and language_source.py). */
(function () {
  const STORAGE_KEY = 'common-works-table-v12.language';
  /* The editor's preview has a choice of its own, kept only as long as the
     editor's tab: the editor opens on the page as it is written, whatever
     language the game was last played in. */
  const EDITOR_KEY = 'common-works-table-v12.editor-language';
  const LANGUAGES = ['en', 'de'];
  const root = document.documentElement;
  const query = new URLSearchParams(location.search);
  const named = LANGUAGES.includes(query.get('lang')) ? query.get('lang') : null;
  const editing = query.has('author');
  // The page's own test modes read the English: they always get the page as it is written.
  const testing = [...query.keys()].some(key => /test$/.test(key));
  const kept = () => (editing ? sessionStorage.getItem(EDITOR_KEY) : localStorage.getItem(STORAGE_KEY));
  const keep = language => (editing ? sessionStorage.setItem(EDITOR_KEY, language) : localStorage.setItem(STORAGE_KEY, language));
  let chosen = null;
  if (!named && !testing) {
    try { chosen = kept(); } catch { /* storage is blocked */ }
  }
  const language = named || (LANGUAGES.includes(chosen) ? chosen : 'en');
  root.lang = language;
  root.dataset.language = language;
  // Until the other language is laid over it, the page is not shown (see the page's styles).
  if (language !== 'en') root.dataset.languagePending = '';

  const translation = () => (language === 'en' ? null : window.CWT_TRANSLATIONS?.[language] || null);
  /* Text a translation has no entry for is shown in English and noted here,
     for the tests to find. */
  const missing = new Set();

  const filled = (template, values) => template.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)] ?? '');

  function T(strings, ...values) {
    const text = translation()?.text;
    if (text) {
      const entry = text[strings.join('{}')];
      if (typeof entry === 'function') return entry(...values);
      if (typeof entry === 'string') return filled(entry, values);
      missing.add(strings.join('{}'));
    }
    return strings.reduce((whole, part, index) => whole + part + (index < values.length ? values[index] : ''), '');
  }

  function tr(english) {
    const text = translation()?.text;
    if (!text) return english;
    if (typeof text[english] === 'string') return text[english];
    missing.add(english);
    return english;
  }

  // 1.5 is written 1,5 in German.
  const number = text => (language === 'de' ? String(text).replace('.', ',') : String(text));

  const nameOf = element => element.dataset.uiKey || (element.id ? `#${element.id}` : '');

  function translatePage(scope = document) {
    try { layOver(scope); } finally { delete root.dataset.languagePending; }
  }

  function layOver(scope) {
    const german = translation();
    if (!german) return;
    if (german.title && scope === document) document.title = german.title;
    const find = name => scope.querySelector(name.startsWith('#') ? name : `[data-ui-key="${name}"]`);
    /* For the editor, every child is marked with whose it was in the English
       and its place there, so that text edited in this language can be
       written back with its slots ({0}, {1}, …). */
    if (editing) {
      scope.querySelectorAll('body [data-ui-key], body [id]').forEach(element => {
        if (element.closest('svg')) return;
        [...element.children].forEach((child, index) => child.setAttribute('data-language-slot', `${nameOf(element)}:${index}`));
      });
    }
    /* Every element is found before any is rewritten: a rewrite moves an
       element's children, and may leave one out. */
    const work = Object.entries(german.page || {}).map(([name, template]) => {
      const element = find(name);
      if (!element) missing.add(`page: ${name}`);
      return { element, template };
    }).filter(item => item.element);
    for (const { element, template } of work) {
      const children = [...element.children];
      const draft = document.createElement('template');
      draft.innerHTML = template.replace(/\{(\d+)\}/g, '<slot name="$1"></slot>');
      const placed = new Set();
      draft.content.querySelectorAll('slot').forEach(slot => {
        const child = children[Number(slot.name)];
        if (!child) { slot.remove(); return; }
        slot.replaceWith(placed.has(child) ? child.cloneNode(true) : child);
        placed.add(child);
      });
      element.replaceChildren(draft.content);
    }
    // After the page's own style, so that where both name a property this language's holds.
    for (const [name, css] of Object.entries(german.styles || {})) {
      const element = find(name);
      if (element) element.style.cssText += `;${css}`;
      else missing.add(`styles: ${name}`);
    }
    const labels = german.attributes || {};
    scope.querySelectorAll('[aria-label], [title], [alt]').forEach(element => {
      for (const name of ['aria-label', 'title', 'alt']) {
        const english = element.getAttribute(name);
        if (english && typeof labels[english] === 'string') element.setAttribute(name, labels[english]);
      }
    });
  }
  // Whatever becomes of the scripts that follow, the page is shown.
  addEventListener('DOMContentLoaded', () => { delete root.dataset.languagePending; });

  /* The choice is kept in this browser. Where the browser keeps nothing
     (private windows, blocked storage) it rides in the address instead. */
  function choose(next) {
    if (!LANGUAGES.includes(next) || next === language || (testing && !named)) return;
    let stored = false;
    try {
      keep(next);
      stored = kept() === next;
    } catch { /* storage is blocked */ }
    const address = new URL(location.href);
    if (stored) address.searchParams.delete('lang');
    else address.searchParams.set('lang', next);
    if (address.href === location.href) location.reload();
    else location.replace(address.href);
  }

  /* A level opened at an address of its own speaks the language this page
     was asked for. Opened from the editor's preview, it stays the editor's
     preview, and so keeps the editor's language. */
  function carry(address) {
    if (named) address.searchParams.set('lang', named);
    if (editing) address.searchParams.set('author', query.get('author') || '1');
    return address;
  }

  window.CWT_LANGUAGE = {
    current: language,
    other: LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length],
    languages: LANGUAGES,
    editorKey: EDITOR_KEY,
    choose, carry, translatePage, number, missing
  };
  window.T = T;
  window.tr = tr;
}());
