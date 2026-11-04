"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AZURE_FIELD_CONFIDENCE_THRESHOLD = "0.85";

const { parseAzureOutput } = require("../services/logicEngine");

test("preserves dynamic Azure field values, types, content, and confidence", () => {
  const parsed = parseAzureOutput({
    content: "Synthetic test document",
    documents: [{
      docType: "synthetic-test",
      fields: {
        HolderName: {
          type: "string",
          valueString: "Test User",
          content: "Test User",
          confidence: 0.97,
        },
        ExpiryDate: {
          type: "date",
          valueDate: new Date("2030-06-15T00:00:00.000Z"),
          confidence: 0.85,
        },
        Amount: {
          type: "currency",
          valueCurrency: { amount: 125.5, currencyCode: "USD" },
          confidence: 0.7,
        },
        UnknownField: {
          type: "string",
          valueString: "Preserve me",
        },
      },
    }],
  });

  assert.equal(parsed.extractedFields.HolderName.type, "string");
  assert.equal(parsed.extractedFields.HolderName.value, "Test User");
  assert.equal(parsed.extractedFields.HolderName.content, "Test User");
  assert.equal(parsed.extractedFields.HolderName.confidence, 0.97);
  assert.equal(parsed.extractedFields.HolderName.needsReview, false);

  assert.equal(parsed.extractedFields.ExpiryDate.value, "2030-06-15T00:00:00.000Z");
  assert.equal(parsed.extractedFields.ExpiryDate.confidence, 0.85);
  assert.equal(parsed.extractedFields.ExpiryDate.needsReview, false);

  assert.deepEqual(parsed.extractedFields.Amount.value, {
    amount: 125.5,
    currencyCode: "USD",
  });
  assert.equal(parsed.extractedFields.Amount.confidence, 0.7);
  assert.equal(parsed.extractedFields.Amount.needsReview, true);

  assert.equal(parsed.extractedFields.UnknownField.value, "Preserve me");
  assert.equal(parsed.extractedFields.UnknownField.confidence, null);
  assert.equal(parsed.extractedFields.UnknownField.needsReview, true);
});

test("preserves supported scalar Azure field types", () => {
  const fields = {
    Text: { type: "string", valueString: "hello", confidence: 0.9 },
    Date: { type: "date", valueDate: "2030-01-02", confidence: 0.9 },
    Count: { type: "integer", valueInteger: 4, confidence: 0.9 },
    Score: { type: "number", valueNumber: 12.5, confidence: 0.9 },
    Enabled: { type: "boolean", valueBoolean: true, confidence: 0.9 },
    Phone: { type: "phoneNumber", valuePhoneNumber: "+1-555-0100", confidence: 0.9 },
    Address: {
      type: "address",
      valueAddress: { city: "Malvar", countryRegion: "Philippines" },
      confidence: 0.9,
    },
    Selection: { type: "selectionMark", valueSelectionMark: "selected", confidence: 0.9 },
  };

  const parsed = parseAzureOutput({ documents: [{ fields }] });

  assert.equal(parsed.extractedFields.Text.value, "hello");
  assert.equal(parsed.extractedFields.Date.value, "2030-01-02");
  assert.equal(parsed.extractedFields.Count.value, 4);
  assert.equal(parsed.extractedFields.Score.value, 12.5);
  assert.equal(parsed.extractedFields.Enabled.value, true);
  assert.equal(parsed.extractedFields.Phone.value, "+1-555-0100");
  assert.deepEqual(parsed.extractedFields.Address.value, {
    city: "Malvar",
    countryRegion: "Philippines",
  });
  assert.equal(parsed.extractedFields.Selection.value, "selected");
});

test("preserves nested arrays and objects without flattening them", () => {
  const parsed = parseAzureOutput({
    documents: [{
      fields: {
        Items: {
          type: "array",
          valueArray: [
            { type: "string", valueString: "first", confidence: 0.95 },
            { type: "integer", valueInteger: 2, confidence: 0.6 },
          ],
          confidence: 0.9,
        },
        Contact: {
          type: "object",
          valueObject: {
            Name: { type: "string", valueString: "Sample", confidence: 0.9 },
          },
          confidence: 0.9,
        },
      },
    }],
  });

  assert.equal(parsed.extractedFields.Items.value[0].value, "first");
  assert.equal(parsed.extractedFields.Items.value[0].confidence, 0.95);
  assert.equal(parsed.extractedFields.Items.value[1].value, 2);
  assert.equal(parsed.extractedFields.Items.value[1].needsReview, true);

  assert.equal(parsed.extractedFields.Contact.value.Name.value, "Sample");
  assert.equal(parsed.extractedFields.Contact.value.Name.confidence, 0.9);
});

test("keeps completeness separate from Azure field confidence and leaves risk unassessed", () => {
  const parsed = parseAzureOutput({
    content: "Synthetic text",
    documents: [{
      docType: "synthetic-test",
      fields: {
        Title: { type: "string", valueString: "Sample", confidence: 0.99 },
      },
    }],
  });

  assert.equal(parsed.confidence, 20);
  assert.equal(parsed.riskScore, null);
  assert.equal(parsed.riskLevel, null);
});

test("invalid field confidence values are not treated as genuine confidence", () => {
  const parsed = parseAzureOutput({
    documents: [{
      fields: {
        Missing: { type: "string", valueString: "a" },
        NaNConfidence: { type: "string", valueString: "b", confidence: NaN },
        OutOfRange: { type: "string", valueString: "c", confidence: 1.2 },
      },
    }],
  });

  for (const name of ["Missing", "NaNConfidence", "OutOfRange"]) {
    assert.equal(parsed.extractedFields[name].confidence, null);
    assert.equal(parsed.extractedFields[name].needsReview, true);
  }
});