import PocketBase from 'pocketbase';
import type { ApplicationRecord } from './pb';

// Build-time helpers. Mirrors lib/packages.ts but for the `applications` collection.

const url = import.meta.env.PUBLIC_PB_URL ?? '';

function client(): PocketBase {
  return new PocketBase(url);
}

export async function fetchApprovedApplications(): Promise<ApplicationRecord[]> {
  if (!url) return [];
  try {
    const records = await client()
      .collection('applications')
      .getFullList<ApplicationRecord>({
        filter: 'status = "approved"',
        sort: '-pushed_at',
        expand: 'submitter',
      });
    return records;
  } catch (err) {
    console.warn(`[applications] Could not reach PocketBase at ${url}; building with empty list.`);
    return [];
  }
}
