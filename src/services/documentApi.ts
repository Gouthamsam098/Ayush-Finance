/**
 * Document API calls mapped to /api/v1/customers/{id}/documents.
 * Files are uploaded as multipart form data and downloaded as raw bytes.
 */

import { api } from '@/lib/api';

export type DocumentType = 'AADHAAR' | 'PAN' | 'LICENSE' | 'RC' | 'PROPERTY';

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
};
