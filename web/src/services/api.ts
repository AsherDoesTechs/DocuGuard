import { MOCK_USER, MOCK_DOCUMENTS, MOCK_REMINDERS } from "@/constants";
import type { User, Document, Reminder } from "@/types";

// Simulated API service
class ApiService {
  private delay = 500; // Simulate network delay

  private simulateDelay = (): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, this.delay));
  };

  // Auth
  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; token: string }> {
    await this.simulateDelay();
    if (email === "demo@docuguard.com" && password === "password123") {
      return {
        user: MOCK_USER,
        token: "mock-jwt-token-" + Date.now(),
      };
    }
    throw new Error("Invalid credentials");
  }

  async register(
    name: string,
    email: string,
    _password: string,
  ): Promise<{ user: User; token: string }> {
    await this.simulateDelay();
    const newUser: User = {
      ...MOCK_USER,
      id: Math.random().toString(),
      name,
      email,
      documentCount: 0,
      expiringCount: 0,
    };
    return {
      user: newUser,
      token: "mock-jwt-token-" + Date.now(),
    };
  }

  async resetPassword(_email: string): Promise<{ success: boolean }> {
    await this.simulateDelay();
    return { success: true };
  }

  // Documents
  async getDocuments(): Promise<Document[]> {
    await this.simulateDelay();
    return MOCK_DOCUMENTS;
  }

  async getDocument(id: string): Promise<Document> {
    await this.simulateDelay();
    const doc = MOCK_DOCUMENTS.find((d) => d.id === id);
    if (!doc) throw new Error("Document not found");
    return doc;
  }

  async createDocument(data: Partial<Document>): Promise<Document> {
    await this.simulateDelay();
    const newDoc: Document = {
      ...data,
      id: Math.random().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Document;
    return newDoc;
  }

  async updateDocument(id: string, data: Partial<Document>): Promise<Document> {
    await this.simulateDelay();
    const doc = MOCK_DOCUMENTS.find((d) => d.id === id);
    if (!doc) throw new Error("Document not found");
    return { ...doc, ...data, updatedAt: new Date().toISOString() };
  }

  async deleteDocument(_id: string): Promise<{ success: boolean }> {
    await this.simulateDelay();
    return { success: true };
  }

  // Reminders
  async getReminders(): Promise<Reminder[]> {
    await this.simulateDelay();
    return MOCK_REMINDERS;
  }

  async markReminderAsRead(id: string): Promise<Reminder> {
    await this.simulateDelay();
    const reminder = MOCK_REMINDERS.find((r) => r.id === id);
    if (!reminder) throw new Error("Reminder not found");
    return { ...reminder, isRead: true };
  }

  // User
  async getCurrentUser(): Promise<User> {
    await this.simulateDelay();
    return MOCK_USER;
  }

  async updateUser(data: Partial<User>): Promise<User> {
    await this.simulateDelay();
    return { ...MOCK_USER, ...data };
  }

  async logout(): Promise<{ success: boolean }> {
    await this.simulateDelay();
    return { success: true };
  }
}

export const apiService = new ApiService();
