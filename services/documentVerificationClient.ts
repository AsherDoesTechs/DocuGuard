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
    const { selectedSpecificId, azureOcrResult } = payload;
    const docType = (azureOcrResult.documentType || "")
      .toLowerCase()
      .replace(/[\s\-_]/g, "");
    const normalizedSelectedId = (selectedSpecificId || "")
      .toLowerCase()
      .replace(/[\s\-_]/g, "");

    // 1. Specific Passport Validation
    if (normalizedSelectedId.includes("passport")) {
      if (!azureOcrResult.passportModel && !docType.includes("passport")) {
        return {
          allow_processing: false,
          error_code: "DOCUMENT_TYPE_MISMATCH",
          message:
            "Verification halted. You selected Philippine Passport, but the system detected an incompatible layout. Please upload the correct physical document.",
        };
      }
    } else {
      // 2. Flexible General ID / Driver's License / Government ID Validation
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
      ].some((keyword) => normalizedSelectedId.includes(keyword));

      if (docType && isIdFamily) {
        const acceptedAzureTypes = [
          "identitycard",
          "idcard",
          "driverslicense",
          "driverlicense",
          "document",
          normalizedSelectedId,
        ];

        const isCompatible = acceptedAzureTypes.some(
          (type) => docType.includes(type) || type.includes(docType),
        );

        if (!isCompatible && docType !== "other" && docType !== "") {
          return {
            allow_processing: false,
            error_code: "DOCUMENT_TYPE_MISMATCH",
            message: `Verification halted. You selected document type [${selectedSpecificId}], but the system detected an incompatible layout. Please upload the correct physical document.`,
          };
        }
      }
    }

    // Support fallback keys for document/license numbers returned by Azure OCR
    const fields = azureOcrResult.fields || {};
    const rawDocNum =
      fields.documentNumber?.content ||
      fields.licenseNumber?.content ||
      fields.idNumber?.content ||
      fields.cardNumber?.content;

    if (!rawDocNum) {
      return {
        allow_processing: false,
        error_code: "DOCUMENT_TYPE_MISMATCH",
        message:
          "Verification halted. The uploaded document image is blurry, unreadable, or missing core identifying numbers.",
      };
    }

    const documentNumber = this.cleanDocumentNumber(rawDocNum);
    const issueDate = this.normalizeDate(fields.issueDate?.content) || "";

    const rawExpiry = fields.expiryDate?.content;
    const hasNoExpirationDate =
      !rawExpiry ||
      rawExpiry.toLowerCase().includes("lifetime") ||
      rawExpiry.toLowerCase().includes("indefinite") ||
      normalizedSelectedId.includes("birthcertificate") ||
      normalizedSelectedId.includes("nationalid");

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
