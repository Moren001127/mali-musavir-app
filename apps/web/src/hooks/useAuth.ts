'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi, saveTokens, clearTokens } from '@/lib/auth';
import { useRouter } from 'next/navigation';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (data) => {
      saveTokens(data.accessToken, data.refreshToken);
      queryClient.setQueryData(['me'], data.user);
      router.push('/panel');
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clearTokens();
      queryClient.clear();
      router.push('/giris');
    },
  });
}
