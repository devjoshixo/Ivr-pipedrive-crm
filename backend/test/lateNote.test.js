'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLateNoteContent } = require('../src/notes/lateNote');

test('buildLateNoteContent returns empty string for a blank note', () => {
  assert.equal(buildLateNoteContent({ note: '', pbxCallId: 'rt-1' }), '');
  assert.equal(buildLateNoteContent({ note: '   ', pbxCallId: 'rt-1' }), '');
  assert.equal(buildLateNoteContent({}), '');
  assert.equal(buildLateNoteContent({ note: null }), '');
});

test('buildLateNoteContent includes the note and a PBX reference line', () => {
  const out = buildLateNoteContent({ note: 'Customer will call back Monday', pbxCallId: 'rt-abc' });
  assert.match(out, /Customer will call back Monday/);
  assert.match(out, /PBX Call Id: rt-abc/);
  assert.match(out, /<br>/);
});

test('buildLateNoteContent escapes HTML in the note', () => {
  const out = buildLateNoteContent({ note: '<script>alert(1)</script> & "quote"', pbxCallId: 'x' });
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&amp;/);
  assert.match(out, /&quot;/);
});

test('buildLateNoteContent omits the reference line when no pbxCallId', () => {
  const out = buildLateNoteContent({ note: 'hello' });
  assert.equal(out, 'hello');
});
