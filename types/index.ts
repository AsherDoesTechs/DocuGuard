export interface AppDocument {
  id: string;
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  status: string;
  imageUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  documentCount: number;
  expiringCount: number;
  securityLevel: string;
}

export interface Reminder {
  id: string;
  title: string;
  description: string;
  severity: "urgent" | "info" | string;
  dueDate: string;
  read: boolean;
  documentId: string;
}
