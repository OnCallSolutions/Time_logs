/**
 * Breaks a pasted transcript into bounded excerpts without dropping source text.
 * Prefer newline boundaries so Teams speaker labels and timestamps stay beside
 * the utterances they identify. A very long single line is split on whitespace.
 */
export function splitTranscriptIntoChunks(source: string, maxChars = 10_000): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer")
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? []
  const blocks:string[]=[]
  let block=""
  for(const line of lines){
    block+=line
    // Keep the full Teams speaker/timestamp/utterance group together when it
    // fits; the blank line is the transcript's most reliable turn boundary.
    if(/^\s*\r?\n$/.test(line)){blocks.push(block);block=""}
  }
  if(block)blocks.push(block)
  const chunks: string[] = []
  let current = ""

  const appendLongBlock = (longBlock: string) => {
    let remaining = longBlock
    while (remaining.length > maxChars) {
      let boundary = remaining.lastIndexOf(" ", maxChars)
      if (boundary < Math.floor(maxChars * 0.6)) boundary = maxChars
      const part = remaining.slice(0, boundary)
      if (part) chunks.push(part)
      remaining = remaining.slice(boundary)
    }
    current = remaining
  }

  for (const nextBlock of blocks) {
    if (nextBlock.length > maxChars) {
      if (current) chunks.push(current)
      current = ""
      appendLongBlock(nextBlock)
      continue
    }
    if (current.length + nextBlock.length > maxChars) {
      if (current) chunks.push(current)
      current = nextBlock
    } else {
      current += nextBlock
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : source ? [source] : []
}
