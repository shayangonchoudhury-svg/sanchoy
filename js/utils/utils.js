// Utility functions for string formatting, CSV handling, and file downloads

export function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function round(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function csvSafe(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/"/g, '""');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s}"`;
  return s;
}

export function splitLines(text) {
  return text.replace(/\r/g, '').split('\n');
}

export function parseCSVLine(line) {
  const result = [];
  let i = 0, cur = '', inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
      i++;
    } else {
      if (ch === ',') { result.push(cur); cur = ''; i++; continue; }
      if (ch === '"') { inQuotes = true; i++; continue; }
      cur += ch;
      i++;
    }
  }
  result.push(cur);
  return result.map(s => s.trim());
}
