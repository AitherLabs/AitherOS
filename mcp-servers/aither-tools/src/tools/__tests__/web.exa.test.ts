import { test } from 'node:test';
import assert    from 'node:assert/strict';
import { pickExaSnippet, buildExaRequest } from '../web.js';

test('pickExaSnippet prefers highlights when present', () => {
  const snippet = pickExaSnippet({
    highlights: ['first highlight', 'second highlight'],
    summary:    'fallback summary',
    text:       'fallback text body',
  });
  assert.equal(snippet, 'first highlight … second highlight');
});

test('pickExaSnippet falls back to summary when highlights are missing', () => {
  const snippet = pickExaSnippet({
    summary: 'concise summary of the page',
    text:    'full text body we should not use',
  });
  assert.equal(snippet, 'concise summary of the page');
});

test('pickExaSnippet falls back to text when neither highlights nor summary are present', () => {
  const snippet = pickExaSnippet({
    text: 'page body content',
  });
  assert.equal(snippet, 'page body content');
});

test('pickExaSnippet returns empty string when no content is provided', () => {
  assert.equal(pickExaSnippet({}), '');
});

test('pickExaSnippet collapses whitespace and truncates long text', () => {
  const longText = 'word '.repeat(200);
  const snippet  = pickExaSnippet({ text: longText }, 50);
  assert.equal(snippet.length, 51);
  assert.equal(snippet.endsWith('…'), true);
  assert.equal(/\s{2,}/.test(snippet), false);
});

test('pickExaSnippet ignores empty highlights array and falls through', () => {
  const snippet = pickExaSnippet({
    highlights: [],
    summary:    'summary here',
  });
  assert.equal(snippet, 'summary here');
});

test('buildExaRequest sets the x-exa-integration attribution header', () => {
  const { headers } = buildExaRequest('test', {}, 'sk-test-key');
  assert.equal(headers['x-exa-integration'], 'aitheros');
  assert.equal(headers['x-api-key'],         'sk-test-key');
  assert.equal(headers['Content-Type'],      'application/json');
});

test('buildExaRequest applies sensible defaults', () => {
  const { body } = buildExaRequest('what is entropy', {});
  assert.equal(body.query,      'what is entropy');
  assert.equal(body.type,       'auto');
  assert.equal(body.numResults, 10);
  assert.deepEqual(body.contents, { highlights: true, text: { maxCharacters: 500 } });
});

test('buildExaRequest passes through advanced options', () => {
  const { body } = buildExaRequest('quantum startups', {
    type:               'neural',
    numResults:         5,
    category:           'company',
    includeDomains:     ['example.com'],
    excludeDomains:     ['spam.com'],
    startPublishedDate: '2024-01-01',
    endPublishedDate:   '2024-12-31',
    userLocation:       'US',
    contents:           { summary: { query: 'funding stage' } },
  });
  assert.equal(body.type,               'neural');
  assert.equal(body.numResults,         5);
  assert.equal(body.category,           'company');
  assert.deepEqual(body.includeDomains, ['example.com']);
  assert.deepEqual(body.excludeDomains, ['spam.com']);
  assert.equal(body.startPublishedDate, '2024-01-01');
  assert.equal(body.endPublishedDate,   '2024-12-31');
  assert.equal(body.userLocation,       'US');
  assert.deepEqual(body.contents,       { summary: { query: 'funding stage' } });
});

test('buildExaRequest omits absent optional filters', () => {
  const { body } = buildExaRequest('basic query');
  assert.equal('category'           in body, false);
  assert.equal('includeDomains'     in body, false);
  assert.equal('excludeDomains'     in body, false);
  assert.equal('startPublishedDate' in body, false);
  assert.equal('endPublishedDate'   in body, false);
  assert.equal('userLocation'       in body, false);
});
