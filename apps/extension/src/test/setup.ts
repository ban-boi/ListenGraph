// Vitest globals are injected automatically when globals: true is set in config
// This file sets up browser mocks

import '@testing-library/jest-dom';

// Set up chrome global before any imports
(globalThis as any).chrome = {
  storage: {
    session: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    id: 'test-extension-id',
    lastError: null,
    sendMessage: vi.fn(() => Promise.resolve({ success: true })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onSuspend: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  tabs: {
    query: vi.fn(
      (
        _queryInfo: chrome.tabs.QueryInfo,
        callback?: (tabs: chrome.tabs.Tab[]) => void,
      ) => {
        const tabs = [{ id: 1, active: true, currentWindow: true }];
        if (callback) {
          callback(tabs as unknown as chrome.tabs.Tab[]);
          return;
        }
        return Promise.resolve(tabs);
      },
    ),
    sendMessage: vi.fn(() => Promise.resolve({ success: true })),
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
  },
  sidePanel: {
    setOptions: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve()),
  },
};

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(globalThis as any).ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
}
(globalThis as any).IntersectionObserver = IntersectionObserverMock;

// Mock URL.createObjectURL
(globalThis as any).URL = {
  createObjectURL: vi.fn(() => 'blob:test-url'),
  revokeObjectURL: vi.fn(),
};
