function normalize(text) {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

// Line-based diff using a longest-common-subsequence walk.
// Returns rows of { type: 'same' | 'add' | 'del', text } where
// 'del' is present in `aText` (left/Dev) and 'add' in `bText` (right/Prod).
export function diffLines(aText, bText) {
  const a = normalize(aText).split('\n')
  const b = normalize(bText).split('\n')
  const m = a.length
  const n = b.length

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] })
      i++
    } else {
      rows.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) {
    rows.push({ type: 'del', text: a[i] })
    i++
  }
  while (j < n) {
    rows.push({ type: 'add', text: b[j] })
    j++
  }
  return rows
}

// Splits a diff into two independent columns for a side-by-side view.
// Each column keeps only its own lines (so a full copy of one side yields
// exactly that side's text), with `changed` flagging lines that differ.
export function diffColumns(aText, bText) {
  const rows = diffLines(aText, bText)
  const left = []
  const right = []

  for (const row of rows) {
    if (row.type === 'same') {
      left.push({ text: row.text, changed: false })
      right.push({ text: row.text, changed: false })
    } else if (row.type === 'del') {
      left.push({ text: row.text, changed: true })
    } else {
      right.push({ text: row.text, changed: true })
    }
  }

  return { left, right }
}
