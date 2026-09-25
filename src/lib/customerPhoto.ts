import type { DocItem } from '@/mock/DataContext';
import type { CustomerDocument } from '@/services/documentApi';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);

export function isCustomerPhotoMime(mime?: string | null): boolean {
  if (!mime) return false;
  return IMAGE_MIMES.has(mime.toLowerCase());
}

function looksLikeImageFileName(name?: string | null): boolean {
  if (!name) return false;
  return /\.(jpe?g|png|webp)$/i.test(name);
}

function isAvatarPhotoMock(d: DocItem): boolean {
  if (d.type !== 'PHOTO' || !d.dataUrl) return false;
  if (d.dataUrl.startsWith('data:image/')) return true;
  return isCustomerPhotoMime(d.mime) || looksLikeImageFileName(d.fileName);
}

const avatarStorageKey = (customerId: number) => `anush.avatar.${customerId}`;

/** Survives mock-book document stripping (localStorage quota) and API customer logins without Documents permission. */
export function cacheCustomerPhotoDataUrl(customerId: number, dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/')) return;
  try {
    localStorage.setItem(avatarStorageKey(customerId), dataUrl);
    bumpCustomerPhotoCache();
  } catch {
    // Quota — avatars still work from in-memory documents this session.
  }
}

export function readCachedCustomerPhotoDataUrl(customerId: number): string | null {
  try {
    const v = localStorage.getItem(avatarStorageKey(customerId));
    return v && v.startsWith('data:image/') ? v : null;
  } catch {
    return null;
  }
}

function isAvatarPhotoApi(d: CustomerDocument): boolean {
  if (d.type !== 'PHOTO') return false;
  return isCustomerPhotoMime(d.mime_type) || looksLikeImageFileName(d.file_name);
}

export function pickLatestMockPhoto(docs: DocItem[], customerId: number): DocItem | undefined {
  return docs
    .filter((d) => d.customerId === customerId && isAvatarPhotoMock(d))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
}

export function pickLatestApiPhoto(docs: CustomerDocument[]): CustomerDocument | undefined {
  return docs
    .filter((d) => isAvatarPhotoApi(d))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
}

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444'];

export function customerAvatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

type Listener = () => void;
const listeners = new Set<Listener>();
let photoCacheVersion = 0;

/** Call after a PHOTO upload/remove so avatars refetch in API mode. */
export function bumpCustomerPhotoCache(): void {
  photoCacheVersion += 1;
  listeners.forEach((l) => l());
}

export function subscribeCustomerPhotoCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function customerPhotoCacheVersion(): number {
  return photoCacheVersion;
}
