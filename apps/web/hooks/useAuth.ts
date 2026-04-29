'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';

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
