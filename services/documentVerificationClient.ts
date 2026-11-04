export interface AzureOCRResponse {
  documentType?: string;
  fields?: {
    documentNumber?: { content: string };
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
    const { selectedSpecificId, azureOcrResult } = payload;
    const docType = (azureOcrResult.documentType || "").toLowerCase();

    // 1. Specific Passport Validation
    if (selectedSpecificId === "philippine-passport") {
      if (!azureOcrResult.passportModel && docType !== "passport") {
        return {
          allow_processing: false,
          error_code: "DOCUMENT_TYPE_MISMATCH",
          message:
            "Verification halted. You selected Philippine Passport, but the system detected an incompatible layout. Please upload the correct physical document.",
        };
      }
    } else {
      // 2. Flexible General ID / Driver's License / Government ID Validation
      // Azure often returns generic tags like "identitycard", "idcard", "driverslicense", or empty for IDs.
      const isIdFamily = [
        "driver",
        "license",
        "id",
        "card",
        "identity",
        "postal",
        "unified",
        "prc",
        "tin",
        "philhealth",
        "sss",
      ].some((keyword) => selectedSpecificId.toLowerCase().includes(keyword));

      if (docType && isIdFamily) {
        // If Azure detects any standard identity document model, allow it through
        const acceptedAzureTypes = [
          "identitycard",
          "idcard",
          "driverslicense",
          "document",
          selectedSpecificId.toLowerCase(),
        ];

        const isCompatible = acceptedAzureTypes.some((type) =>
          docType.includes(type),
        );

        if (!isCompatible && docType !== selectedSpecificId.toLowerCase()) {
          return {
            allow_processing: false,
            error_code: "DOCUMENT_TYPE_MISMATCH",
            message: `Verification halted. You selected document type [${selectedSpecificId}], but the system detected an incompatible layout. Please upload the correct physical document.`,
          };
        }
      } else if (docType && docType !== selectedSpecificId.toLowerCase()) {
        // Fallback strict check for other specialized forms
        return {
          allow_processing: false,
          error_code: "DOCUMENT_TYPE_MISMATCH",
          message: `Verification halted. You selected document type [${selectedSpecificId}], but the system detected an incompatible layout. Please upload the correct physical document.`,
        };
      }
    }

    const rawDocNum = azureOcrResult.fields?.documentNumber?.content;
    if (!rawDocNum) {
      return {
        allow_processing: false,
        error_code: "DOCUMENT_TYPE_MISMATCH",
        message:
          "Verification halted. The uploaded document image is blurry, unreadable, or missing core identifying numbers.",
      };
    }

    const documentNumber = this.cleanDocumentNumber(rawDocNum);
    const issueDate =
      this.normalizeDate(azureOcrResult.fields?.issueDate?.content) || "";

    const rawExpiry = azureOcrResult.fields?.expiryDate?.content;
    const hasNoExpirationDate =
      !rawExpiry ||
      rawExpiry.toLowerCase().includes("lifetime") ||
      rawExpiry.toLowerCase().includes("indefinite") ||
      selectedSpecificId === "birth-certificate" ||
      selectedSpecificId === "national-id";

    const expiryDate = hasNoExpirationDate
      ? null
      : this.normalizeDate(rawExpiry);

    return {
      allow_processing: true,
      error_code: null,
      message: "Document validated and fields parsed successfully.",
      extracted_data: {
        documentNumber,
        issueDate,
        expiryDate,
        hasNoExpirationDate,
      },
    };
  }
}

export function verifyDocumentWithOrchestrator(
  request: VerificationRequest,
): VerificationResponse {
  return DocumentVerificationOrchestrator.verifyAndExtract(request);
}
