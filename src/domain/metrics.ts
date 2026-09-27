import type { AppData, Campaign, DailyAdMetric, Order, OrderItem, OrderStatus } from '../types';

export type OrderFinancials = {
  grossProductSales: number;
  finalRevenue: number;
  productCost: number;
  variableCosts: number;
  recognizedCogs: number;
  contributionBeforeAds: number;
};

export type CampaignPerformance = {
  campaign: Campaign;
  adSpend: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  cpm: number;
  cpc: number;
  ctr: number;
  costPerConversation: number;
  costPerLead: number;
  ordersCreated: number;
  confirmedFunnel: number;
  shippedFunnel: number;
  delivered: number;
  cancelled: number;
  returned: number;
  newCustomersDelivered: number;
  confirmationRate: number;
  deliveryRateFromConfirmed: number;
  returnRate: number;
  cpaConfirmed: number;
  cpaDelivered: number;
  cacNewCustomer: number;
  deliveredRevenue: number;
  deliveredCogs: number;
  orderVariableCosts: number;
  contributionBeforeAds: number;
  netProfitAfterAds: number;
  roas: number;
  profitMargin: number;
  breakEvenCpa: number;
  profitPerDeliveredOrder: number;
  cpaVarianceVsTarget: number;
  verdict: 'NO SPEND' | 'NO DELIVERED SALES' | 'LOSS' | 'PROFITABLE' | 'STRONG';
};

export type DashboardSummary = {
  adSpend: number;
  deliveredRevenue: number;
  netProfit: number;
  roas: number;
  deliveredOrders: number;
  cpaDelivered: number;
  cacNewCustomer: number;
  breakEvenCpa: number;
  ordersCreated: number;
  returnedOrders: number;
};

const confirmedStatuses: OrderStatus[] = ['Confirmed', 'Shipped', 'Delivered', 'Returned'];
const shippedStatuses: OrderStatus[] = ['Shipped', 'Delivered', 'Returned'];

export function safeDiv(value: number, divisor: number) {
  return divisor ? value / divisor : 0;
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function orderGross(items: OrderItem[]) {
  return sum(items.map((item) => item.quantity * item.unitPrice));
}

export function orderProductCost(items: OrderItem[]) {
  return sum(items.map((item) => item.quantity * item.unitCost));
}

export function calculateOrderFinancials(order: Order): OrderFinancials {
  const grossProductSales = orderGross(order.items);
  const productCost = orderProductCost(order.items);
  const variableCosts =
    order.packagingCost +
    order.outboundShippingPaid +
    order.codPaymentFee +
    order.failedReturnCost +
    order.otherVariableCost;
  const finalRevenue =
    order.status === 'Delivered' ? Math.max(0, grossProductSales - order.discount) + order.shippingCollected : 0;
  const recognizedCogs = order.status === 'Delivered' ? productCost : 0;

  return {
    grossProductSales,
    finalRevenue,
    productCost,
    variableCosts,
    recognizedCogs,
    contributionBeforeAds: finalRevenue - recognizedCogs - variableCosts,
  };
}

export function calculateDailyMetrics(row: DailyAdMetric) {
  return {
    cpm: safeDiv(row.spend, row.impressions) * 1000,
    cpc: safeDiv(row.spend, row.clicks),
    ctr: safeDiv(row.clicks, row.impressions),
    costPerConversation: safeDiv(row.spend, row.conversations),
    costPerLead: safeDiv(row.spend, row.leads),
  };
}

export function calculateCampaignPerformance(data: AppData): CampaignPerformance[] {
  return data.campaigns.map((campaign) => {
    const dailyRows = data.dailyAds.filter((row) => row.campaignCode.trim() === campaign.code.trim());
    const orders = data.orders.filter((order) => order.campaignCode?.trim() === campaign.code.trim());
    const orderFinancials = orders.map(calculateOrderFinancials);
    const adSpend = sum(dailyRows.map((row) => row.spend));
    const impressions = sum(dailyRows.map((row) => row.impressions));
    const clicks = sum(dailyRows.map((row) => row.clicks));
    const conversations = sum(dailyRows.map((row) => row.conversations));
    const leads = sum(dailyRows.map((row) => row.leads));
    const confirmedFunnel = orders.filter((order) => confirmedStatuses.includes(order.status)).length;
    const shippedFunnel = orders.filter((order) => shippedStatuses.includes(order.status)).length;
    const delivered = orders.filter((order) => order.status === 'Delivered').length;
    const cancelled = orders.filter((order) => order.status === 'Cancelled').length;
    const returned = orders.filter((order) => order.status === 'Returned').length;
    const newCustomersDelivered = orders.filter((order) => order.newAcquisition && order.status === 'Delivered').length;
    const deliveredRevenue = sum(orderFinancials.map((row) => row.finalRevenue));
    const deliveredCogs = sum(orderFinancials.map((row) => row.recognizedCogs));
    const orderVariableCosts = sum(orderFinancials.map((row) => row.variableCosts));
    const contributionBeforeAds = deliveredRevenue - deliveredCogs - orderVariableCosts;
    const netProfitAfterAds = contributionBeforeAds - adSpend;
    const cpaDelivered = safeDiv(adSpend, delivered);
    const roas = safeDiv(deliveredRevenue, adSpend);
    const breakEvenCpa = safeDiv(contributionBeforeAds, delivered);
    const targetCpaOk = !campaign.targetCpaDelivered || cpaDelivered <= campaign.targetCpaDelivered;
    const targetRoasOk = !campaign.targetRoas || roas >= campaign.targetRoas;
    const verdict =
      adSpend === 0
        ? 'NO SPEND'
        : delivered === 0
          ? 'NO DELIVERED SALES'
          : netProfitAfterAds <= 0 || cpaDelivered > breakEvenCpa
            ? 'LOSS'
            : targetCpaOk && targetRoasOk
              ? 'STRONG'
              : 'PROFITABLE';

    return {
      campaign,
      adSpend,
      impressions,
      clicks,
      conversations,
      leads,
      cpm: safeDiv(adSpend, impressions) * 1000,
      cpc: safeDiv(adSpend, clicks),
      ctr: safeDiv(clicks, impressions),
      costPerConversation: safeDiv(adSpend, conversations),
      costPerLead: safeDiv(adSpend, leads),
      ordersCreated: orders.length,
      confirmedFunnel,
      shippedFunnel,
      delivered,
      cancelled,
      returned,
      newCustomersDelivered,
      confirmationRate: safeDiv(confirmedFunnel, orders.length),
      deliveryRateFromConfirmed: safeDiv(delivered, confirmedFunnel),
      returnRate: safeDiv(returned, shippedFunnel),
      cpaConfirmed: safeDiv(adSpend, confirmedFunnel),
      cpaDelivered,
      cacNewCustomer: safeDiv(adSpend, newCustomersDelivered),
      deliveredRevenue,
      deliveredCogs,
      orderVariableCosts,
      contributionBeforeAds,
      netProfitAfterAds,
      roas,
      profitMargin: safeDiv(netProfitAfterAds, deliveredRevenue),
      breakEvenCpa,
      profitPerDeliveredOrder: safeDiv(netProfitAfterAds, delivered),
      cpaVarianceVsTarget: campaign.targetCpaDelivered ? cpaDelivered / campaign.targetCpaDelivered - 1 : 0,
      verdict,
    };
  });
}

export function calculateDashboardSummary(data: AppData): DashboardSummary {
  const campaigns = calculateCampaignPerformance(data);
  const deliveredOrders = sum(campaigns.map((row) => row.delivered));
  const adSpend = sum(campaigns.map((row) => row.adSpend));
  const deliveredRevenue = sum(campaigns.map((row) => row.deliveredRevenue));
  const contributionBeforeAds = sum(campaigns.map((row) => row.contributionBeforeAds));
  const newCustomersDelivered = sum(campaigns.map((row) => row.newCustomersDelivered));

  return {
    adSpend,
    deliveredRevenue,
    netProfit: sum(campaigns.map((row) => row.netProfitAfterAds)),
    roas: safeDiv(deliveredRevenue, adSpend),
    deliveredOrders,
    cpaDelivered: safeDiv(adSpend, deliveredOrders),
    cacNewCustomer: safeDiv(adSpend, newCustomersDelivered),
    breakEvenCpa: safeDiv(contributionBeforeAds, deliveredOrders),
    ordersCreated: data.orders.length,
    returnedOrders: data.orders.filter((order) => order.status === 'Returned').length,
  };
}

export function productPerformance(data: AppData) {
  const grouped = new Map<string, { product: string; quantity: number; revenue: number; profit: number }>();

  data.orders
    .filter((order) => order.status === 'Delivered')
    .forEach((order) => {
      order.items.forEach((item) => {
        const key = item.productName;
        const current = grouped.get(key) ?? { product: key, quantity: 0, revenue: 0, profit: 0 };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.unitPrice;
        current.profit += item.quantity * (item.unitPrice - item.unitCost);
        grouped.set(key, current);
      });
    });

  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity);
}

export function sizePerformance(data: AppData) {
  const grouped = new Map<string, { size: string; quantity: number; revenue: number }>();

  data.orders
    .filter((order) => order.status === 'Delivered')
    .forEach((order) => {
      order.items.forEach((item) => {
        const current = grouped.get(item.size) ?? { size: item.size, quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.unitPrice;
        grouped.set(item.size, current);
      });
    });

  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity);
}
