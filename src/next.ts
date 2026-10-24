export const NEXT_DISPLAY_LIMIT = 50;

export type NextDisplay = {
  text: string;
  plain: string;
  full: string;
  markdown: boolean;
  overlong: boolean;
};

function toPlain(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~]{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(value: string) {
  const end = value.search(/[。！？!?]/);
  return end >= 0 ? value.slice(0, end + 1).trim() : value;
}

/**
 * The next field is a human index, not a report. Keep it one plain sentence
 * even when an Agent has written Markdown or several paragraphs into TASKS.md.
 */
export function formatNext(value: string): NextDisplay {
  const full = value ?? '';
  const plain = toPlain(full);
  const sentence = firstSentence(plain);
  const overlong = plain.length > NEXT_DISPLAY_LIMIT || sentence !== plain;
  const text = sentence.length > NEXT_DISPLAY_LIMIT
    ? sentence.slice(0, NEXT_DISPLAY_LIMIT).trimEnd() + '…'
    : sentence;
  const markdown = /```|`|\*\*|__|\[[^\]]+\]\([^)]+\)|^\s{0,3}#{1,6}\s|^\s*[-*+]\s/m.test(full);
  return { text, plain, full, markdown, overlong };
}
