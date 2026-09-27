export type OrderStatus =
  | 'New'
  | 'Converted'
  | 'Confirmed'
  | 'Shipped'
  | 'Delivered'
  | 'Cancelled'
  | 'Returned';

export type CampaignStatus = 'Draft' | 'Active' | 'Paused' | 'Finished';

export type Campaign = {
  id: string;
  code: string;
  name: string;
  brandProduct: string;
  platform: string;
  adType: string;
  objective: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  targetCpaDelivered: number;
  targetRoas: number;
  notes?: string;
};

export type DailyAdMetric = {
  id: string;
  campaignCode: string;
  date: string;
  platform: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  addToCart: number;
  platformPurchases: number;
  notes?: string;
};

export type Customer = {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  secondPhone?: string;
  city: string;
  address: string;
  customerType: 'New' | 'Returning';
  notes?: string;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  defaultCost: number;
  variants: ProductVariant[];
};

export type ProductVariant = {
  id: string;
  size: string;
  unitPrice: number;
  unitCost: number;
};

export type OrderItem = {
  id: string;
  productId?: string;
  productName: string;
  size: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
};

export type OrderStatusEvent = {
  id: string;
  status: OrderStatus;
  changedAt: string;
  note?: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  orderDate: string;
  campaignCode: string | null;
  customerId: string;
  channel: string;
  newAcquisition: boolean;
  status: OrderStatus;
  discount: number;
  shippingCollected: number;
  packagingCost: number;
  outboundShippingPaid: number;
  codPaymentFee: number;
  failedReturnCost: number;
  otherVariableCost: number;
  notes?: string;
  items: OrderItem[];
  statusHistory: OrderStatusEvent[];
};

export type AppData = {
  campaigns: Campaign[];
  dailyAds: DailyAdMetric[];
  customers: Customer[];
  products: Product[];
  orders: Order[];
};
