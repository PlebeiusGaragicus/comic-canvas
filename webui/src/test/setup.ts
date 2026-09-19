import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { installOpfsShim, resetOpfsShim } from './opfsShim';
import { resetDbConnectionForTests } from '../store/db';
import { releaseAllUrls } from '../store/objectUrls';

installOpfsShim();

// jsdom's createObjectURL cannot wrap the shim's File objects; stub it.
let objectUrlCounter = 0;
URL.createObjectURL = () => `blob:test/${(objectUrlCounter += 1)}`;
URL.revokeObjectURL = () => undefined;

beforeEach(() => {
  // Fresh database and OPFS root per test.
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  resetDbConnectionForTests();
  resetOpfsShim();
});

afterEach(() => {
  releaseAllUrls();
});
