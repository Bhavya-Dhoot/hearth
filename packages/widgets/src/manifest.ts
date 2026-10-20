/** Shape of dist/ui/manifest.json, as written by scripts/build.ts. */
export interface ManifestEntry {
  /** `<name>-<hash6>.html` */
  file: string;
  /** `ui://hearth/<file>` */
  uri: string;
  /** First 6 hex characters of the sha256 of the file content. */
  hash: string;
  bytes: number;
}

export interface Manifest {
  widgets: Record<string, ManifestEntry>;
}
