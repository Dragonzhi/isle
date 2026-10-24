import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNext } from '../src/next.ts';

test('short next stays unchanged', () => {
  const result = formatNext('停在 05 中性纸；下一步做真实交接');
  assert.equal(result.text, '停在 05 中性纸；下一步做真实交接');
  assert.equal(result.overlong, false);
  assert.equal(result.markdown, false);
});

test('next markdown is displayed as plain text', () => {
  const result = formatNext('**已改** `life:simulate`，见 [记录](https://example.com)。');
  assert.equal(result.text, '已改 life:simulate，见 记录。');
  assert.equal(result.plain, '已改 life:simulate，见 记录。');
  assert.equal(result.markdown, true);
});

test('long next is clipped for the human-facing index', () => {
  const result = formatNext('一'.repeat(80));
  assert.equal(result.text.length, 51);
  assert.ok(result.text.endsWith('…'));
  assert.equal(result.overlong, true);
  assert.equal(result.plain.length, 80);
});

test('only the first sentence is shown when an agent writes several', () => {
  const result = formatNext('先验证导入。再补视觉回归。最后更新记录。');
  assert.equal(result.text, '先验证导入。');
  assert.equal(result.overlong, true);
});

test('empty next is safe', () => {
  assert.deepEqual(formatNext(''), {
    text: '',
    plain: '',
    full: '',
    markdown: false,
    overlong: false,
  });
});
