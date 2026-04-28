/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_PB_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
