export type SubscriptionType = 'trial' | 'normal' | 'pro';
export type SubscriptionDuration = 'week' | 'month' | 'six-months' | 'year';
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'rejected';

export interface Restaurant {
  id: string;
  managerName: string;
  managerPhone: string;
  restaurantName: string;
  province: string;
  area: string;
  landmark: string;
  subscriptionType: SubscriptionType;
  subscriptionDuration: SubscriptionDuration;
  startDate: string;
  endDate: string;
  monthlyCost: number;
  totalCost: number;
  logoUrl?: string;
  username: string;
  password: string;
  status: 'active' | 'suspended';
  categories?: string[];
  latitude?: number;
  longitude?: number;
  lastShiftResetTime?: number;
  currentOrderNumber?: number;
}

export interface Waiter {
  id: string;
  restaurantId: string;
  name: string;
  phone: string;
  username: string;
  password: string;
  status: 'active' | 'suspended';
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  price: number;
  imageUrl?: string;
  isSpicy: boolean;
  hasCheese: boolean;
  cheesePrice?: number;
  spicyPrice?: number;
  ingredients?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  notes?: string;
  category?: string;
  isAvailable?: boolean;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  cheeseSelected?: boolean;
  spicySelected?: boolean;
  customizationText?: string;
}

export interface Order {
  id: string;
  restaurantId: string;
  customerName: string;
  tableNumber: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  notes?: string;
  createdAt: number;
  orderNumber?: number;
  createdByAI?: boolean;
  clearedForStaff?: boolean;
  rejectedBy?: string;
  rejectedRole?: 'waiter' | 'kitchen';
  rejectionReason?: string;
  deviceMetadata?: {
    userAgent: string;
    deviceType: string;
    screenSize: string;
    language: string;
    fingerprint: string;
    coordinates?: { lat: number; lng: number } | null;
    distanceMeters?: number;
  };
}

export interface SecurityAlert {
  id: string;
  restaurantId: string;
  type: 'outside_range' | 'desktop_device' | 'multi_name_spam' | 'failed_location' | 'suspicious_activity';
  title: string;
  severity: 'info' | 'warning' | 'critical';
  customerName?: string;
  tableNumber?: string;
  timestamp: number;
  deviceMetadata: {
    userAgent: string;
    deviceType: string;
    screenSize: string;
    language: string;
    fingerprint: string;
    coordinates?: { lat: number; lng: number } | null;
    distanceMeters?: number;
  };
  status: 'unread' | 'investigated' | 'resolved';
}

export interface UserSession {
  role: 'admin' | 'restaurant' | 'waiter' | 'kitchen';
  id?: string;
  restaurantId?: string;
  name?: string;
  restaurantName?: string;
}

export interface BannedDevice {
  id: string;
  restaurantId: string;
  fingerprint: string;
  customerName: string;
  bannedBy: string;
  reason: string;
  bannedAt: number;
  deviceType?: string;
}

export interface WaiterRequest {
  id: string;
  restaurantId: string;
  customerName: string;
  tableNumber: string;
  reason: string;
  status: 'pending' | 'accepted' | 'completed';
  waiterId?: string;
  waiterName?: string;
  createdAt: number;
  acceptedAt?: number;
  completedAt?: number;
}

