'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi, googleAuthApi } from '@/lib/api';

export function useAuth() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await authApi.me();
      return res.data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async () => {
      const res = await authApi.getLoginUrl();
      window.location.href = res.data.authUrl;
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/';
    },
  });
}

export function useGoogleStatus() {
  return useQuery({
    queryKey: ['auth', 'google', 'status'],
    queryFn: async () => (await googleAuthApi.status()).data,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useConnectGoogle() {
  return useMutation({
    mutationFn: async () => {
      const res = await googleAuthApi.getLoginUrl();
      window.location.href = res.data.authUrl;
    },
  });
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: googleAuthApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'google', 'status'] });
    },
  });
}
