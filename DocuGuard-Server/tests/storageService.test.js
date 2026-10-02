const test = require("node:test");
const assert = require("node:assert/strict");

// The storage service builds a Supabase admin client at require time, so the
// module-level config needs placeholder credentials before it can be loaded.
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon";

const {
  validateFileType,
  ALLOWED_FILE_TYPES,
  MAX_FILE_BYTES,
  getSignedDownloadUrl,
  rehydrateFileUrls,
} = require("../services/storageService");

test("validateFileType accepts every allow-listed format", () => {
  for (const type of ALLOWED_FILE_TYPES) {
    assert.equal(validateFileType(type), null, type);
  }
});

test("validateFileType normalises case and parameters", () => {
  assert.equal(validateFileType("APPLICATION/PDF"), null);
  assert.equal(validateFileType("image/jpeg; charset=binary"), null);
  assert.equal(validateFileType("  image/PNG  "), null);
});

test("validateFileType rejects executable and markup payloads", () => {
  const rejected = [
    "application/x-msdownload",
    "application/octet-stream",
    "application/javascript",
    "text/html",
    "image/svg+xml",
    "application/x-sh",
  ];

  for (const type of rejected) {
    assert.notEqual(validateFileType(type), null, `${type} must be rejected`);
  }
});

test("validateFileType rejects a missing type instead of defaulting", () => {
  // Defaulting to application/octet-stream previously let arbitrary binaries
  // into the document bucket and on to the OCR analyzer.
  for (const type of [null, undefined, "", "   "]) {
    assert.notEqual(validateFileType(type), null, `${type} must be rejected`);
  }
});

test("MAX_FILE_BYTES is a sane upload ceiling", () => {
  assert.ok(MAX_FILE_BYTES > 0);
  assert.ok(MAX_FILE_BYTES <= 50 * 1024 * 1024);
});

test("getSignedDownloadUrl returns null for a missing key", async () => {
  assert.equal(await getSignedDownloadUrl(null), null);
  assert.equal(await getSignedDownloadUrl(""), null);
});

test("rehydrateFileUrls passes rows through when nothing can be signed", async () => {
  const documents = [
    { id: 1, title: "Passport", s3Key: null, fileUrl: "https://legacy/x.jpg" },
    { id: 2, title: "No file", s3Key: null, fileUrl: null },
  ];

  const result = await rehydrateFileUrls(documents);

  assert.equal(result.length, 2);
  assert.equal(result[0].fileUrl, "https://legacy/x.jpg");
  assert.equal(result[1].fileUrl, null);
});

test("rehydrateFileUrls never drops a row when signing throws", async () => {
  // Network/permission failures must not fail the whole document list.
  const documents = [{ id: 1, title: "Passport", s3Key: "1/abc.pdf", fileUrl: null }];

  const result = await rehydrateFileUrls(documents);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});