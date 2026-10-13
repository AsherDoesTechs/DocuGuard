declare module "expo-sqlite" {
  export interface SQLiteRunResult {
    changes: number;
    lastInsertRowId: number;
  }

  export interface SQLiteTransaction {
    runAsync(sql: string, ...params: unknown[]): Promise<SQLiteRunResult>;
    getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  }

  export interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, ...params: unknown[]): Promise<SQLiteRunResult>;
    getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
    getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
    withExclusiveTransactionAsync(
      task: (transaction: SQLiteTransaction) => Promise<void>,
    ): Promise<void>;
  }

  export function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
}

declare module "expo-notifications" {
  export interface Notification {
    request: {
      identifier: string;
      content: {
        data?: Record<string, unknown>;
        title?: string | null;
        body?: string | null;
      };
    };
  }

  export interface NotificationResponse {
    notification: Notification;
    actionIdentifier: string;
  }

  export interface EventSubscription {
    remove(): void;
  }

  export interface NotificationPermissionsStatus {
    granted: boolean;
    status: "granted" | "denied" | "undetermined";
    ios?: {
      status?: IosAuthorizationStatus;
    };
  }

  export enum IosAuthorizationStatus {
    NOT_DETERMINED = 0,
    DENIED = 1,
    AUTHORIZED = 2,
    PROVISIONAL = 3,
    EPHEMERAL = 4,
  }

  export enum AndroidImportance {
    DEFAULT = 3,
    HIGH = 4,
    MAX = 5,
  }

  export enum SchedulableTriggerInputTypes {
    DATE = "date",
    DAILY = "daily",
  }

  export function setNotificationHandler(handler: {
    handleNotification: () => Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }): void;

  export function getPermissionsAsync(): Promise<NotificationPermissionsStatus>;
  export function requestPermissionsAsync(): Promise<NotificationPermissionsStatus>;
  export function setNotificationChannelAsync(
    channelId: string,
    channel: {
      name: string;
      importance: AndroidImportance;
      vibrationPattern?: number[];
      lightColor?: string;
    },
  ): Promise<void>;
  export function getExpoPushTokenAsync(options?: {
    projectId?: string;
  }): Promise<{ data: string }>;
  export function getDevicePushTokenAsync(): Promise<{ data: string }>;
  export function addNotificationReceivedListener(
    listener: (notification: Notification) => void,
  ): EventSubscription;
  export function addNotificationResponseReceivedListener(
    listener: (response: NotificationResponse) => void,
  ): EventSubscription;
  export function scheduleNotificationAsync(options: {
    content: {
      title?: string;
      body?: string;
      data?: Record<string, unknown>;
      sound?: string;
    };
    identifier?: string;
    trigger: Record<string, unknown>;
  }): Promise<string>;
  export function cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  export function cancelAllScheduledNotificationsAsync(): Promise<void>;
  export function getAllScheduledNotificationsAsync(): Promise<
    Array<{ identifier: string }>
  >;
}
