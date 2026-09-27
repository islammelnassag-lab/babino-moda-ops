import type { CampaignStatus, OrderStatus } from '../types';

export const salesChannels = ['Shopify', 'Facebook', 'Instagram', 'TikTok', 'WhatsApp', 'محل', 'جملة', 'أخرى'];
export const adPlatforms = ['Facebook', 'Instagram', 'TikTok', 'Google', 'WhatsApp'];
export const adTypes = ['Boosted Post / Ads Manager', 'Boosted Post', 'Ads Manager', 'Catalog Sales', 'Messages Campaign', 'Traffic Campaign'];
export const adObjectives = ['Messages', 'Sales', 'Leads', 'Traffic', 'Awareness', 'Engagement'];
export const customerTypes = [
  { value: 'New', label: 'جديد' },
  { value: 'Returning', label: 'عميل سابق' },
] as const;
export const orderStatuses: OrderStatus[] = ['New', 'Converted', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
export const campaignStatuses: CampaignStatus[] = ['Draft', 'Active', 'Paused', 'Finished'];

export const orderStatusLabels: Record<OrderStatus, string> = {
  New: 'جديد',
  Converted: 'مؤكد',
  Confirmed: 'تم التأكيد',
  Shipped: 'تم الشحن',
  Delivered: 'تم التسليم',
  Cancelled: 'ملغي',
  Returned: 'مرتجع',
};
