export interface ReceiptData {
  transactionId: string;
  timestamp: string;
  planName: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  billingAddress: string;
  taxAmount: number;
  total: number;
}

export const generateReceipt = (
  action: string,
  billingAddress: string,
): ReceiptData => ({
  transactionId: `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
  timestamp: new Date().toLocaleString(),
  planName: action === "upgrade" ? "Premium Pro Tier" : "Standard Renewal",
  amount: action === "upgrade" ? 49.99 : 19.99,
  currency: "USD",
  paymentMethod: "Visa ending in 4242",
  billingAddress: billingAddress || "123 Enterprise Way, Tech City",
  taxAmount: 2.5,
  total: action === "upgrade" ? 52.49 : 22.49,
});
