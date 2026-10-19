// Light, dark or follow the system. Also keeps the iPhone status bar colour in step.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.content = dark ? '#0e1014' : '#f3f4f7';
}
