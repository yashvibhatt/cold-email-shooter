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

// ─── Google / Gmail ─────────────────────────────────────────────────────────────

export const googleAuthApi = {
  getLoginUrl: () => request<{ authUrl: string }>('/auth/google/login'),
  status: () => request<{ configured: boolean; connected: boolean; email: string | null }>('/auth/google/status'),
  disconnect: () => request<{ message: string }>('/auth/google/disconnect', { method: 'POST' }),
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

  sendTest: (payload: { to: string; subject: string; body: string; attachmentIds?: string[]; provider?: EmailProviderType }) =>
    request<{ message: string }>('/emails/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ─── Outreach check ─────────────────────────────────────────────────────────────

export const outreachApi = {
  check: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${API_BASE}/outreach/check`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new ApiError(data.error?.code ?? 'OUTREACH_CHECK_ERROR', data.error?.message ?? `HTTP ${res.status}`, res.status);
      }
      return data as ApiResponse<OutreachCheckResponse>;
    });
  },
};

// ─── Follow-up ───────────────────────────────────────────────────────────────────

export const followUpApi = {
  list: () => request<{ list: FollowUpRow[] }>('/followup'),
  scan: (days = 14) => request<{ flagged: number; resolved: number; list: FollowUpRow[] }>(`/followup/scan?days=${days}`, { method: 'POST' }),
  syncManual: () => request<{ manualSynced: number; checked: number; list: FollowUpRow[] }>('/followup/sync-manual', { method: 'POST' }),
  setFollowedUp: (id: string, followedUp: boolean) =>
    request<FollowUpRow>(`/followup/${id}`, { method: 'PATCH', body: JSON.stringify({ followedUp }) }),
  remove: (id: string) => request<{ message: string }>(`/followup/${id}`, { method: 'DELETE' }),
  send: (id: string, message: string, scheduledAt?: string) =>
    request<FollowUpSendResult>(`/followup/${id}/send`, { method: 'POST', body: JSON.stringify({ message, scheduledAt }) }),
  bulkSend: (ids: string[], message: string, scheduledAt?: string) =>
    request<BulkFollowUpSendResponse>('/followup/bulk-send', { method: 'POST', body: JSON.stringify({ ids, message, scheduledAt }) }),
};

// ─── Sent Log ───────────────────────────────────────────────────────────────────

export const sentLogApi = {
  scan: (since: string, until: string, excludeResponded: boolean) =>
    request<SentLogResponse>(
      `/sent-log?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&excludeResponded=${excludeResponded}`
    ),
  send: (entry: SentLogEntry, message: string, scheduledAt?: string) =>
    request<{ scheduled: boolean; scheduledAt?: string; message?: string }>('/sent-log/send', {
      method: 'POST',
      body: JSON.stringify({ ...entry, message, scheduledAt }),
    }),
  bulkSend: (entries: SentLogEntry[], message: string, scheduledAt?: string) =>
    request<SentLogBulkSendResponse>('/sent-log/bulk-send', {
      method: 'POST',
      body: JSON.stringify({ entries, message, scheduledAt }),
    }),
};

// ─── Analytics ───────────────────────────────────────────────────────────────────

export const analyticsApi = {
  bounces: (since?: string) => {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return request<BouncesResponse>(`/analytics/bounces${qs}`);
  },
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
  provider: EmailProviderType;
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

export type EmailProviderType = 'OUTLOOK' | 'GMAIL';

export interface SchedulePayload {
  rows: ParsedRow[];
  sourceFileId?: string;
  timezone?: string;
  provider?: EmailProviderType;
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
  location: string;
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
  provider?: EmailProviderType;
}

export interface AttachmentInfo {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
}

export interface OutreachResultRow extends ContactRow {
  alreadyContacted: boolean;
  lastContactDate: string | null;
  lastSubject: string | null;
  matchCount: number;
  checkError: string | null;
}

export interface OutreachCheckResponse {
  detectedFormat: string;
  skippedRows: number;
  total: number;
  contacted: number;
  new: number;
  results: OutreachResultRow[];
}

export interface BounceRow {
  recipientEmail: string | null;
  reason: string;
  bounceSubject: string;
  bounceReceivedAt: string;
  source: 'Mail Delivery Subsystem' | 'Other';
  fromAddress: string;
  originalSubject: string | null;
  originalSentAt: string | null;
  matchedEmailJobId: string | null;
}

export interface BouncesResponse {
  since: string;
  totalSentSince: number;
  totalBounced: number;
  bounceRate: number;
  bounces: BounceRow[];
}

export type FollowUpStatusType = 'NO_RESPONSE' | 'OUT_OF_OFFICE' | 'RESPONDED';

export interface FollowUpRow {
  id: string;
  userId: string;
  emailJobId: string;
  recipientEmail: string;
  status: FollowUpStatusType;
  oooNote: string | null;
  oooReturnDate: string | null;
  originalSubject: string;
  originalSentAt: string;
  followedUp: boolean;
  followedUpAt: string | null;
  followUpCount: number;
  lastFollowUpSentAt: string | null;
  lastScannedAt: string;
  createdAt: string;
  updatedAt: string;
  provider: EmailProviderType;
  senderEmail: string | null;
  timezone: string | null;
  company: string | null;
  location: string | null;
}

export interface BulkFollowUpSendResponse {
  scheduled?: boolean;
  sent: number;
  failed: number;
  scheduledCount?: number;
  results: Array<{ id: string; recipientEmail: string; success: boolean; error?: string }>;
}

export type FollowUpSendResult =
  | { scheduled: true; scheduledAt: string; followUp: FollowUpRow }
  | (FollowUpRow & { scheduled: false });

export interface SentLogEntry {
  recipientEmail: string;
  subject: string;
  sentDateTime: string;
}

export interface SentLogResponse {
  since: string;
  until: string;
  totalSent: number;
  excludedCount: number;
  uniqueRecipients: number;
  entries: SentLogEntry[];
  excludedEntries: SentLogEntry[];
}

export interface SentLogBulkSendResponse {
  scheduled?: boolean;
  sent: number;
  failed: number;
  results: Array<{ recipientEmail: string; success: boolean; error?: string }>;
}
