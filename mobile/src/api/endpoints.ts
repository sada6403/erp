import type { AxiosInstance } from 'axios';
import type { OkResponse } from '@contracts/common';
import type { StatusResponse, WatermarkResponse } from '@contracts/status';
import type { CompanyProfileResponse } from '@contracts/company';
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  DeleteMeRequest,
  EmailStartRequest,
  EmailStartResponse,
  EmailVerifyRequest,
  EmailVerifyResponse,
  ForgotRequest,
  ForgotResetRequest,
  ForgotResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  UpdateMeRequest,
} from '@contracts/auth';
import type {
  BannersResponse,
  BranchesResponse,
  CategoriesResponse,
  ProductDetailDto,
  ProductsQuery,
  ProductsResponse,
  SearchResponse,
  SuggestResponse,
} from '@contracts/catalog';
import type { WishlistAddRequest, WishlistResponse } from '@contracts/wishlist';
import type { AddressDto, AddressInput, AddressesResponse } from '@contracts/addresses';
import type {
  CancelOrderRequest,
  CreateOrderRequest,
  CreateOrderResponse,
  OrderDto,
  OrdersListResponse,
  QuoteRequest,
  QuoteResponse,
  TrackingResponse,
} from '@contracts/orders';
import type { RegisterDeviceRequest, UnregisterDeviceRequest } from '@contracts/devices';
import type {
  MarkReadRequest,
  NotificationSettingsDto,
  NotificationsResponse,
} from '@contracts/notifications';
import type {
  DrawsResponse,
  MySchemesResponse,
  OpenSchemesResponse,
  StatementResponse,
  WalletResponse,
  WalletTransactionsResponse,
} from '@contracts/smartbuy';
import type {
  AgentDashboardResponse,
  AgentDeliveriesResponse,
  AgentMemberDetailDto,
  AgentMembersResponse,
  AgentSchemesResponse,
  CommissionResponse,
  DeliveryCompleteRequest,
  DeliveryCompleteResponse,
  DeliveryStatusRequest,
} from '@contracts/agent';
import type { AgentBillDto } from './localTypes';
import { getClient } from './instance';

/**
 * Typed endpoint functions for /api/app/v1 (v1.0 scope). Components never call axios: they use the
 * TanStack Query hooks in src/features/* which call these.
 */
const c = (): AxiosInstance => getClient();

const get = async <T>(url: string, params?: object): Promise<T> => (await c().get<T>(url, { params })).data;
const post = async <T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
  (await c().post<T>(url, body, { headers })).data;

export const statusApi = {
  status: () => get<StatusResponse>('/status'),
  watermark: () => get<WatermarkResponse>('/watermark'),
  company: () => get<CompanyProfileResponse>('/company'),
};

export const authApi = {
  login: (body: LoginRequest) => post<LoginResponse>('/auth/login', body),
  register: (body: RegisterRequest) => post<RegisterResponse>('/auth/register', body),
  refresh: (body: RefreshRequest) => post<RefreshResponse>('/auth/refresh', body),
  logout: (body: LogoutRequest) => post<OkResponse>('/auth/logout', body),
  changePassword: (body: ChangePasswordRequest) => post<ChangePasswordResponse>('/auth/change-password', body),
  emailStart: (body: EmailStartRequest) => post<EmailStartResponse>('/auth/email/start', body),
  emailVerify: (body: EmailVerifyRequest) => post<EmailVerifyResponse>('/auth/email/verify', body),
  forgot: (body: ForgotRequest) => post<ForgotResponse>('/auth/forgot', body),
  forgotReset: (body: ForgotResetRequest) => post<OkResponse>('/auth/forgot/reset', body),
  me: () => get<MeResponse>('/me'),
  updateMe: async (body: UpdateMeRequest) => (await c().patch<MeResponse>('/me', body)).data,
  deleteMe: async (body: DeleteMeRequest) => (await c().delete<OkResponse>('/me', { data: body })).data,
};

export const catalogApi = {
  categories: (updated_since?: string) => get<CategoriesResponse>('/catalog/categories', { updated_since }),
  products: (q: ProductsQuery) => get<ProductsResponse>('/catalog/products', q),
  product: (id: string) => get<ProductDetailDto>(`/catalog/products/${encodeURIComponent(id)}`),
  banners: () => get<BannersResponse>('/catalog/banners'),
  search: (q: string) => get<SearchResponse>('/catalog/search', { q }),
  suggest: (q: string) => get<SuggestResponse>('/catalog/suggest', { q }),
  branchesNearby: (lat?: number, lng?: number) => get<BranchesResponse>('/branches/nearby', { lat, lng }),
};

export const wishlistApi = {
  list: () => get<WishlistResponse>('/me/wishlist'),
  add: (body: WishlistAddRequest, idempotencyKey?: string) =>
    post<OkResponse>('/me/wishlist', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  remove: async (productId: string) => (await c().delete<OkResponse>(`/me/wishlist/${encodeURIComponent(productId)}`)).data,
};

export const addressApi = {
  list: () => get<AddressesResponse>('/me/addresses'),
  create: (body: AddressInput) => post<AddressDto>('/me/addresses', body),
  update: async (id: string, body: AddressInput) => (await c().put<AddressDto>(`/me/addresses/${id}`, body)).data,
  remove: async (id: string) => (await c().delete<OkResponse>(`/me/addresses/${id}`)).data,
};

export const orderApi = {
  quote: (body: QuoteRequest) => post<QuoteResponse>('/checkout/quote', body),
  create: (body: CreateOrderRequest, idempotencyKey: string) =>
    post<CreateOrderResponse>('/orders', body, { 'Idempotency-Key': idempotencyKey }),
  list: (cursor?: string) => get<OrdersListResponse>('/orders', { cursor }),
  get: (id: string) => get<OrderDto>(`/orders/${encodeURIComponent(id)}`),
  tracking: (id: string) => get<TrackingResponse>(`/orders/${encodeURIComponent(id)}/tracking`),
  cancel: (id: string, body: CancelOrderRequest = {}) => post<OrderDto>(`/orders/${encodeURIComponent(id)}/cancel`, body),
};

export const deviceApi = {
  register: (body: RegisterDeviceRequest) => post<OkResponse>('/me/devices', body),
  unregister: async (body: UnregisterDeviceRequest) => (await c().delete<OkResponse>('/me/devices', { data: body })).data,
};

export const notificationApi = {
  list: (cursor?: string) => get<NotificationsResponse>('/me/notifications', { cursor }),
  markRead: (body: MarkReadRequest) => post<OkResponse>('/me/notifications/read', body),
  settings: () => get<NotificationSettingsDto>('/me/notification-settings'),
  saveSettings: async (body: NotificationSettingsDto) =>
    (await c().put<NotificationSettingsDto>('/me/notification-settings', body)).data,
};

/** Smart Buy v1.0 is read-only. */
export const smartbuyApi = {
  openSchemes: () => get<OpenSchemesResponse>('/smartbuy/schemes/open'),
  mySchemes: () => get<MySchemesResponse>('/smartbuy/me/schemes'),
  statement: (schemeId: string) => get<StatementResponse>(`/smartbuy/me/schemes/${encodeURIComponent(schemeId)}/statement`),
  draws: (schemeId: string) => get<DrawsResponse>(`/smartbuy/me/schemes/${encodeURIComponent(schemeId)}/draws`),
  wallet: () => get<WalletResponse>('/wallet'),
  walletTransactions: () => get<WalletTransactionsResponse>('/wallet/transactions'),
};

export const agentApi = {
  dashboard: () => get<AgentDashboardResponse>('/agent/dashboard'),
  schemes: () => get<AgentSchemesResponse>('/agent/schemes'),
  members: (cursor?: string) => get<AgentMembersResponse>('/agent/members', { cursor }),
  member: (id: string) => get<AgentMemberDetailDto>(`/agent/members/${encodeURIComponent(id)}`),
  commission: (month?: string) => get<CommissionResponse>('/agent/commission', { month }),
  deliveries: () => get<AgentDeliveriesResponse>('/agent/deliveries'),
  deliveryStatus: (id: string, body: DeliveryStatusRequest) =>
    post<OkResponse>(`/agent/deliveries/${encodeURIComponent(id)}/status`, body),
  deliveryComplete: (id: string, body: DeliveryCompleteRequest) =>
    post<DeliveryCompleteResponse>(`/agent/deliveries/${encodeURIComponent(id)}/complete`, body, {
      'Idempotency-Key': body.event_id,
    }),
  bill: (id: string) => get<AgentBillDto>(`/agent/deliveries/${encodeURIComponent(id)}/bill`),
};
