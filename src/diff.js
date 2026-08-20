function stripComments(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--')
      return comment >= 0 ? line.slice(0, comment) : line
    })
    .join('\n')
}

function originalLines(text) {
  return (text || '').replace(/\r\n/g, '\n').split('\n')
}

// Tokens with the original line they came from, so we can highlight
// while ignoring newlines / tabs / indentation for matching.
function tokensWithLines(text) {
  const lines = stripComments(text).split('\n')
  const tokens = []
  for (let index = 0; index < lines.length; index++) {
    const parts = lines[index].match(/\S+/g)
    if (!parts) continue
    for (const key of parts) {
      tokens.push({ index, key })
    }
  }
  return tokens
}

function changedIndexes(aText, bText) {
  const a = tokensWithLines(aText)
  const b = tokensWithLines(bText)
  const m = a.length
  const n = b.length

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].key === b[j].key
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const left = new Set()
  const right = new Set()
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i].key === b[j].key) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.add(a[i].index)
      i++
    } else {
      right.add(b[j].index)
      j++
    }
  }
  while (i < m) {
    left.add(a[i].index)
    i++
  }
  while (j < n) {
    right.add(b[j].index)
    j++
  }

  return { left, right }
}

// Side-by-side columns with original text (copy/paste friendly).
// Matching ignores comments and all whitespace (newlines, tabs, indent).
export function diffColumns(aText, bText) {
  const aLines = originalLines(aText)
  const bLines = originalLines(bText)
  const { left: changedLeft, right: changedRight } = changedIndexes(aText, bText)

  return {
    left: aLines.map((text, index) => ({
      text,
      changed: changedLeft.has(index),
    })),
    right: bLines.map((text, index) => ({
      text,
      changed: changedRight.has(index),
    })),
  }
}
