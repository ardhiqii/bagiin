import { useEffect, useRef } from "react";
import { ApiError, apiClient } from "./api";
import { photoFilename } from "./photo-path";

export { photoFilename, photoUrl } from "./photo-path";

export type PhotoReleaseResult = "removed" | "missing" | "in_use" | "invalid";

/** Release an upload that has not yet been attached to a bill. */
export async function releaseStandalonePhoto(path: string | null | undefined): Promise<PhotoReleaseResult> {
  const filename = photoFilename(path);
  if (!filename) return "invalid";
  try {
    await apiClient.photos.remove(filename);
    return "removed";
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return "missing";
    if (error instanceof ApiError && error.status === 409) return "in_use";
    throw error;
  }
}

/**
 * Track uploads during a create flow. `markAttached` removes a path from the
 * orphan set; the unmount cleanup only calls the safe standalone endpoint for
 * the remaining generated filenames.
 */
export class PhotoCleanup {
  private pending = new Map<string, string>();

  track(path: string | null | undefined): void {
    const filename = photoFilename(path);
    if (filename && path) this.pending.set(filename, path);
  }

  markAttached(path: string | null | undefined): void {
    const filename = photoFilename(path);
    if (filename) this.pending.delete(filename);
  }

  markRemoved(path: string | null | undefined): void {
    this.markAttached(path);
  }

  async release(path: string | null | undefined): Promise<PhotoReleaseResult> {
    const filename = photoFilename(path);
    if (!filename) return "invalid";
    this.pending.delete(filename);
    return releaseStandalonePhoto(path);
  }

  async releaseAll(): Promise<void> {
    const paths = [...this.pending.values()];
    this.pending.clear();
    await Promise.allSettled(paths.map(path => releaseStandalonePhoto(path)));
  }
}

export function usePhotoCleanup(): PhotoCleanup {
  const cleanup = useRef<PhotoCleanup>();
  if (!cleanup.current) cleanup.current = new PhotoCleanup();
  useEffect(() => () => {
    void cleanup.current?.releaseAll();
  }, []);
  return cleanup.current;
}
