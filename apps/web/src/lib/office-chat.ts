import { api } from './api';

export interface OfficeChatUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  lastLoginAt: string | null;
  isCurrent?: boolean;
}

export interface OfficeChatMessage {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
  sender: OfficeChatUser;
}

export interface OfficeChatThread {
  id: string;
  kind: 'GENERAL' | 'DIRECT' | string;
  title: string;
  participants: OfficeChatUser[];
  lastMessage: OfficeChatMessage | null;
  unreadCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface OfficeChatThreadDetail extends OfficeChatThread {
  messages: OfficeChatMessage[];
}

export const officeChatApi = {
  users: () => api.get<OfficeChatUser[]>('/office-chat/users').then((r) => r.data),
  threads: () => api.get<OfficeChatThread[]>('/office-chat/threads').then((r) => r.data),
  thread: (id: string) => api.get<OfficeChatThreadDetail>(`/office-chat/threads/${id}`).then((r) => r.data),
  openDirect: (targetUserId: string) =>
    api.post<OfficeChatThreadDetail>(`/office-chat/direct/${targetUserId}`).then((r) => r.data),
  sendMessage: (threadId: string, content: string) =>
    api.post<{ message: OfficeChatMessage; thread: OfficeChatThreadDetail }>(
      `/office-chat/threads/${threadId}/messages`,
      { content },
    ).then((r) => r.data),
  markRead: (threadId: string) => api.post(`/office-chat/threads/${threadId}/read`).then((r) => r.data),
};
