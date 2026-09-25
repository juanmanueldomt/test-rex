// Recognizes requirement URLs of known trackers so they can be shown (and searched) by issue key.
import type { RequirementProvider } from './scenarios';

export interface RecognizedLink {
  provider: RequirementProvider;
  /** `SHOP-481`, `owner/repo#42`, `#123`; null for unknown trackers. */
  issueKey: string | null;
}

export const PROVIDER_LABELS: Record<Exclude<RequirementProvider, 'other'>, string> = {
  jira: 'Jira',
  github: 'GitHub',
  azure_devops: 'Azure DevOps',
};

/** Whether the text is an absolute http(s) URL (the only schemes accepted for links). */
export function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function recognizeRequirementLink(text: string): RecognizedLink {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { provider: 'other', issueKey: null };
  }
  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname);

  if (host === 'github.com' || host === 'www.github.com') {
    const match = /^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)(?:\/|$)/.exec(path);
    if (match) return { provider: 'github', issueKey: `${match[1]}/${match[2]}#${match[3]}` };
  }

  // Jira Cloud (*.atlassian.net) and self-managed Jira share the /browse/KEY-1 form.
  const jira = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/.exec(path);
  if (jira) return { provider: 'jira', issueKey: jira[1]!.toUpperCase() };
  const selected = url.searchParams.get('selectedIssue');
  if (host.endsWith('.atlassian.net') && selected && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(selected)) {
    return { provider: 'jira', issueKey: selected.toUpperCase() };
  }

  // Azure DevOps Services (dev.azure.com, *.visualstudio.com) and Azure DevOps Server.
  const ado = /\/_workitems\/edit\/(\d+)(?:\/|$)/i.exec(path);
  if (ado) return { provider: 'azure_devops', issueKey: `#${ado[1]}` };

  return { provider: 'other', issueKey: null };
}

/** Text shown for a link: "Jira · SHOP-481", else its label, else its host. */
export function requirementLinkText(link: {
  url: string;
  label: string | null;
  provider: RequirementProvider;
  issueKey: string | null;
}): string {
  if (link.provider !== 'other' && link.issueKey) {
    return `${PROVIDER_LABELS[link.provider]} · ${link.issueKey}`;
  }
  if (link.label) return link.label;
  try {
    return new URL(link.url).host;
  } catch {
    return link.url;
  }
}
