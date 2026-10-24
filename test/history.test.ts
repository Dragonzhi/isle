import test from 'node:test';
import assert from 'node:assert/strict';
import { orderHistory } from '../src/history.ts';

test('work trail is displayed newest first and keeps same-day order', () => {
  const input = [
    '- 2026-10-19 · Hanako：较早的一条。',
    '- 2026-10-18 · Hanako：更早的一条。',
    '- 2026-10-19 · DeepSeek Harness：同日的后一条。',
    '- 2026-10-20 · Codex：较新的一条。',
  ].join('\n');
  const result = orderHistory(input);
  assert.equal(result.parsed, true);
  assert.equal(result.outOfOrder, true);
  assert.deepEqual(result.text.split('\n'), [
    '- 2026-10-20 · Codex：较新的一条。',
    '- 2026-10-19 · Hanako：较早的一条。',
    '- 2026-10-19 · DeepSeek Harness：同日的后一条。',
    '- 2026-10-18 · Hanako：更早的一条。',
  ]);
});

test('ascending append order is reversed for display without being flagged', () => {
  const result = orderHistory('- 2026-10-17 · A：旧。\n- 2026-10-24 · B：新。');
  assert.equal(result.parsed, true);
  assert.equal(result.outOfOrder, false);
  assert.equal(result.text, '- 2026-10-24 · B：新。\n- 2026-10-17 · A：旧。');
});

test('already newest-first history remains stable', () => {
  const input = '- 2026-10-24 · A：新。\n- 2026-10-23 · B：旧。';
  const result = orderHistory(input);
  assert.equal(result.parsed, true);
  assert.equal(result.outOfOrder, false);
  assert.equal(result.text, input);
});

test('history with headings or prose is left untouched', () => {
  const input = '### 备注\n- 2026-10-17 · Codex：部分推进；未验证。';
  const result = orderHistory(input);
  assert.equal(result.parsed, false);
  assert.equal(result.outOfOrder, false);
  assert.equal(result.text, input);
});

test('empty and single-entry history are left untouched', () => {
  assert.deepEqual(orderHistory(''), { text: '', parsed: false, outOfOrder: false });
  assert.deepEqual(orderHistory('- 2026-10-17 · A：唯一一条。'), {
    text: '- 2026-10-17 · A：唯一一条。',
    parsed: false,
    outOfOrder: false,
  });
});
