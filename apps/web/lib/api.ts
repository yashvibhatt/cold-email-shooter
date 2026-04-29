const API_BASE = '/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN',
      data.error?.message ?? `HTTP ${res.status}`,
      res.status
    );
  }

  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  getLoginUrl: () => request<{ authUrl: string }>('/auth/login'),
  me: () => request<{ id: string; email: string; displayName: string }>('/auth/me'),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
};

// ─── Files ────────────────────────────────────────────────────────────────────

export const filesApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new ApiError(data.error?.code ?? 'UPLOAD_ERROR', data.error?.message ?? `HTTP ${res.status}`, res.status);
      }
      return data as ApiResponse<UploadResult>;
    });
  },

  uploadContacts: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${API_BASE}/files/upload-contacts`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new ApiError(data.error?.code ?? 'UPLOAD_ERROR', data.error?.message ?? `HTTP ${res.status}`, res.status);
      }
      return data as ApiResponse<ContactsUploadResult>;
    });
  },

  list: () => request<UploadedFile[]>('/files'),
};

// ─── Emails ───────────────────────────────────────────────────────────────────

export const attachmentsApi = {
  upload: (files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    return fetch(`${API_BASE}/attachments/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new ApiError(data.error?.code ?? 'UPLOAD_ERROR', data.error?.message ?? `HTTP ${res.status}`, res.status);
      }
      return data as ApiResponse<AttachmentInfo[]>;
    });
  },

  list: () => request<AttachmentInfo[]>('/attachments'),

  delete: (id: string) =>
    request<{ message: string }>(`/attachments/${id}`, { method: 'DELETE' }),
};

export const emailsApi = {
  list: (params?: EmailFilters) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<EmailsListResponse>(`/emails${qs}`);
  },

  stats: () => request<StatsResponse>('/emails/stats'),

  schedule: (payload: SchedulePayload) =>
    request<ScheduleResult>('/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  scheduleCampaign: (payload: CampaignPayload) =>
    request<ScheduleResult>('/emails/schedule-campaign', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cancel: (id: string) =>
    request<EmailJob>(`/emails/${id}/cancel`, { method: 'PATCH' }),

  retry: (id: string) =>
    request<{ message: string }>(`/emails/${id}/retry`, { method: 'POST' }),

  delete: (id: string) =>
    request<{ message: string }>(`/emails/${id}`, { method: 'DELETE' }),

  sendTest: (payload: { to: string; subject: string; body: string; attachmentIds?: string[] }) =>
    request<{ message: string }>('/emails/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailStatus = 'PENDING' | 'SCHEDULED' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailJob {
  id: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledDatetime: string;
  timezone: string;
  status: EmailStatus;
  sourceFileId: string | null;
  sentAt: string | null;
  failedReason: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sourceFile?: { id: string; originalName: string } | null;
  sendLogs?: SendLog[];
}

export interface SendLog {
  id: string;
  emailJobId: string;
  status: string;
  message: string;
  createdAt: string;
}

export interface ParsedRow {
  rowIndex: number;
  recipient_email: string;
  subject: string;
  body: string;
  send_date: string;
  send_time: string;
  timezone: string;
  status?: string;
  errors: string[];
  isValid: boolean;
}

export interface UploadResult {
  fileId: string;
  originalName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  missingColumns: string[];
  rows: ParsedRow[];
}

export interface UploadedFile {
  id: string;
  originalName: string;
  rowCount: number;
  createdAt: string;
  _count: { emailJobs: number };
}

export interface SchedulePayload {
  rows: ParsedRow[];
  sourceFileId?: string;
  timezone?: string;
}

export interface ScheduleResult {
  scheduled: number;
  duplicates: number;
  errors: number;
  results: Array<{
    success: boolean;
    recipientEmail: string;
    emailJobId?: string;
    error?: string;
    duplicate?: boolean;
  }>;
}

export interface EmailFilters {
  status?: EmailStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
}

export interface EmailsListResponse {
  emails: EmailJob[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface StatsResponse {
  stats: {
    total: number;
    pending: number;
    scheduled: number;
    sent: number;
    failed: number;
    cancelled: number;
  };
  nextEmail: {
    id: string;
    recipientEmail: string;
    subject: string;
    scheduledDatetime: string;
    timezone: string;
  } | null;
}

export interface ContactRow {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  title: string;
  rowIndex: number;
}

export interface ContactsUploadResult {
  fileId: string;
  originalName: string;
  contacts: ContactRow[];
  totalContacts: number;
  skippedRows: number;
  detectedFormat: string;
}

export interface CampaignPayload {
  contacts: ContactRow[];
  subject: string;
  body: string;
  startDate: string;
  startTime: string;
  timezone: string;
  staggerMinutes: number;
  sourceFileId?: string;
  attachmentIds?: string[];
}

export interface AttachmentInfo {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
}
