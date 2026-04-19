export type TradovateOrderFill = {
  id: number;
  orderId: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  tradeDate: { year: number; month: number; day: number };
  action: "Buy" | "Sell";
  qty: number;
  price: number;
  active: boolean;
  profit?: number;
};

export type TradovateOrder = {
  id: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  action: "Buy" | "Sell";
  ordStatus: "Working" | "Completed" | "Canceled" | "Rejected";
  qty: number;
  price?: number;
};

export type TradovateAccountSummary = {
  accountId: number;
  cashBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  timestamp: string;
};

export type TradovateWebhookEvent =
  | { type: "fill"; accountId: number; data: TradovateOrderFill }
  | { type: "order"; accountId: number; data: TradovateOrder }
  | { type: "account_summary"; accountId: number; data: TradovateAccountSummary };
