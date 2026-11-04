const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAzureOutput } = require("../services/logicEngine");

test("OCR parser accepts a valid ISO issue date", () => {
  const result = parseAzureOutput({
    content: "Issue Date: 2025-05-04",
    documents: [{
      docType: "document",
      fields: {
        IssueDate: { value: "2025-05-04" },
      },
    }],
  });

  assert.equal(result.issueDate, "2025-05-04");
});

test("OCR parser accepts an unambiguous day-first numeric date", () => {
  const result = parseAzureOutput({
    content: "",
    documents: [{
      docType: "document",
      fields: {
        IssueDate: { value: "31/12/2025" },
      },
    }],
  });

  assert.equal(result.issueDate, "2025-12-31");
});

test("OCR parser rejects ambiguous numeric dates", () => {
  const result = parseAzureOutput({
    content: "",
    documents: [{
      docType: "document",
      fields: {
        IssueDate: { value: "04/05/2025" },
      },
    }],
  });

  assert.equal(result.issueDate, null);
});

test("OCR parser rejects impossible calendar dates", () => {
  const result = parseAzureOutput({
    content: "",
    documents: [{
      docType: "document",
      fields: {
        IssueDate: { value: "31/02/2025" },
      },
    }],
  });

  assert.equal(result.issueDate, null);
});

test("OCR parser leaves missing dates empty", () => {
  const result = parseAzureOutput({
    content: "An identity document with no visible dates.",
    documents: [{
      docType: "document",
      fields: {},
    }],
  });

  assert.equal(result.issueDate, null);
  assert.equal(result.expiryDate, null);
});

test("OCR completeness remains a percentage and is not authenticity", () => {
  const result = parseAzureOutput({
    content: "",
    documents: [{
      docType: "document",
      fields: {
        Title: { value: "Identity Document" },
        Issuer: { value: "Example Authority" },
        DocumentNumber: { value: "AB123456" },
        IssueDate: { value: "2025-05-04" },
        ExpiryDate: { value: "2028-05-04" },
      },
    }],
  });

  assert.equal(result.confidence, 100);
  assert.equal(result.riskScore, null);
  assert.equal(result.riskLevel, null);
});

test("OCR parser does not invent fields for empty analyzer output", () => {
  const result = parseAzureOutput({});

  assert.equal(result.issueDate, null);
  assert.equal(result.expiryDate, null);
  assert.equal(result.documentNumber, null);
  assert.equal(result.riskScore, null);
  assert.equal(result.riskLevel, null);
  assert.equal(result.confidence, 0);
});

test("OCR raw text extracts an ISO issue date", () => {
  const result = parseAzureOutput({
    content: "Issue Date: 2025-05-04",
    documents: [{ docType: "document", fields: {} }],
  });

  assert.equal(result.issueDate, "2025-05-04");
});

test("OCR raw text rejects an ambiguous issue date", () => {
  const result = parseAzureOutput({
    content: "Issue Date: 04/05/2025",
    documents: [{ docType: "document", fields: {} }],
  });

  assert.equal(result.issueDate, null);
});

test("OCR raw text rejects an impossible expiry date", () => {
  const result = parseAzureOutput({
    content: "Expiry Date: 31/02/2025",
    documents: [{ docType: "document", fields: {} }],
  });

  assert.equal(result.expiryDate, null);
});

test("OCR raw text extracts a labelled passport number", () => {
  const result = parseAzureOutput({
    content: "Passport No: A1234567",
    documents: [{ docType: "document", fields: {} }],
  });

  assert.equal(result.documentNumber, "A1234567");
});
