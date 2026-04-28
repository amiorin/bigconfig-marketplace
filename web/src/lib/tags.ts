export interface TagGroup {
  label: string;
  tags: readonly string[];
}

export const TAG_GROUPS: readonly TagGroup[] = [
  {
    label: 'Providers',
    tags: ['digitalocean', 'hcloud', 'oci', 'no-infra', 'cloudflare', 'resend', 's3'],
  },
  {
    label: 'Tools',
    tags: ['opentofu', 'ansible', 'docker'],
  },
  {
    label: 'Category',
    tags: [
      'database',
      'cache',
      'streaming',
      'observability',
      'dev-env',
      'webapp',
      'static-site',
      'email',
      'dns',
      'apps',
    ],
  },
  {
    label: 'License',
    tags: ['open-source', 'source-available'],
  },
] as const;

export const ALL_TAGS: readonly string[] = TAG_GROUPS.flatMap((g) => g.tags);

const TAG_SET = new Set<string>(ALL_TAGS);

export function isKnownTag(t: string): boolean {
  return TAG_SET.has(t);
}
