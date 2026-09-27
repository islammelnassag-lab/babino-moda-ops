import { demoData } from '../data/demoData';
import type { AppData, Campaign, Customer, DailyAdMetric, Order, OrderStatusEvent, Product } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

const storageKey = 'babino-moda-ops-data-v1';
let activeOrganizationId: string | undefined;

function organizationId() {
  return activeOrganizationId || (import.meta.env.VITE_SUPABASE_ORG_ID as string | undefined);
}

export function setActiveOrganizationId(organizationId: string | undefined) {
  activeOrganizationId = organizationId;
}

function canPersist() {
  return Boolean(isSupabaseConfigured && supabase && organizationId());
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function customerCode(customer: Pick<Customer, 'id' | 'phone'> & Partial<Customer>) {
  return customer.customerCode || `CUS-${customer.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function normalizeData(data: AppData): AppData {
  return {
    ...data,
    customers: data.customers.map((customer) => ({
      ...customer,
      customerCode: customerCode(customer),
    })),
    products: data.products.map((product) => ({
      ...product,
      variants: product.variants ?? [],
    })),
    orders: data.orders.map((order) => ({
      ...order,
      campaignCode: order.campaignCode ?? null,
    })),
  };
}

export function loadLocalData(): AppData {
  const cached = localStorage.getItem(storageKey);
  if (!cached) return demoData;

  try {
    return normalizeData(JSON.parse(cached) as AppData);
  } catch {
    return demoData;
  }
}

export function saveLocalData(data: AppData) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

export async function loadCloudData(): Promise<AppData | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const orgId = organizationId();
  if (!orgId) return null;

  const [campaigns, dailyAds, customers, products, orders] = await Promise.all([
    supabase.from('campaigns').select('*').eq('organization_id', orgId).order('start_date'),
    supabase.from('daily_ad_metrics').select('*').eq('organization_id', orgId).order('date'),
    supabase.from('customers').select('*').eq('organization_id', orgId).order('name'),
    supabase.from('products').select('*, product_variants(*)').eq('organization_id', orgId).order('name'),
    supabase
      .from('orders')
      .select('*, order_items(*), order_status_events(*)')
      .eq('organization_id', orgId)
      .order('order_date', { ascending: false }),
  ]);

  if (campaigns.error || dailyAds.error || customers.error || products.error || orders.error) {
    throw campaigns.error ?? dailyAds.error ?? customers.error ?? products.error ?? orders.error;
  }

  return {
    campaigns: (campaigns.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      brandProduct: row.brand_product ?? '',
      platform: row.platform ?? '',
      adType: row.ad_type ?? '',
      objective: row.objective ?? '',
      startDate: row.start_date ?? '',
      endDate: row.end_date ?? '',
      status: row.status,
      targetCpaDelivered: Number(row.target_cpa_delivered ?? 0),
      targetRoas: Number(row.target_roas ?? 0),
      notes: row.notes ?? '',
    })),
    dailyAds: (dailyAds.data ?? []).map((row: any) => ({
      id: row.id,
      campaignCode: row.campaign_code ?? null,
      date: row.date,
      platform: row.platform ?? '',
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversations: Number(row.conversations ?? 0),
      leads: Number(row.leads ?? 0),
      addToCart: Number(row.add_to_cart ?? 0),
      platformPurchases: Number(row.platform_purchases ?? 0),
      notes: row.notes ?? '',
    })),
    customers: (customers.data ?? []).map((row: any) => ({
      id: row.id,
      customerCode: row.customer_code ?? `CUS-${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      name: row.name,
      phone: row.phone,
      secondPhone: row.second_phone ?? '',
      city: row.city ?? '',
      address: row.address ?? '',
      customerType: row.customer_type,
      notes: row.notes ?? '',
    })),
    products: (products.data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      category: row.category ?? '',
      defaultCost: Number(row.default_cost ?? 0),
      variants: (row.product_variants ?? []).map((variant: any) => ({
        id: variant.id,
        size: variant.size,
        unitPrice: Number(variant.unit_price ?? 0),
        unitCost: Number(variant.unit_cost ?? row.default_cost ?? 0),
      })),
    })),
    orders: (orders.data ?? []).map((row: any) => ({
      id: row.id,
      orderNumber: row.order_number,
      orderDate: row.order_date,
      campaignCode: row.campaign_code,
      customerId: row.customer_id,
      channel: row.channel ?? '',
      newAcquisition: Boolean(row.new_acquisition),
      status: row.status,
      discount: Number(row.discount ?? 0),
      shippingCollected: Number(row.shipping_collected ?? 0),
      packagingCost: Number(row.packaging_cost ?? 0),
      outboundShippingPaid: Number(row.outbound_shipping_paid ?? 0),
      codPaymentFee: Number(row.cod_payment_fee ?? 0),
      failedReturnCost: Number(row.failed_return_cost ?? 0),
      otherVariableCost: Number(row.other_variable_cost ?? 0),
      notes: row.notes ?? '',
      items: (row.order_items ?? []).map((item: any) => ({
        id: item.id,
        productId: item.product_id ?? '',
        productName: item.product_name,
        size: item.size,
        color: item.color ?? '',
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unit_price ?? 0),
        unitCost: Number(item.unit_cost ?? 0),
      })),
      statusHistory: (row.order_status_events ?? []).map((event: any) => ({
        id: event.id,
        status: event.status,
        changedAt: event.changed_at,
        note: event.note ?? '',
      })),
    })),
  };
}

export async function loadOrganizations() {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createOrganization(name: string) {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('No authenticated user');

  const { data, error } = await supabase
    .from('organizations')
    .insert({ name, created_by: userId })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
}

export async function persistCampaign(campaign: Campaign) {
  if (!canPersist() || !supabase) return;

  const { error } = await supabase.from('campaigns').upsert({
    id: campaign.id,
    organization_id: organizationId(),
    code: campaign.code,
    name: campaign.name,
    brand_product: campaign.brandProduct,
    platform: campaign.platform,
    ad_type: campaign.adType,
    objective: campaign.objective,
    start_date: campaign.startDate || null,
    end_date: campaign.endDate || null,
    status: campaign.status,
    target_cpa_delivered: campaign.targetCpaDelivered,
    target_roas: campaign.targetRoas,
    notes: campaign.notes ?? null,
  });
  if (error) throw error;
}

export async function persistDailyAd(row: DailyAdMetric) {
  if (!canPersist() || !supabase) return;

  const { error } = await supabase.from('daily_ad_metrics').upsert({
    id: row.id,
    organization_id: organizationId(),
    campaign_code: row.campaignCode,
    date: row.date,
    platform: row.platform,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    conversations: row.conversations,
    leads: row.leads,
    add_to_cart: row.addToCart,
    platform_purchases: row.platformPurchases,
    notes: row.notes ?? null,
  });
  if (error) throw error;
}

export async function persistCustomer(customer: Customer) {
  if (!canPersist() || !supabase) return;

  const { error } = await supabase.from('customers').upsert({
    id: customer.id,
    organization_id: organizationId(),
    customer_code: customer.customerCode,
    name: customer.name,
    phone: customer.phone,
    phone_digits: normalizePhone(customer.phone),
    second_phone: customer.secondPhone ?? null,
    city: customer.city,
    address: customer.address,
    customer_type: customer.customerType,
    notes: customer.notes ?? null,
  });
  if (error) throw error;
}

export async function persistProduct(product: Product) {
  if (!canPersist() || !supabase) return;

  const orgId = organizationId();
  const variants = product.variants ?? [];
  const { error } = await supabase.from('products').upsert({
    id: product.id,
    organization_id: orgId,
    name: product.name,
    category: product.category,
    default_cost: variants[0]?.unitCost ?? product.defaultCost,
  });
  if (error) throw error;

  const { error: deleteVariantsError } = await supabase
    .from('product_variants')
    .delete()
    .eq('product_id', product.id)
    .eq('organization_id', orgId);
  if (deleteVariantsError) throw deleteVariantsError;

  if (variants.length) {
    const { error: variantsError } = await supabase.from('product_variants').upsert(
      variants.map((variant) => ({
        id: variant.id,
        organization_id: orgId,
        product_id: product.id,
        size: variant.size,
        unit_price: variant.unitPrice,
        unit_cost: variant.unitCost,
      })),
    );
    if (variantsError) throw variantsError;
  }
}

export async function persistOrder(order: Order) {
  if (!canPersist() || !supabase) return;

  const orgId = organizationId();
  const { error: orderError } = await supabase.from('orders').upsert({
    id: order.id,
    organization_id: orgId,
    order_number: order.orderNumber,
    order_date: order.orderDate,
    campaign_code: order.campaignCode || null,
    customer_id: order.customerId,
    channel: order.channel,
    new_acquisition: order.newAcquisition,
    status: order.status,
    discount: order.discount,
    shipping_collected: order.shippingCollected,
    packaging_cost: order.packagingCost,
    outbound_shipping_paid: order.outboundShippingPaid,
    cod_payment_fee: order.codPaymentFee,
    failed_return_cost: order.failedReturnCost,
    other_variable_cost: order.otherVariableCost,
    notes: order.notes ?? null,
  });
  if (orderError) throw orderError;

  const { error: deleteItemsError } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', order.id)
    .eq('organization_id', orgId);
  if (deleteItemsError) throw deleteItemsError;

  if (order.items.length) {
    const { error } = await supabase.from('order_items').upsert(
      order.items.map((item) => ({
        id: item.id,
        organization_id: orgId,
        order_id: order.id,
        product_id: item.productId || null,
        product_name: item.productName,
        size: item.size,
        color: item.color ?? null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit_cost: item.unitCost,
      })),
    );
    if (error) throw error;
  }

  if (order.statusHistory.length) {
    const { error } = await supabase.from('order_status_events').upsert(
      order.statusHistory.map((event) => ({
        id: event.id,
        organization_id: orgId,
        order_id: order.id,
        status: event.status,
        changed_at: event.changedAt,
        note: event.note ?? null,
      })),
    );
    if (error) throw error;
  }
}

export async function persistOrderStatus(orderId: string, event: OrderStatusEvent) {
  if (!canPersist() || !supabase) return;

  const orgId = organizationId();
  const { error: orderError } = await supabase
    .from('orders')
    .update({ status: event.status })
    .eq('id', orderId)
    .eq('organization_id', orgId);
  if (orderError) throw orderError;

  const { error } = await supabase.from('order_status_events').insert({
    id: event.id,
    organization_id: orgId,
    order_id: orderId,
    status: event.status,
    changed_at: event.changedAt,
    note: event.note ?? null,
  });
  if (error) throw error;
}

export async function deleteCampaign(campaignId: string) {
  if (!canPersist() || !supabase) return;
  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('code')
    .eq('id', campaignId)
    .eq('organization_id', organizationId())
    .single();
  if (fetchError) throw fetchError;

  const { error: ordersError } = await supabase
    .from('orders')
    .update({ campaign_code: null })
    .eq('campaign_code', campaign.code)
    .eq('organization_id', organizationId());
  if (ordersError) throw ordersError;

  const { error: adsError } = await supabase
    .from('daily_ad_metrics')
    .delete()
    .eq('campaign_code', campaign.code)
    .eq('organization_id', organizationId());
  if (adsError) throw adsError;

  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId).eq('organization_id', organizationId());
  if (error) throw error;
}

export async function deleteDailyAd(rowId: string) {
  if (!canPersist() || !supabase) return;
  const { error } = await supabase.from('daily_ad_metrics').delete().eq('id', rowId).eq('organization_id', organizationId());
  if (error) throw error;
}

export async function deleteCustomer(customerId: string) {
  if (!canPersist() || !supabase) return;
  const { error } = await supabase.from('customers').delete().eq('id', customerId).eq('organization_id', organizationId());
  if (error) throw error;
}

export async function deleteProduct(productId: string) {
  if (!canPersist() || !supabase) return;
  const { error } = await supabase.from('products').delete().eq('id', productId).eq('organization_id', organizationId());
  if (error) throw error;
}

export async function deleteOrder(orderId: string) {
  if (!canPersist() || !supabase) return;
  const { error } = await supabase.from('orders').delete().eq('id', orderId).eq('organization_id', organizationId());
  if (error) throw error;
}
