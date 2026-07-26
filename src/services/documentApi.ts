/**
 * Document API calls mapped to /api/v1/customers/{id}/documents.
 * Files are uploaded as multipart form data and downloaded as raw bytes.
 */

import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { tokenStore } from '@/lib/tokenStore';

export type DocumentType = 'AADHAAR' | 'PAN' | 'LICENSE' | 'RC' | 'PROPERTY' | 'PHOTO' | 'OTHER';

export interface CustomerDocument {
  id: number;
  type: DocumentType;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export const documentApi = {
  async list(customerId: number): Promise<CustomerDocument[]> {
    return (await api.get<CustomerDocument[]>(`/customers/${customerId}/documents`)) ?? [];
  },

  async upload(customerId: number, type: DocumentType, file: File): Promise<CustomerDocument> {
    const fd = new FormData();
    fd.append('type', type);
    fd.append('file', file);
    return api.upload<CustomerDocument>(`/customers/${customerId}/documents`, fd);
  },

  async remove(customerId: number, docId: number): Promise<void> {
    await api.delete(`/customers/${customerId}/documents/${docId}`);
  },

  /** URL to open/download a stored document (auth token is sent by the browser
   *  only for same-origin; for cross-origin, open programmatically instead). */
  downloadUrl(customerId: number, docId: number): string {
    return api.url(`/customers/${customerId}/documents/${docId}/download`);
  },

  /** Fetch the stored file as a Blob WITH the Bearer token (the download endpoint
   *  is auth-protected, so a plain <a href download> would 401). */
  async fetchBlob(customerId: number, docId: number): Promise<Blob> {
    const headers: Record<string, string> = {};
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${config.apiBaseUrl}/customers/${customerId}/documents/${docId}/download`, { headers });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return res.blob();
  },

  /** Download a stored document to the user's device (authenticated). */
  async download(customerId: number, docId: number, fileName: string): Promise<void> {
    const blob = await this.fetchBlob(customerId, docId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || `document-${docId}`; a.click();
    URL.revokeObjectURL(url);
  },
};
