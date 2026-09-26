export interface UploadUrlResponse {
  uploadUrl: string;
  storagePath?: string;
  s3Key?: string;
  fileUrl: string;
}

export interface DocumentRecordResponse {
  document?: { id: string | number };
  data?: { document?: { id: string | number } };
  id?: string | number;
}

export interface ProcessDocumentResponse {
  extractedData?: {
    title?: string;
    issuer?: string;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    category?: string;
    confidence?: number;
  };
}

export const documents = {
  getUploadUrl: async (
    fileName: string,
    fileType: string,
  ): Promise<UploadUrlResponse> => {
    // Replace with your actual implementation (e.g., axios or fetch)
    throw new Error("Implement getUploadUrl in your API service");
  },

  uploadToS3: async (
    uploadUrl: string,
    imageUri: string,
    fileType: string,
  ): Promise<void> => {
    // Replace with your actual implementation
    throw new Error("Implement uploadToS3 in your API service");
  },

  create: async (payload: any): Promise<DocumentRecordResponse> => {
    // Replace with your actual implementation
    throw new Error("Implement create in your API service");
  },

  processDocument: async (
    documentId: number,
  ): Promise<ProcessDocumentResponse> => {
    // Replace with your actual implementation
    throw new Error("Implement processDocument in your API service");
  },
};
