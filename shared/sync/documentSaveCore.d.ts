export declare const SAVE_STAGE: Readonly<{
  LOCAL_INSERT: "localInsert";
  CLOUD_COMPENSATION: "cloudCompensation";
  HISTORY: "history";
  REMINDERS: "reminders";
  SYNC: "sync";
}>;

export declare class DocumentSaveError extends Error {
  stage: string;
  cause: unknown;
  cloudId: number | null;
  compensated: boolean;
  constructor(
    message: string,
    details?: {
      stage?: string;
      cause?: unknown;
      cloudId?: number | null;
      compensated?: boolean;
    },
  );
}

export interface SaveWarning {
  stage: string;
  message: string;
}

export interface DocumentSaveResult {
  localId: number;
  cloudId: number | null;
  warnings: SaveWarning[];
  syncAttempted: boolean;
  syncSucceeded: boolean;
  savedLocally: boolean;
}

export interface DocumentSaveDeps {
  createLocal: (payload: Record<string, any>) => Promise<number>;
  logAction?: (localId: number, payload: Record<string, any>) => Promise<void>;
  scheduleReminders?: (
    localId: number,
    payload: Record<string, any>,
  ) => Promise<void>;
  deleteCloudDraft?: (cloudId: number) => Promise<void>;
  requestSync?: (localId: number) => Promise<boolean | { synced?: boolean }>;
  onInternalError?: (
    error: unknown,
    context: { stage: string; docId?: number },
  ) => void;
}

export declare function saveNewDocument(
  payload: Record<string, any>,
  deps: DocumentSaveDeps,
): Promise<DocumentSaveResult>;
