'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emailsApi, filesApi, attachmentsApi, EmailFilters } from '@/lib/api';

export function useStats() {
  return useQuery({
    queryKey: ['emails', 'stats'],
    queryFn: async () => {
      const res = await emailsApi.stats();
      return res.data;
    },
    refetchInterval: 15 * 1000, // poll every 15s
  });
}

export function useEmails(filters?: EmailFilters) {
  return useQuery({
    queryKey: ['emails', 'list', filters],
    queryFn: async () => {
      const res = await emailsApi.list(filters);
      return res.data;
    },
    refetchInterval: 15 * 1000,
  });
}

export function useFiles() {
  return useQuery({
    queryKey: ['files'],
    queryFn: async () => {
      const res = await filesApi.list();
      return res.data;
    },
  });
}

export function useCancelEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emailsApi.cancel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

export function useRetryEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emailsApi.retry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

export function useDeleteEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emailsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

export function useScheduleEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emailsApi.schedule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useUploadFile() {
  return useMutation({
    mutationFn: filesApi.upload,
  });
}

export function useUploadContacts() {
  return useMutation({
    mutationFn: filesApi.uploadContacts,
  });
}

export function useScheduleCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emailsApi.scheduleCampaign,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useSendTest() {
  return useMutation({
    mutationFn: emailsApi.sendTest,
  });
}

export function useAttachments() {
  return useQuery({
    queryKey: ['attachments'],
    queryFn: async () => {
      const res = await attachmentsApi.list();
      return res.data;
    },
  });
}

export function useUploadAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: FileList | File[]) => attachmentsApi.upload(files),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments'] }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: attachmentsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments'] }),
  });
}
