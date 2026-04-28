import PocketBase from 'pocketbase';
import type { PackageRecord } from './pb';

// Build-time helpers. Used only inside Astro frontmatter / getStaticPaths.
// Falls back to an empty list if the PB instance is unreachable so local
// builds without a running PB still succeed.

const url = import.meta.env.PUBLIC_PB_URL ?? '';

function client(): PocketBase {
  return new PocketBase(url);
}

export async function fetchApprovedPackages(): Promise<PackageRecord[]> {
  if (!url) return [];
  try {
    const records = await client()
      .collection('packages')
      .getFullList<PackageRecord>({
        filter: 'status = "approved"',
        sort: '-pushed_at',
        expand: 'submitter',
      });
    return records;
  } catch (err) {
    console.warn(`[packages] Could not reach PocketBase at ${url}; building with empty list.`);
    return [];
  }
}

export function ownerRepo(name: string): { owner: string; repo: string } {
  const [owner, ...rest] = name.split('/');
  return { owner: owner ?? '', repo: rest.join('/') };
}
