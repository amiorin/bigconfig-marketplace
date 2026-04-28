import PocketBase, { type RecordModel } from 'pocketbase';

const url = import.meta.env.PUBLIC_PB_URL ?? '';

export const pb = new PocketBase(url);

export interface PackageRecord extends RecordModel {
  github_url: string;
  name: string;
  description: string;
  tags: string[];
  submitter: string;
  status: 'pending' | 'approved' | 'rejected';
  stars: number;
  default_branch: string;
  pushed_at: string;
  og_image: string;
  expand?: {
    submitter?: { id: string; name: string; avatar: string };
  };
}
