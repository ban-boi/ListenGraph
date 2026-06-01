// Vitest globals are injected automatically when globals: true is set in config
// This file sets up browser mocks

import '@testing-library/jest-dom';

// Set up chrome global before any imports
(globalThis as Record<string, unknown>).chrome = {
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
  scripting: {
    executeScript: vi.fn(() => Promise.resolve()),
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

if (typeof window !== 'undefined') {
  // Mock DOMMatrixReadOnly — jsdom 未提供此构造函数，React Flow 的 updateNodeDimensions 会调用
  const win = window as unknown as Record<string, unknown>;
  if (typeof win.DOMMatrixReadOnly === 'undefined') {
    win.DOMMatrixReadOnly = class DOMMatrixReadOnly {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true; isIdentity = true;
    };
  }

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
}

// Mock ResizeObserver：observe 时同步回调，避免 jsdom 下 clientWidth=0 导致依赖尺寸的 UI 永远不执行
class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe = vi.fn((target: Element) => {
    const rect = target.getBoundingClientRect();
    const width = rect.width > 1 ? rect.width : 1024;
    const height = rect.height > 1 ? rect.height : 768;
    const contentRect = new DOMRect(0, 0, width, height);
    this.callback(
      [
        {
          target,
          contentRect,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ],
      this,
    );
  });
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
}
(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverMock;

// Preserve the native URL constructor so code that relies on URL parsing
// (for example real fetch requests in provider tests) keeps working.
Object.defineProperty(globalThis.URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(() => 'blob:test-url'),
});
Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});
