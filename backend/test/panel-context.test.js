'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'js', 'panel-context.mjs')
).href;

test('personIdFromSearch reads common record-id params', async () => {
  const { personIdFromSearch } = await import(modUrl);
  assert.equal(personIdFromSearch('?personId=55'), '55');
  assert.equal(personIdFromSearch('?id=77'), '77');
  assert.equal(personIdFromSearch('?selectedIds=88,99'), '88'); // first of a list
  assert.equal(personIdFromSearch('?resourceId=12'), '12');
});

test('personIdFromSearch returns null when no id is present', async () => {
  const { personIdFromSearch } = await import(modUrl);
  assert.equal(personIdFromSearch(''), null);
  assert.equal(personIdFromSearch('?foo=bar'), null);
});
