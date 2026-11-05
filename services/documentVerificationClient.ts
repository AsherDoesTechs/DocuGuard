export interface AzureOCRResponse {
  documentType?: string;
  fields?: {
    documentNumber?: { content: string };
    licenseNumber?: { content: string };
    idNumber?: { content: string };
    cardNumber?: { content: string };
    issueDate?: { content: string };
    expiryDate?: { content: string };
    [key: string]: any;
  };
  passportModel?: boolean;
}

export interface VerificationRequest {
  selectedSpecificId: string;
  azureOcrResult: AzureOCRResponse;
}

export type VerificationResponse =
  | {
      allow_processing: false;
      error_code: "DOCUMENT_TYPE_MISMATCH";
      message: string;
    }
  | {
      allow_processing: true;
      error_code: null;
      message: string;
      extracted_data: {
        documentNumber: string;
        issueDate: string;
        expiryDate: string | null;
        hasNoExpirationDate: boolean;
      };
    };

export class DocumentVerificationOrchestrator {
  private static normalizeDate(dateStr?: string): string | null {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString().split("T")[0];
  }

  private static cleanDocumentNumber(rawNumber?: string): string {
    if (!rawNumber) return "";
    return rawNumber.replace(/[\s\-_]/g, "").toUpperCase();
  }

  public static verifyAndExtract(
    payload: VerificationRequest,
  ): VerificationResponse {
    console.log("=== [DocumentVerificationOrchestrator] START ===");
    console.log("Received Payload:", JSON.stringify(payload, null, 2));

    const { selectedSpecificId, azureOcrResult } = payload;
    const docType = (azureOcrResult.documentType || "")
      .toLowerCase()
      .replace(/[\s\-_]/g, "");
    const normalizedSelectedId = (selectedSpecificId || "")
      .toLowerCase()
      .replace(/[\s\-_]/g, "");

    console.log(
      `Parsed Normalized ID: "${normalizedSelectedId}" | Parsed Doc Type: "${docType}"`,
    );

    // Support fallback keys for document/license numbers returned by Azure OCR
    const fields = azureOcrResult.fields || {};

    const getFieldContent = (fieldObj: any) => {
      if (!fieldObj) return null;
      if (typeof fieldObj === "string") return fieldObj;
      return fieldObj.content ?? fieldObj.value ?? null;
    };

    const rawDocNum =
      getFieldContent(fields.documentNumber) ||
      getFieldContent(fields.licenseNumber) ||
      getFieldContent(fields.idNumber) ||
      getFieldContent(fields.cardNumber);

    console.log(`Extracted Raw Document Number: "${rawDocNum}"`);

    // SAFETY CHECK: Only block if the entire response and fields are completely empty (non-document / blank image).
    const hasAnyFields = Object.keys(fields).length > 0 || rawDocNum;
    if (!hasAnyFields && !docType) {
      console.warn(
        "[DocumentVerificationOrchestrator] Halted: Image is completely unreadable or blank.",
      );
      return {
        allow_processing: false,
        error_code: "DOCUMENT_TYPE_MISMATCH",
        message:
          "Verification halted. The uploaded document image is unreadable or does not appear to be a valid document.",
      };
    }

    const documentNumber = this.cleanDocumentNumber(rawDocNum || "");
    const issueDate =
      this.normalizeDate(getFieldContent(fields.issueDate)) || "";

    const rawExpiry = getFieldContent(fields.expiryDate);
    const hasNoExpirationDate =
      !rawExpiry ||
      String(rawExpiry).toLowerCase().includes("lifetime") ||
      String(rawExpiry).toLowerCase().includes("indefinite") ||
      normalizedSelectedId.includes("birthcertificate") ||
      normalizedSelectedId.includes("nationalid");

    const expiryDate = hasNoExpirationDate
      ? null
      : this.normalizeDate(String(rawExpiry));

    const successResponse: VerificationResponse = {
      allow_processing: true,
      error_code: null,
      message: "Document scanned. Please review the extracted fields.",
      extracted_data: {
        documentNumber,
        issueDate,
        expiryDate,
        hasNoExpirationDate,
      },
    };

    console.log(
      "Verification Success Output:",
      JSON.stringify(successResponse, null, 2),
    );
    console.log("=== [DocumentVerificationOrchestrator] END ===");

    return successResponse;
  }
}

export function verifyDocumentWithOrchestrator(
  request: VerificationRequest,
): VerificationResponse {
  return DocumentVerificationOrchestrator.verifyAndExtract(request);
}
