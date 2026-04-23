import { api } from './api';

export interface PortalUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  userRoles?: Array<{ role: { name: string } }>;
}

export const usersApi = {
  list: () =>
    api.get<PortalUser[]>('/users').then((r) => r.data),

  create: (data: { email: string; password: string; firstName?: string; lastName?: string; roleName: string }) =>
    api.post<{ userId: string }>('/users/create', data).then((r) => r.data),

  invite: (data: { email: string; firstName: string; lastName: string; roleName: string }) =>
    api.post<{ userId: string; tempPassword: string }>('/users/invite', data).then((r) => r.data),

  deactivate: (id: string) =>
    api.delete(`/users/${id}`).then((r) => r.data),
};
