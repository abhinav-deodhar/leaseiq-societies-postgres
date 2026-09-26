import assert from "node:assert/strict";
import test from "node:test";
import {
  documentStorageConfig,
  DocumentStorageConfigurationError,
} from "../src/lib/server/storage/document-storage";

const valid = {
  BUCKET: "leaseiq-documents-example",
  ENDPOINT: "https://storage.example.com",
  REGION: "auto",
  ACCESS_KEY_ID: "test-key",
  SECRET_ACCESS_KEY: "test-secret",
  DOCUMENT_STORAGE_URL_STYLE: "virtual",
};

test("accepts virtual-hosted configuration", () => {
  const config = documentStorageConfig(valid);
  assert.equal(config.bucket, valid.BUCKET);
  assert.equal(config.endpoint, valid.ENDPOINT);
  assert.equal(config.forcePathStyle, false);
});

test("supports explicitly configured path-style buckets", () => {
  assert.equal(documentStorageConfig({
    ...valid,
    DOCUMENT_STORAGE_URL_STYLE: "path",
  }).forcePathStyle, true);
});

test("rejects every missing setting", () => {
  for (const name of Object.keys(valid)) {
    assert.throws(
      () => documentStorageConfig({ ...valid, [name]: "" }),
      DocumentStorageConfigurationError,
    );
  }
});

test("rejects unsafe or malformed endpoints", () => {
  for (const endpoint of [
    "http://storage.example.com",
    "https://user:password@storage.example.com",
    "https://storage.example.com/bucket",
    "https://storage.example.com?secret=value",
    "https://storage.example.com#fragment",
    "not-a-url",
  ]) {
    assert.throws(
      () => documentStorageConfig({
        ...valid,
        ENDPOINT: endpoint,
      }),
      DocumentStorageConfigurationError,
    );
  }
});

test("rejects invalid bucket names and unknown URL styles", () => {
  assert.throws(
    () => documentStorageConfig({
      ...valid,
      BUCKET: "../another-bucket",
    }),
    DocumentStorageConfigurationError,
  );
  assert.throws(
    () => documentStorageConfig({
      ...valid,
      DOCUMENT_STORAGE_URL_STYLE: "guess",
    }),
    DocumentStorageConfigurationError,
  );
});

test("configuration errors do not expose credentials", () => {
  assert.throws(
    () => documentStorageConfig({
      ...valid,
      ENDPOINT: "https://user:test-secret@example.com",
    }),
    (error: unknown) =>
      error instanceof DocumentStorageConfigurationError &&
      !error.message.includes("test-secret"),
  );
});
