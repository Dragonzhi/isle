import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function SummaryMarkdown({ text }: { text: string }) {
  return createElement(Markdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    components: {
      a: ({ href, title, children }) => href
        ? createElement('a', { href, title, target: '_blank', rel: 'noopener noreferrer' }, children)
        : createElement('span', null, children),
      // Project notes must not cause external image requests when the board opens.
      img: ({ alt }) => createElement('span', null, alt ? `[图片：${alt}]` : '[图片]'),
    },
    children: text,
  });
}
