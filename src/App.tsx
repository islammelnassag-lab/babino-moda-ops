import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Cloud, HardDrive, Plus, Trash2 } from 'lucide-react';
import { demoData } from './data/demoData';
import {
  calculateCampaignPerformance,
  calculateDashboardSummary,
  calculateDailyMetrics,
  calculateOrderFinancials,
  productPerformance,
  sizePerformance,
  sum,
} from './domain/metrics';
import {
  adObjectives,
  adPlatforms,
  adTypes,
  campaignStatuses,
  customerTypes,
  orderStatusLabels,
  orderStatuses,
  salesChannels,
} from './domain/options';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  createOrganization,
  deleteCampaign,
  deleteCustomer,
  deleteDailyAd,
  deleteOrder,
  deleteProduct,
  loadCloudData,
  loadLocalData,
  loadOrganizations,
  persistCampaign,
  persistCustomer,
  persistDailyAd,
  persistOrder,
  persistOrderStatus,
  persistProduct,
  saveLocalData,
  setActiveOrganizationId,
} from './lib/storage';
import type { AppData, Campaign, Customer, DailyAdMetric, Order, OrderItem, OrderStatus, Product, ProductVariant } from './types';

type View = 'orders' | 'campaigns' | 'ads' | 'dashboard' | 'products' | 'customers';

const money = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
const percent = (value: number) => `${number.format(value * 100)}%`;
const navItems: Array<{ view: View; label: string }> = [
  { view: 'orders', label: 'الأوردرات' },
  { view: 'campaigns', label: 'الحملات' },
  { view: 'ads', label: 'الصرف اليومي' },
  { view: 'dashboard', label: 'الداشبورد' },
  { view: 'products', label: 'المنتجات' },
  { view: 'customers', label: 'العملاء' },
];

function id() {
  return crypto.randomUUID();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function viewFromHash(): View {
  const hash = window.location.hash.replace('#', '') as View;
  return navItems.some((item) => item.view === hash) ? hash : 'orders';
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function customerCode(customerId?: string) {
  const seed = customerId || id();
  return `CUS-${seed.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function campaignCode(campaignId?: string) {
  const seed = campaignId || id();
  return `CAM-${seed.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function newOrderItem(): OrderItem {
  return { id: id(), productName: '', size: '', quantity: 1, unitPrice: 0, unitCost: 0 };
}

function newProductVariant(): ProductVariant {
  return { id: id(), size: '', unitPrice: 0, unitCost: 0 };
}

function newCampaign(): Campaign {
  return {
    id: '',
    code: campaignCode(),
    name: '',
    brandProduct: '',
    platform: 'Facebook',
    adType: adTypes[0],
    objective: 'Messages',
    startDate: '',
    endDate: '',
    status: 'Active',
    targetCpaDelivered: 0,
    targetRoas: 0,
    notes: '',
  };
}

function App() {
  const [activeView, setActiveView] = useState<View>(() => viewFromHash());
  const [data, setData] = useState<AppData>(() => loadLocalData());
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured);
  const [isSignedIn, setIsSignedIn] = useState(!isSupabaseConfigured);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudState, setCloudState] = useState<'local' | 'loading' | 'connected' | 'failed'>(
    isSupabaseConfigured ? 'loading' : 'local',
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      setIsSignedIn(Boolean(sessionData.session));
      setSessionReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session));
      setSessionReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!isSupabaseConfigured || !isSignedIn) return;

    loadOrganizations()
      .then(async (orgRows) => {
        if (!mounted) return;
        setOrganizations(orgRows);
        setActiveOrganizationId(import.meta.env.VITE_SUPABASE_ORG_ID || orgRows[0]?.id);
        const cloudData = await loadCloudData();
        if (!mounted) return;
        if (cloudData) {
          setData(cloudData);
          setCloudState('connected');
        } else {
          setCloudState('local');
        }
      })
      .catch(() => mounted && setCloudState('failed'));

    return () => {
      mounted = false;
    };
  }, [isSignedIn]);

  useEffect(() => saveLocalData(data), [data]);
  useEffect(() => {
    const syncView = () => setActiveView(viewFromHash());
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  const summary = useMemo(() => calculateDashboardSummary(data), [data]);
  const campaignRows = useMemo(() => calculateCampaignPerformance(data), [data]);
  const productRows = useMemo(() => productPerformance(data), [data]);
  const sizeRows = useMemo(() => sizePerformance(data), [data]);

  function upsertOrder(order: Order, customer: Customer) {
    setData((current) => {
      const customerPhone = normalizePhone(customer.phone);
      const otherCustomers = current.customers.filter(
        (item) => item.id !== customer.id && normalizePhone(item.phone) !== customerPhone,
      );
      const otherOrders = current.orders.filter((item) => item.id !== order.id);
      return { ...current, customers: [customer, ...otherCustomers], orders: [order, ...otherOrders] };
    });
    persistCustomer(customer).then(() => persistOrder(order)).catch(console.error);
  }

  function removeOrder(orderId: string) {
    setData((current) => ({ ...current, orders: current.orders.filter((order) => order.id !== orderId) }));
    deleteOrder(orderId).catch(console.error);
  }

  function updateOrderStatus(orderId: string, status: OrderStatus) {
    const event = { id: id(), status, changedAt: new Date().toISOString() };
    setData((current) => ({
      ...current,
      orders: current.orders.map((order) =>
        order.id === orderId ? { ...order, status, statusHistory: [...order.statusHistory, event] } : order,
      ),
    }));
    persistOrderStatus(orderId, event).catch(console.error);
  }

  if (!sessionReady) return <LoadingScreen />;
  if (isSupabaseConfigured && !isSignedIn) return <AuthScreen />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-row">
          <h1><BarChart3 size={22} /> متابعة الإعلانات والأوردرات والربحية</h1>
          <div className="connection-card">
            {cloudState === 'connected' ? <Cloud size={16} /> : <HardDrive size={16} />}
            {cloudState === 'connected' ? 'Supabase' : cloudState === 'loading' ? 'تحميل' : 'محلي'}
          </div>
        </div>
        <nav className="tabs">
          {navItems.map((item) => (
            <a className={`tab ${activeView === item.view ? 'active' : ''}`} href={`#${item.view}`} key={item.view}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="workspace">
        {isSupabaseConfigured && organizations.length === 0 && <CreateOrgNotice onCreated={setOrganizations} />}
        {activeView === 'orders' && <OrdersView data={data} onSave={upsertOrder} onDelete={removeOrder} onStatusChange={updateOrderStatus} />}
        {activeView === 'campaigns' && <CampaignsView data={data} setData={setData} rows={campaignRows} />}
        {activeView === 'ads' && <AdsView data={data} setData={setData} />}
        {activeView === 'dashboard' && <Dashboard summary={summary} campaigns={campaignRows} products={productRows} sizes={sizeRows} />}
        {activeView === 'products' && <ProductsView data={data} setData={setData} products={productRows} sizes={sizeRows} />}
        {activeView === 'customers' && <CustomersView data={data} setData={setData} />}
      </main>
    </div>
  );
}

function LoadingScreen() {
  return <div className="auth-shell"><div className="auth-card"><h1>Babino Moda</h1><p>جاري التحميل...</p></div></div>;
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    setMessage(error ? error.message : 'بعتنا لينك الدخول على الإيميل.');
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>Babino Moda</h1>
        <p>ادخل بالإيميل عشان البيانات تتحفظ وتبقى مشتركة بين الفريق.</p>
        <label>الإيميل<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <button className="primary-button" disabled={loading}>{loading ? 'جاري الإرسال' : 'إرسال لينك الدخول'}</button>
        {message && <p className="auth-message">{message}</p>}
      </form>
    </div>
  );
}

function CreateOrgNotice({ onCreated }: { onCreated: (orgs: Array<{ id: string; name: string }>) => void }) {
  const [loading, setLoading] = useState(false);
  async function create() {
    setLoading(true);
    const org = await createOrganization('Babino Moda');
    if (org) {
      setActiveOrganizationId(org.id);
      onCreated([org]);
    }
    setLoading(false);
  }
  return <div className="panel notice"><span>محتاجين ننشئ مساحة العمل أول مرة.</span><button className="primary-button" onClick={create}>{loading ? 'جاري الإنشاء' : 'إنشاء مساحة العمل'}</button></div>;
}

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="panel-header"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label>{label}{children}</label>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi-card"><span>{label}</span><strong>{value}</strong></div>;
}

function OrdersView({
  data,
  onSave,
  onDelete,
  onStatusChange,
}: {
  data: AppData;
  onSave: (order: Order, customer: Customer) => void;
  onDelete: (orderId: string) => void;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
}) {
  const [editing, setEditing] = useState<Order | null>(null);

  return (
    <div className="page-stack">
      <OrderForm key={editing?.id ?? 'new'} data={data} editing={editing} onCancel={() => setEditing(null)} onSave={(order, customer) => {
        onSave(order, customer);
        setEditing(null);
      }} />
      <section className="panel">
        <div className="list-toolbar">
          <PanelHeader title="قائمة الأوردرات" />
          <select aria-label="كل الحالات"><option>كل الحالات</option>{orderStatuses.map((status) => <option key={status}>{orderStatusLabels[status]}</option>)}</select>
        </div>
        <div className="order-list">
          {data.orders.map((order) => {
            const customer = data.customers.find((item) => item.id === order.customerId);
            const financials = calculateOrderFinancials(order);
            const campaign = data.campaigns.find((item) => item.code === order.campaignCode);
            return (
              <article className="order-card" key={order.id}>
                <div className="order-head">
                  <strong>{customer?.name || 'عميل بدون اسم'} - {customer?.phone || 'بدون رقم'}</strong>
                  <span className="pill">{orderStatusLabels[order.status]}</span>
                </div>
                <p>{customer?.address || 'لا يوجد عنوان'} | {order.campaignCode ? `${campaign?.name ?? order.campaignCode}` : 'مباشر / عضوي'} | {order.channel}</p>
                <table>
                  <thead><tr><th>الصنف</th><th>المقاس</th><th>الكمية</th><th>سعر</th><th>تكلفة</th></tr></thead>
                  <tbody>{order.items.map((item) => <tr key={item.id}><td>{item.productName}</td><td>{item.size}</td><td>{item.quantity}</td><td>{number.format(item.unitPrice)}</td><td>{number.format(item.unitCost)}</td></tr>)}</tbody>
                </table>
                <div className="order-summary">
                  <span>إجمالي: {money.format(financials.grossProductSales)}</span>
                  <span>إيراد نهائي: {money.format(financials.finalRevenue)}</span>
                  <span>تكاليف متغيرة: {money.format(financials.variableCosts)}</span>
                  <span>مساهمة: {money.format(financials.contributionBeforeAds)}</span>
                </div>
                <div className="row-actions">
                  <select value={order.status} onChange={(event) => onStatusChange(order.id, event.target.value as OrderStatus)}>
                    {orderStatuses.map((status) => <option value={status} key={status}>{orderStatusLabels[status]}</option>)}
                  </select>
                  <button className="ghost-button" onClick={() => setEditing(order)}>تعديل</button>
                  <button className="danger-button" onClick={() => onDelete(order.id)}>حذف</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OrderForm({ data, editing, onCancel, onSave }: { data: AppData; editing: Order | null; onCancel: () => void; onSave: (order: Order, customer: Customer) => void }) {
  const existingCustomer = editing ? data.customers.find((customer) => customer.id === editing.customerId) : null;
  const firstCampaignCode = data.campaigns[0]?.code ?? '';
  const [customerName, setCustomerName] = useState(existingCustomer?.name ?? '');
  const [phone, setPhone] = useState(existingCustomer?.phone ?? '');
  const [address, setAddress] = useState(existingCustomer?.address ?? '');
  const [customerType, setCustomerType] = useState<Customer['customerType']>(existingCustomer?.customerType ?? 'New');
  const [orderDate, setOrderDate] = useState(editing?.orderDate ?? today());
  const [orderSource, setOrderSource] = useState<'organic' | 'campaign'>(editing?.campaignCode ? 'campaign' : 'organic');
  const [campaignCode, setCampaignCode] = useState(editing?.campaignCode ?? '');
  const [channel, setChannel] = useState(editing?.channel ?? 'Shopify');
  const [status, setStatus] = useState<OrderStatus>(editing?.status ?? 'New');
  const [newAcquisition, setNewAcquisition] = useState(editing?.newAcquisition ?? true);
  const [validationMessage, setValidationMessage] = useState('');
  const [items, setItems] = useState<OrderItem[]>(
    editing?.items.length ? editing.items : [newOrderItem()],
  );
  const [costs, setCosts] = useState({
    discount: editing?.discount ?? 0,
    shippingCollected: editing?.shippingCollected ?? 0,
    packagingCost: editing?.packagingCost ?? 0,
    outboundShippingPaid: editing?.outboundShippingPaid ?? 0,
    codPaymentFee: editing?.codPaymentFee ?? 0,
    failedReturnCost: editing?.failedReturnCost ?? 0,
    otherVariableCost: editing?.otherVariableCost ?? 0,
    notes: editing?.notes ?? '',
  });
  const matchingCustomerByPhone = !editing && phone
    ? data.customers.find((customer) => normalizePhone(customer.phone) === normalizePhone(phone))
    : null;
  const duplicateCustomerForPhone = editing && phone
    ? data.customers.find(
      (customer) => normalizePhone(customer.phone) === normalizePhone(phone) && customer.id !== editing.customerId,
    )
    : null;

  useEffect(() => {
    if (orderSource === 'organic') {
      setCampaignCode('');
      return;
    }

    if (!campaignCode && firstCampaignCode) {
      setCampaignCode(firstCampaignCode);
    }
  }, [campaignCode, firstCampaignCode, orderSource]);

  useEffect(() => {
    if (editing) return;

    const hasKnownPhone = Boolean(phone.trim() && matchingCustomerByPhone);
    setCustomerType(hasKnownPhone ? 'Returning' : 'New');
    setNewAcquisition(!hasKnownPhone);
  }, [editing, matchingCustomerByPhone, phone]);

  function updateItem(itemId: string, patch: Partial<OrderItem>) {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  function updateCustomerType(type: Customer['customerType']) {
    setCustomerType(type);
    setNewAcquisition(type === 'New');
  }

  function selectProduct(itemId: string, productId: string) {
    const product = data.products.find((item) => item.id === productId);
    const variant = product?.variants?.[0];
    updateItem(itemId, {
      productId: product?.id,
      productName: product?.name ?? '',
      size: variant?.size ?? '',
      unitPrice: variant?.unitPrice ?? 0,
      unitCost: variant?.unitCost ?? product?.defaultCost ?? 0,
    });
  }

  function selectSize(item: OrderItem, size: string) {
    const product = data.products.find((productRow) => productRow.id === item.productId || productRow.name === item.productName);
    const variant = product?.variants?.find((row) => row.size === size);
    updateItem(item.id, {
      size,
      unitPrice: variant?.unitPrice ?? item.unitPrice,
      unitCost: variant?.unitCost ?? item.unitCost,
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const selectedCampaignCode = orderSource === 'campaign' ? campaignCode || firstCampaignCode : '';

    if (orderSource === 'campaign' && !selectedCampaignCode) {
      setValidationMessage('لازم تضيف حملة إعلانية الأول أو تختار مصدر الأوردر مباشر / عضوي.');
      return;
    }

    if (duplicateCustomerForPhone) {
      setValidationMessage(`رقم الموبايل ده مسجل بالفعل للعميل ${duplicateCustomerForPhone.name}.`);
      return;
    }

    const linkedCustomer = existingCustomer ?? matchingCustomerByPhone;
    const customerId = linkedCustomer?.id ?? editing?.customerId ?? id();
    const customer: Customer = {
      id: customerId,
      customerCode: linkedCustomer?.customerCode ?? customerCode(customerId),
      name: customerName,
      phone,
      address,
      city: '',
      customerType,
      notes: '',
    };
    const order: Order = {
      id: editing?.id ?? id(),
      orderNumber: editing?.orderNumber ?? `ORD-${Date.now().toString().slice(-6)}`,
      orderDate,
      campaignCode: selectedCampaignCode || null,
      customerId: customer.id,
      channel,
      newAcquisition,
      status,
      ...costs,
      items: items.filter((item) => item.productName.trim() && item.quantity > 0),
      statusHistory: editing?.statusHistory ?? [{ id: id(), status, changedAt: new Date().toISOString() }],
    };
    if (!order.items.length) {
      setValidationMessage('لازم تختار صنف واحد على الأقل في الأوردر.');
      return;
    }
    setValidationMessage('');
    onSave(order, customer);
  }

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <PanelHeader title={editing ? 'تعديل أوردر' : 'إضافة أوردر جديد'} />
      <div className="form-grid three">
        <Field label="تاريخ الأوردر"><input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></Field>
        <Field label="مصدر الأوردر">
          <select value={orderSource} onChange={(event) => setOrderSource(event.target.value as 'organic' | 'campaign')}>
            <option value="organic">مباشر / عضوي</option>
            <option value="campaign">من حملة إعلانية</option>
          </select>
        </Field>
        <Field label="الحملة الإعلانية">
          <select value={campaignCode} disabled={orderSource === 'organic'} onChange={(event) => setCampaignCode(event.target.value)}>
            {!data.campaigns.length && <option value="">لا توجد حملات بعد</option>}
            {data.campaigns.map((campaign) => <option value={campaign.code} key={campaign.id}>{campaign.name} - {campaign.code}</option>)}
          </select>
        </Field>
        <Field label="قناة البيع"><select value={channel} onChange={(event) => setChannel(event.target.value)}>{salesChannels.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="اسم العميل"><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></Field>
        <Field label="رقم الموبايل"><input value={phone} onChange={(event) => setPhone(event.target.value)} required /></Field>
        <Field label="العنوان"><input value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
        <Field label="نوع العميل"><select value={customerType} onChange={(event) => updateCustomerType(event.target.value as Customer['customerType'])}>{customerTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
        <Field label="حالة الأوردر"><select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>{orderStatuses.map((item) => <option value={item} key={item}>{orderStatusLabels[item]}</option>)}</select></Field>
        <label className="checkbox-label"><input checked={newAcquisition} onChange={(event) => setNewAcquisition(event.target.checked)} type="checkbox" /> احسبه اكتساب عميل جديد فعلي</label>
      </div>
      <div className="line-items">
        <div className="section-title"><strong>القطع</strong><button type="button" className="ghost-button" onClick={() => setItems((current) => [...current, newOrderItem()])}><Plus size={14} /> إضافة قطعة</button></div>
        {items.map((item) => {
          const selectedProduct = data.products.find((product) => product.id === item.productId || product.name === item.productName);
          const variants = selectedProduct?.variants ?? [];
          return (
            <div className="item-row" key={item.id}>
              <select value={selectedProduct?.id ?? ''} onChange={(event) => selectProduct(item.id, event.target.value)} disabled={!data.products.length}>
                <option value="">{data.products.length ? 'اختار الصنف' : 'أضف منتجات الأول'}</option>
                {data.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
              </select>
              <select value={item.size} onChange={(event) => selectSize(item, event.target.value)} disabled={!selectedProduct || !variants.length}>
                <option value="">{variants.length ? 'اختار المقاس' : 'لا توجد مقاسات'}</option>
                {variants.map((variant) => <option value={variant.size} key={variant.id}>{variant.size}</option>)}
                {item.size && !variants.some((variant) => variant.size === item.size) && <option value={item.size}>{item.size}</option>}
              </select>
              <input type="number" min="1" placeholder="الكمية" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} />
              <input type="number" min="0" placeholder="سعر البيع" value={item.unitPrice || ''} onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value) })} />
              <input type="number" min="0" placeholder="تكلفة القطعة" value={item.unitCost || ''} onChange={(event) => updateItem(item.id, { unitCost: Number(event.target.value) })} />
              <button type="button" className="icon-button" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 size={15} /></button>
            </div>
          );
        })}
      </div>
      <div className="form-grid four">
        <Field label="خصم العميل"><input type="number" value={costs.discount} onChange={(event) => setCosts({ ...costs, discount: Number(event.target.value) })} /></Field>
        <Field label="شحن محصل من العميل"><input type="number" value={costs.shippingCollected} onChange={(event) => setCosts({ ...costs, shippingCollected: Number(event.target.value) })} /></Field>
        <Field label="تكلفة التغليف"><input type="number" value={costs.packagingCost} onChange={(event) => setCosts({ ...costs, packagingCost: Number(event.target.value) })} /></Field>
        <Field label="الشحن المدفوع للشركة"><input type="number" value={costs.outboundShippingPaid} onChange={(event) => setCosts({ ...costs, outboundShippingPaid: Number(event.target.value) })} /></Field>
        <Field label="عمولة الدفع/COD"><input type="number" value={costs.codPaymentFee} onChange={(event) => setCosts({ ...costs, codPaymentFee: Number(event.target.value) })} /></Field>
        <Field label="تكلفة الشحن الراجع"><input type="number" value={costs.failedReturnCost} onChange={(event) => setCosts({ ...costs, failedReturnCost: Number(event.target.value) })} /></Field>
        <Field label="تكاليف أخرى"><input type="number" value={costs.otherVariableCost} onChange={(event) => setCosts({ ...costs, otherVariableCost: Number(event.target.value) })} /></Field>
        <Field label="ملاحظات"><input value={costs.notes} onChange={(event) => setCosts({ ...costs, notes: event.target.value })} /></Field>
      </div>
      <div className="form-actions">
        <button className="primary-button">{editing ? 'حفظ التعديل' : 'حفظ الأوردر'}</button>
        {editing && <button className="ghost-button" type="button" onClick={onCancel}>إلغاء التعديل</button>}
      </div>
      {validationMessage && <p className="form-error">{validationMessage}</p>}
    </form>
  );
}

function CampaignsView({ data, setData, rows }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; rows: ReturnType<typeof calculateCampaignPerformance> }) {
  const [form, setForm] = useState<Campaign>(() => newCampaign());

  function reset() {
    setForm(newCampaign());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const campaignId = form.id || id();
    const campaign = { ...form, id: campaignId, code: form.code.trim() || campaignCode(campaignId) };
    setData((current) => ({ ...current, campaigns: [campaign, ...current.campaigns.filter((item) => item.id !== campaign.id)] }));
    persistCampaign(campaign).catch(console.error);
    reset();
  }

  function remove(campaignId: string) {
    setData((current) => {
      const campaign = current.campaigns.find((item) => item.id === campaignId);
      return {
        ...current,
        campaigns: current.campaigns.filter((item) => item.id !== campaignId),
        dailyAds: current.dailyAds.filter((item) => item.campaignCode !== campaign?.code),
        orders: current.orders.map((order) => order.campaignCode === campaign?.code ? { ...order, campaignCode: null } : order),
      };
    });
    deleteCampaign(campaignId).catch(console.error);
  }

  return (
    <div className="page-stack">
      <form className="panel form-panel" onSubmit={submit}>
        <PanelHeader title={form.id ? 'تعديل حملة إعلانية' : 'إضافة حملة إعلانية'} />
        <div className="form-grid three">
          <Field label="Campaign ID (System generated)"><input value={form.code || campaignCode(form.id)} readOnly /></Field>
          <Field label="اسم الحملة"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
          <Field label="المنتج/البراند"><input value={form.brandProduct} onChange={(event) => setForm({ ...form, brandProduct: event.target.value })} /></Field>
          <Field label="المنصة"><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{adPlatforms.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="نوع الإعلان"><select value={form.adType} onChange={(event) => setForm({ ...form, adType: event.target.value })}>{adTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="الهدف"><select value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })}>{adObjectives.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="تاريخ البداية"><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></Field>
          <Field label="تاريخ النهاية"><input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></Field>
          <Field label="الحالة"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Campaign['status'] })}>{campaignStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Target CPA Delivered"><input type="number" value={form.targetCpaDelivered || ''} onChange={(event) => setForm({ ...form, targetCpaDelivered: Number(event.target.value) })} /></Field>
          <Field label="Target ROAS (x)"><input type="number" value={form.targetRoas || ''} onChange={(event) => setForm({ ...form, targetRoas: Number(event.target.value) })} /></Field>
          <Field label="Notes"><textarea value={form.notes ?? ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></Field>
        </div>
        <div className="form-actions"><button className="primary-button">{form.id ? 'حفظ التعديل' : 'حفظ الحملة'}</button>{form.id && <button type="button" className="ghost-button" onClick={reset}>إلغاء التعديل</button>}</div>
      </form>
      <section className="panel">
        <PanelHeader title="أداء الحملات" />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaign ID</th>
                <th>Campaign Name</th>
                <th>Brand / Product</th>
                <th>Platform</th>
                <th>Ad Type</th>
                <th>Objective</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th>Target CPA Delivered (EGP)</th>
                <th>Target ROAS (x)</th>
                <th>Ad Spend (EGP)</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>Conversations</th>
                <th>Leads</th>
                <th>CPM (EGP)</th>
                <th>CPC (EGP)</th>
                <th>CTR</th>
                <th>Cost / Conversation (EGP)</th>
                <th>Cost / Lead (EGP)</th>
                <th>Orders Created</th>
                <th>Confirmed Funnel</th>
                <th>Shipped Funnel</th>
                <th>Delivered</th>
                <th>Cancelled</th>
                <th>Returned</th>
                <th>New Customers Delivered</th>
                <th>Confirmation Rate</th>
                <th>Delivery Rate from Confirmed</th>
                <th>Return Rate</th>
                <th>CPA Confirmed (EGP)</th>
                <th>CPA Delivered (EGP)</th>
                <th>CAC New Customer (EGP)</th>
                <th>Delivered Revenue (EGP)</th>
                <th>Delivered COGS (EGP)</th>
                <th>Order Variable Costs (EGP)</th>
                <th>Contribution Before Ads (EGP)</th>
                <th>Net Profit After Ads (EGP)</th>
                <th>ROAS (x)</th>
                <th>Profit Margin</th>
                <th>Break-even CPA (EGP)</th>
                <th>Profit / Delivered Order (EGP)</th>
                <th>CPA Variance vs Target</th>
                <th>Verdict</th>
                <th>Notes</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.campaign.id}>
                  <td>{row.campaign.code}</td>
                  <td>{row.campaign.name}</td>
                  <td>{row.campaign.brandProduct}</td>
                  <td>{row.campaign.platform}</td>
                  <td>{row.campaign.adType}</td>
                  <td>{row.campaign.objective}</td>
                  <td>{row.campaign.startDate}</td>
                  <td>{row.campaign.endDate}</td>
                  <td>{row.campaign.status}</td>
                  <td>{money.format(row.campaign.targetCpaDelivered)}</td>
                  <td>{number.format(row.campaign.targetRoas)}</td>
                  <td>{money.format(row.adSpend)}</td>
                  <td>{number.format(row.impressions)}</td>
                  <td>{number.format(row.clicks)}</td>
                  <td>{number.format(row.conversations)}</td>
                  <td>{number.format(row.leads)}</td>
                  <td>{money.format(row.cpm)}</td>
                  <td>{money.format(row.cpc)}</td>
                  <td>{percent(row.ctr)}</td>
                  <td>{money.format(row.costPerConversation)}</td>
                  <td>{money.format(row.costPerLead)}</td>
                  <td>{number.format(row.ordersCreated)}</td>
                  <td>{number.format(row.confirmedFunnel)}</td>
                  <td>{number.format(row.shippedFunnel)}</td>
                  <td>{number.format(row.delivered)}</td>
                  <td>{number.format(row.cancelled)}</td>
                  <td>{number.format(row.returned)}</td>
                  <td>{number.format(row.newCustomersDelivered)}</td>
                  <td>{percent(row.confirmationRate)}</td>
                  <td>{percent(row.deliveryRateFromConfirmed)}</td>
                  <td>{percent(row.returnRate)}</td>
                  <td>{money.format(row.cpaConfirmed)}</td>
                  <td>{money.format(row.cpaDelivered)}</td>
                  <td>{money.format(row.cacNewCustomer)}</td>
                  <td>{money.format(row.deliveredRevenue)}</td>
                  <td>{money.format(row.deliveredCogs)}</td>
                  <td>{money.format(row.orderVariableCosts)}</td>
                  <td>{money.format(row.contributionBeforeAds)}</td>
                  <td>{money.format(row.netProfitAfterAds)}</td>
                  <td>{number.format(row.roas)}</td>
                  <td>{percent(row.profitMargin)}</td>
                  <td>{money.format(row.breakEvenCpa)}</td>
                  <td>{money.format(row.profitPerDeliveredOrder)}</td>
                  <td>{percent(row.cpaVarianceVsTarget)}</td>
                  <td>{row.verdict}</td>
                  <td>{row.campaign.notes}</td>
                  <td><button className="ghost-button" onClick={() => setForm(row.campaign)}>تعديل</button><button className="danger-button" onClick={() => remove(row.campaign.id)}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AdsView({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const blank: DailyAdMetric = { id: '', campaignCode: data.campaigns[0]?.code ?? '', date: today(), platform: 'Facebook', spend: 0, impressions: 0, clicks: 0, conversations: 0, leads: 0, addToCart: 0, platformPurchases: 0, notes: '' };
  const [form, setForm] = useState<DailyAdMetric>(blank);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const row = { ...form, id: form.id || id() };
    setData((current) => ({ ...current, dailyAds: [row, ...current.dailyAds.filter((item) => item.id !== row.id)] }));
    persistDailyAd(row).catch(console.error);
    setForm({ ...blank, campaignCode: data.campaigns[0]?.code ?? '' });
  }

  function remove(rowId: string) {
    setData((current) => ({ ...current, dailyAds: current.dailyAds.filter((item) => item.id !== rowId) }));
    deleteDailyAd(rowId).catch(console.error);
  }

  return (
    <div className="page-stack">
      <form className="panel form-panel" onSubmit={submit}>
        <PanelHeader title="تسجيل صرف اليوم (رقم اليوم فقط مش التراكمي)" />
        <div className="form-grid three">
          <Field label="التاريخ"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
          <Field label="الحملة"><select value={form.campaignCode} onChange={(event) => setForm({ ...form, campaignCode: event.target.value })}>{data.campaigns.map((campaign) => <option value={campaign.code} key={campaign.id}>{campaign.name} - {campaign.code}</option>)}</select></Field>
          <Field label="المنصة"><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{adPlatforms.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="الصرف"><input type="number" value={form.spend || ''} onChange={(event) => setForm({ ...form, spend: Number(event.target.value) })} /></Field>
          <Field label="Impressions"><input type="number" value={form.impressions || ''} onChange={(event) => setForm({ ...form, impressions: Number(event.target.value) })} /></Field>
          <Field label="Clicks"><input type="number" value={form.clicks || ''} onChange={(event) => setForm({ ...form, clicks: Number(event.target.value) })} /></Field>
          <Field label="المحادثات"><input type="number" value={form.conversations || ''} onChange={(event) => setForm({ ...form, conversations: Number(event.target.value) })} /></Field>
          <Field label="Leads"><input type="number" value={form.leads || ''} onChange={(event) => setForm({ ...form, leads: Number(event.target.value) })} /></Field>
          <Field label="Add to Cart"><input type="number" value={form.addToCart || ''} onChange={(event) => setForm({ ...form, addToCart: Number(event.target.value) })} /></Field>
          <Field label="Platform Purchases"><input type="number" value={form.platformPurchases || ''} onChange={(event) => setForm({ ...form, platformPurchases: Number(event.target.value) })} /></Field>
        </div>
        <div className="form-actions"><button className="primary-button">{form.id ? 'حفظ التعديل' : 'حفظ الصرف اليومي'}</button>{form.id && <button type="button" className="ghost-button" onClick={() => setForm(blank)}>إلغاء التعديل</button>}</div>
      </form>
      <section className="panel">
        <PanelHeader title="سجل آخر 30 يوم" />
        <table><thead><tr><th>التاريخ</th><th>الحملة</th><th>الصرف</th><th>Leads</th><th>Cost / Lead</th><th>ظهور</th><th>نقرات</th><th>CPM</th><th>CPC</th><th>CTR</th><th></th></tr></thead><tbody>{data.dailyAds.map((row) => { const metrics = calculateDailyMetrics(row); return <tr key={row.id}><td>{row.date}</td><td>{row.campaignCode}</td><td>{money.format(row.spend)}</td><td>{number.format(row.leads)}</td><td>{money.format(metrics.costPerLead)}</td><td>{row.impressions}</td><td>{row.clicks}</td><td>{number.format(metrics.cpm)}</td><td>{number.format(metrics.cpc)}</td><td>{number.format(metrics.ctr * 100)}%</td><td><button className="ghost-button" onClick={() => setForm(row)}>تعديل</button><button className="danger-button" onClick={() => remove(row.id)}>حذف</button></td></tr>; })}</tbody></table>
      </section>
    </div>
  );
}

function Dashboard({ summary, campaigns, products, sizes }: { summary: ReturnType<typeof calculateDashboardSummary>; campaigns: ReturnType<typeof calculateCampaignPerformance>; products: ReturnType<typeof productPerformance>; sizes: ReturnType<typeof sizePerformance> }) {
  return (
    <div className="page-stack">
      <section className="panel">
        <PanelHeader title="الأداء العام" />
        <div className="kpi-grid">
          <Kpi label="إجمالي صرف الإعلانات" value={money.format(summary.adSpend)} />
          <Kpi label="Leads" value={number.format(summary.leads)} />
          <Kpi label="Cost / Lead" value={money.format(summary.costPerLead)} />
          <Kpi label="إيراد الأوردرات المسلمة" value={money.format(summary.deliveredRevenue)} />
          <Kpi label="صافي الربح" value={money.format(summary.netProfit)} />
          <Kpi label="ROAS" value={`${number.format(summary.roas)}x`} />
          <Kpi label="أوردرات مسلمة" value={number.format(summary.deliveredOrders)} />
          <Kpi label="CPA مسلم" value={money.format(summary.cpaDelivered)} />
          <Kpi label="CAC عميل جديد" value={money.format(summary.cacNewCustomer)} />
          <Kpi label="Break-even CPA" value={money.format(summary.breakEvenCpa)} />
        </div>
      </section>
      <section className="panel"><PanelHeader title="تفاصيل حملة معينة" /><select><option>اختر حملة</option>{campaigns.map((row) => <option key={row.campaign.id}>{row.campaign.name}</option>)}</select></section>
      <SimpleTable title="أكثر الأصناف مبيعًا (اللي اتسحبت من الستوك فعليًا)" headers={['الصنف', 'الكمية']} rows={products.map((row) => [row.product, number.format(row.quantity)])} />
      <SimpleTable title="أكثر المقاسات طلبًا" headers={['المقاس', 'الكمية']} rows={sizes.map((row) => [row.size, number.format(row.quantity)])} />
    </div>
  );
}

function ProductsView({ data, setData, products, sizes }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; products: ReturnType<typeof productPerformance>; sizes: ReturnType<typeof sizePerformance> }) {
  const blank: Product = { id: '', name: '', category: '', defaultCost: 0, variants: [newProductVariant()] };
  const [form, setForm] = useState<Product>(blank);
  const [message, setMessage] = useState('');

  function updateVariant(variantId: string, patch: Partial<ProductVariant>) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
    }));
  }

  function edit(product: Product) {
    setForm({
      ...product,
      variants: product.variants?.length ? product.variants.map((variant) => ({ ...variant })) : [newProductVariant()],
    });
    setMessage('');
  }

  function reset() {
    setForm(blank);
    setMessage('');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const variants = form.variants.filter((variant) => variant.size.trim());
    if (!variants.length) {
      setMessage('لازم تضيف مقاس واحد على الأقل للمنتج.');
      return;
    }
    const product = {
      ...form,
      id: form.id || id(),
      name: form.name.trim(),
      defaultCost: variants[0]?.unitCost ?? 0,
      variants,
    };
    setData((current) => ({ ...current, products: [product, ...current.products.filter((item) => item.id !== product.id)] }));
    persistProduct(product).catch(console.error);
    reset();
  }

  function remove(productId: string) {
    setData((current) => ({ ...current, products: current.products.filter((item) => item.id !== productId) }));
    deleteProduct(productId).catch(console.error);
  }

  return (
    <div className="page-stack">
      <form className="panel form-panel" onSubmit={submit}>
        <PanelHeader title={form.id ? 'تعديل منتج' : 'إضافة منتج'} />
        <div className="form-grid two">
          <Field label="الصنف"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
          <Field label="الفئة"><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
        </div>
        <div className="line-items">
          <div className="section-title"><strong>المقاسات والأسعار</strong><button type="button" className="ghost-button" onClick={() => setForm((current) => ({ ...current, variants: [...current.variants, newProductVariant()] }))}><Plus size={14} /> إضافة مقاس</button></div>
          {form.variants.map((variant) => (
            <div className="variant-row" key={variant.id}>
              <input placeholder="المقاس" value={variant.size} onChange={(event) => updateVariant(variant.id, { size: event.target.value })} />
              <input type="number" min="0" placeholder="سعر البيع" value={variant.unitPrice || ''} onChange={(event) => updateVariant(variant.id, { unitPrice: Number(event.target.value) })} />
              <input type="number" min="0" placeholder="سعر التكلفة" value={variant.unitCost || ''} onChange={(event) => updateVariant(variant.id, { unitCost: Number(event.target.value) })} />
              <button type="button" className="icon-button" onClick={() => setForm((current) => ({ ...current, variants: current.variants.filter((row) => row.id !== variant.id) }))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="form-actions"><button className="primary-button">{form.id ? 'حفظ التعديل' : 'حفظ المنتج'}</button>{form.id && <button type="button" className="ghost-button" onClick={reset}>إلغاء التعديل</button>}</div>
        {message && <p className="form-error">{message}</p>}
      </form>
      <SimpleTable
        title="كتالوج المنتجات"
        headers={['الصنف', 'الفئة', 'المقاسات', '']}
        rows={data.products.map((product) => [
          product.name,
          product.category,
          product.variants?.length
            ? product.variants.map((variant) => `${variant.size}: ${number.format(variant.unitPrice)} / ${number.format(variant.unitCost)}`).join(' | ')
            : 'لا توجد مقاسات',
          <span className="inline-actions" key={product.id}><button className="ghost-button" onClick={() => edit(product)}>تعديل</button><button className="danger-button" onClick={() => remove(product.id)}>حذف</button></span>,
        ])}
      />
      <SimpleTable title="أكثر الأصناف مبيعًا" headers={['الصنف', 'الكمية', 'المبيعات']} rows={products.map((row) => [row.product, number.format(row.quantity), money.format(row.revenue)])} />
      <SimpleTable title="أكثر المقاسات" headers={['المقاس', 'الكمية']} rows={sizes.map((row) => [row.size, number.format(row.quantity)])} />
    </div>
  );
}

function CustomersView({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const blank: Customer = { id: '', customerCode: '', name: '', phone: '', secondPhone: '', city: '', address: '', customerType: 'New', notes: '' };
  const [form, setForm] = useState<Customer>(blank);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvoiceOrderId, setSelectedInvoiceOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  function reset() {
    setForm(blank);
    setMessage('');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(form.phone);
    const duplicateCustomer = data.customers.find(
      (customer) => normalizePhone(customer.phone) === normalizedPhone && customer.id !== form.id,
    );
    if (duplicateCustomer) {
      setMessage(`رقم الموبايل مسجل بالفعل للعميل ${duplicateCustomer.name} بكود ${duplicateCustomer.customerCode}.`);
      setSelectedCustomerId(duplicateCustomer.id);
      return;
    }

    const customerId = form.id || id();
    const customer = { ...form, id: customerId, customerCode: form.customerCode || customerCode(customerId) };
    setData((current) => ({ ...current, customers: [customer, ...current.customers.filter((item) => item.id !== customer.id)] }));
    persistCustomer(customer).catch(console.error);
    reset();
  }

  function remove(customerId: string) {
    if (data.orders.some((order) => order.customerId === customerId)) {
      setMessage('لا يمكن حذف عميل عليه أوردرات. ممكن تعدل بياناته بدل الحذف.');
      return;
    }
    setData((current) => ({ ...current, customers: current.customers.filter((customer) => customer.id !== customerId) }));
    deleteCustomer(customerId).catch(console.error);
    reset();
  }

  const selectedCustomer = data.customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedOrders = selectedCustomer
    ? data.orders.filter((order) => order.customerId === selectedCustomer.id)
    : [];
  const selectedOrdersRevenue = sum(selectedOrders.map((order) => calculateOrderFinancials(order).grossProductSales));
  const selectedInvoiceOrder = selectedOrders.find((order) => order.id === selectedInvoiceOrderId) ?? null;

  return (
    <div className="page-stack">
      <form className="panel form-panel" onSubmit={submit}>
        <PanelHeader title={form.id ? 'تعديل عميل' : 'إضافة عميل'} />
        <div className="form-grid three">
          <Field label="اسم العميل"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
          <Field label="رقم الموبايل"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
          <Field label="رقم ثاني"><input value={form.secondPhone ?? ''} onChange={(event) => setForm({ ...form, secondPhone: event.target.value })} /></Field>
          <Field label="المدينة"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
          <Field label="العنوان"><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
          <Field label="نوع العميل"><select value={form.customerType} onChange={(event) => setForm({ ...form, customerType: event.target.value as Customer['customerType'] })}>{customerTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
        </div>
        <div className="form-actions"><button className="primary-button">{form.id ? 'حفظ التعديل' : 'حفظ العميل'}</button>{form.id && <button type="button" className="ghost-button" onClick={reset}>إلغاء التعديل</button>}</div>
        {message && <p className="form-error">{message}</p>}
      </form>
      <SimpleTable
        title="بيانات العملاء"
        headers={['الكود', 'الاسم', 'الموبايل', 'العنوان', 'نوع العميل', '']}
        rows={data.customers.map((customer) => [
          customer.customerCode,
          customer.name,
          customer.phone,
          customer.address,
          customer.customerType === 'New' ? 'جديد' : 'عميل سابق',
          <span className="inline-actions" key={customer.id}><button className="ghost-button" onClick={() => { setSelectedCustomerId(customer.id); setSelectedInvoiceOrderId(null); }}>سجل العميل</button><button className="ghost-button" onClick={() => setForm(customer)}>تعديل</button><button className="danger-button" onClick={() => remove(customer.id)}>حذف</button></span>,
        ])}
      />
      {selectedCustomer && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>سجل العميل: {selectedCustomer.name}</h2>
              <p>{selectedCustomer.customerCode} | {selectedCustomer.phone} | {selectedCustomer.address || 'بدون عنوان'}</p>
            </div>
            <button className="ghost-button" onClick={() => { setSelectedCustomerId(null); setSelectedInvoiceOrderId(null); }}>إغلاق السجل</button>
          </div>
          <div className="kpi-grid compact">
            <Kpi label="عدد الأوردرات" value={number.format(selectedOrders.length)} />
            <Kpi label="إجمالي الطلبات" value={money.format(selectedOrdersRevenue)} />
            <Kpi label="آخر أوردر" value={selectedOrders[0]?.orderDate ?? 'لا يوجد'} />
            <Kpi label="نوع العميل" value={selectedCustomer.customerType === 'New' ? 'جديد' : 'عميل سابق'} />
          </div>
          <div className="table-scroll customer-history">
            <table>
              <thead><tr><th>التاريخ</th><th>رقم الأوردر</th><th>الحالة</th><th>المصدر</th><th>الأصناف</th><th>الإجمالي</th><th></th></tr></thead>
              <tbody>
                {selectedOrders.length ? selectedOrders.map((order) => {
                  const campaign = data.campaigns.find((row) => row.code === order.campaignCode);
                  const orderTotal = sum(order.items.map((item) => item.quantity * item.unitPrice));
                  return (
                    <tr key={order.id}>
                      <td>{order.orderDate}</td>
                      <td>{order.orderNumber}</td>
                      <td>{orderStatusLabels[order.status]}</td>
                      <td>{order.campaignCode ? campaign?.name ?? order.campaignCode : 'مباشر / عضوي'}</td>
                      <td>{order.items.map((item) => `${item.productName} ${item.size} x${item.quantity}`).join(' | ')}</td>
                      <td>{money.format(orderTotal)}</td>
                      <td><button className="ghost-button" onClick={() => setSelectedInvoiceOrderId(order.id)}>فتح الفاتورة</button></td>
                    </tr>
                  );
                }) : <tr><td colSpan={7}>لا توجد أوردرات لهذا العميل بعد</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {selectedCustomer && selectedInvoiceOrder && (
        <OrderInvoice
          customer={selectedCustomer}
          order={selectedInvoiceOrder}
          sourceLabel={selectedInvoiceOrder.campaignCode
            ? data.campaigns.find((campaign) => campaign.code === selectedInvoiceOrder.campaignCode)?.name ?? selectedInvoiceOrder.campaignCode
            : 'مباشر / عضوي'}
        />
      )}
    </div>
  );
}

function OrderInvoice({ customer, order, sourceLabel }: { customer: Customer; order: Order; sourceLabel: string }) {
  const subtotal = sum(order.items.map((item) => item.quantity * item.unitPrice));
  const totalQuantity = sum(order.items.map((item) => item.quantity));
  const totalAfterDiscount = Math.max(0, subtotal - order.discount);
  const invoiceTotal = totalAfterDiscount + order.shippingCollected;

  return (
    <section className="panel invoice-panel" dir="rtl">
      <div className="invoice-actions">
        <button className="primary-button" onClick={() => window.print()}>طباعة الفاتورة</button>
      </div>
      <div className="invoice-head">
        <div>
          <h2>Babino Moda</h2>
          <p>فاتورة أوردر</p>
        </div>
        <div className="invoice-number">
          <span>رقم الفاتورة</span>
          <strong>{order.orderNumber}</strong>
        </div>
      </div>
      <div className="invoice-grid">
        <div><span>اسم العميل</span><strong>{customer.name}</strong></div>
        <div><span>كود العميل</span><strong>{customer.customerCode}</strong></div>
        <div><span>رقم الموبايل</span><strong>{customer.phone}</strong></div>
        <div><span>تاريخ الأوردر</span><strong>{order.orderDate}</strong></div>
        <div><span>حالة الأوردر</span><strong>{orderStatusLabels[order.status]}</strong></div>
        <div><span>المصدر</span><strong>{sourceLabel}</strong></div>
        <div className="invoice-address"><span>العنوان</span><strong>{customer.address || 'غير مسجل'}</strong></div>
      </div>
      <table className="invoice-table">
        <thead><tr><th>الصنف</th><th>المقاس</th><th>الكمية</th><th>سعر القطعة</th><th>الإجمالي</th></tr></thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td>{item.productName}</td>
              <td>{item.size}</td>
              <td>{number.format(item.quantity)}</td>
              <td>{money.format(item.unitPrice)}</td>
              <td>{money.format(item.quantity * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-totals">
        <div><span>عدد القطع</span><strong>{number.format(totalQuantity)}</strong></div>
        <div><span>قيمة الفاتورة</span><strong>{money.format(subtotal)}</strong></div>
        <div><span>الخصم</span><strong>{money.format(order.discount)}</strong></div>
        <div><span>الشحن</span><strong>{money.format(order.shippingCollected)}</strong></div>
        <div className="invoice-grand-total"><span>الإجمالي</span><strong>{money.format(invoiceTotal)}</strong></div>
      </div>
      <p className="invoice-notice">
        الاسترجاع أو الاستبدال خلال أسبوع من استلام الأوردر، ويجب التبليغ بالسبب من خلال الصفحة أو الواتس اب في يوم استلام الأوردر والتنسيق مع الإدارة قبلها. يرجى إرسال رسالة على رقم الواتس اب / 01029297415.
      </p>
    </section>
  );
}

function SimpleTable({ title, headers, rows }: { title: string; headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <section className="panel">
      <PanelHeader title={title} />
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>لا توجد بيانات</td></tr>}</tbody>
      </table>
    </section>
  );
}

export default App;
