// Getting files out of the app: the iPhone share sheet when available, a download otherwise.

export function safeFileName(name, ext) {
  const base = (name || 'Scan').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Scan';
  return `${base}.${ext}`;
}

export function canShareFiles(files) {
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
  } catch {
    return false;
  }
}

// Must be called right after a tap: iOS only allows the share sheet during a user gesture.
// Returns 'shared', 'cancelled' or 'downloaded'.
export async function shareFiles(files, title) {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files, title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // Some browsers refuse certain file types; fall back to saving.
    }
  }
  files.forEach(downloadFile);
  return 'downloaded';
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
