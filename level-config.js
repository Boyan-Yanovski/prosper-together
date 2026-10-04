/* A page instance runs one level; shared UI/editor assets remain untouched. */
window.CWT_LEVEL = new URLSearchParams(location.search).get('level') === '2' ? 2 : 1;
document.documentElement.dataset.level = String(window.CWT_LEVEL);
window.CWT_PLAYER_IDS = ['mystic','farmer','scientist','artist','craftsperson',
  ...(window.CWT_LEVEL === 2 ? ['healer','organizer'] : [])];
