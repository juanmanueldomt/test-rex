import { describe, expect, it } from 'vitest';
import { isHttpUrl, recognizeRequirementLink, requirementLinkText } from './links';

describe('recognizeRequirementLink', () => {
  it.each([
    ['https://acme.atlassian.net/browse/SHOP-481', 'jira', 'SHOP-481'],
    ['https://jira.acme.internal/browse/shop-12?focusedCommentId=1', 'jira', 'SHOP-12'],
    [
      'https://acme.atlassian.net/jira/software/projects/SHOP/boards/1?selectedIssue=SHOP-9',
      'jira',
      'SHOP-9',
    ],
    ['https://github.com/acme/shop/issues/42', 'github', 'acme/shop#42'],
    ['https://github.com/acme/shop.web/pull/7/files', 'github', 'acme/shop.web#7'],
    ['https://dev.azure.com/acme/Shop/_workitems/edit/123', 'azure_devops', '#123'],
    ['https://acme.visualstudio.com/Shop/_workitems/edit/55/', 'azure_devops', '#55'],
    ['https://tfs.acme.local/tfs/Default/Shop/_workitems/edit/9', 'azure_devops', '#9'],
  ])('%s → %s %s', (url, provider, issueKey) => {
    expect(recognizeRequirementLink(url)).toEqual({ provider, issueKey });
  });

  it.each([
    'https://wiki.acme.com/checkout',
    'https://github.com/acme/shop',
    'https://github.com/acme/shop/blob/main/README.md',
    'https://acme.atlassian.net/wiki/spaces/SHOP',
    'not a url',
  ])('%s is an unknown tracker', (url) => {
    expect(recognizeRequirementLink(url)).toEqual({ provider: 'other', issueKey: null });
  });
});

describe('isHttpUrl', () => {
  it('accepts only http and https', () => {
    expect(isHttpUrl('https://x.test/a')).toBe(true);
    expect(isHttpUrl('http://x.test')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isHttpUrl('ftp://x.test')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});

describe('requirementLinkText', () => {
  it('shows tracker and key, else the label, else the host', () => {
    const jira = recognizeRequirementLink('https://acme.atlassian.net/browse/SHOP-481');
    expect(
      requirementLinkText({
        url: 'https://acme.atlassian.net/browse/SHOP-481',
        label: null,
        ...jira,
      }),
    ).toBe('Jira · SHOP-481');
    expect(
      requirementLinkText({
        url: 'https://wiki.acme.com/checkout',
        label: 'Checkout rules',
        provider: 'other',
        issueKey: null,
      }),
    ).toBe('Checkout rules');
    expect(
      requirementLinkText({
        url: 'https://wiki.acme.com/checkout',
        label: null,
        provider: 'other',
        issueKey: null,
      }),
    ).toBe('wiki.acme.com');
  });
});
