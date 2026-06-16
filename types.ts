
export enum UserRole {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  FOLLOW_UP = 'FOLLOW_UP',
  TECHNICAL = 'TECHNICAL',
  AGENT = 'AGENT'
}

export enum RequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  NEED_INFO = 'NEED_INFO'
}

export interface SubscriptionTier {
  name: string;
  price: number;
  commission: number;
}

export interface User {
  id: string;
  name: string;
  username: string;
  email?: string;
  password?: string;
  role: UserRole;
  phone?: string;
  city?: string;
  avatar?: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface SystemProduct {
  id: string;
  name: string;
  description: string;
  tiers: SubscriptionTier[];
}

export interface SalesRequest {
  id: string;
  agentId: string;
  agentName: string;
  institutionName: string;
  systemId: string;
  systemName: string;
  subscriptionType: string;
  location: string;
  contactName: string;
  contactPhone: string;
  status: RequestStatus;
  rejectionReason?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Institution {
  id: string;
  name: string;
  city: string;
  address: string;
  lastVisitedBy: string;
  lastVisitDate: string;
  offeredSystem?: string; // الحقل الجديد
  status: 'CUSTOMER' | 'INTERESTED' | 'NOT_INTERESTED' | 'REJECTED' | 'LATER';
  rejectionReason?: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'SUCCESS' | 'DANGER' | 'INFO';
  isRead: boolean;
  createdAt: string;
}
