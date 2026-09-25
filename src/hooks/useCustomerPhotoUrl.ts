import { useEffect, useMemo, useState } from 'react';
import { config } from '@/lib/config';
import {
  bumpCustomerPhotoCache,
  cacheCustomerPhotoDataUrl,
  customerPhotoCacheVersion,
  pickLatestApiPhoto,
  pickLatestMockPhoto,
  readCachedCustomerPhotoDataUrl,
  subscribeCustomerPhotoCache,
} from '@/lib/customerPhoto';
import { useData } from '@/mock/DataContext';
import { documentApi } from '@/services/documentApi';

export { bumpCustomerPhotoCache };

export function useCustomerPhotoUrl(customerId?: number | null): string | null {
  const { documents } = useData();
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [cacheVer, setCacheVer] = useState(customerPhotoCacheVersion);

  useEffect(() => subscribeCustomerPhotoCache(() => setCacheVer(customerPhotoCacheVersion())), []);

  const cachedUrl = useMemo(() => {
    if (!customerId) return null;
    return readCachedCustomerPhotoDataUrl(customerId);
  }, [customerId, cacheVer]);

  const mockUrl = useMemo(() => {
    if (!customerId || config.useApi) return cachedUrl;
    const doc = pickLatestMockPhoto(documents, customerId);
    const url = doc?.dataUrl ?? cachedUrl;
    if (doc?.dataUrl?.startsWith('data:image/')) cacheCustomerPhotoDataUrl(customerId, doc.dataUrl);
    return url;
  }, [customerId, documents, cachedUrl]);

  useEffect(() => {
    if (!customerId || !config.useApi) {
      setApiUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const list = await documentApi.list(customerId);
        const photo = pickLatestApiPhoto(list);
        if (!photo || cancelled) {
          if (!cancelled) setApiUrl(null);
          return;
        }
        const blob = await documentApi.fetchBlob(customerId, photo.id);
        if (cancelled) return;
        if (blob.type.startsWith('image/')) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          if (!cancelled) cacheCustomerPhotoDataUrl(customerId, dataUrl);
        }
        objectUrl = URL.createObjectURL(blob);
        setApiUrl(objectUrl);
      } catch {
        if (!cancelled) setApiUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setApiUrl(null);
    };
  }, [customerId, cacheVer]);

  if (config.useApi) return apiUrl ?? cachedUrl;
  return mockUrl;
}
