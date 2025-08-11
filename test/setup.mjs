// test/setup.mjs - Setup file for tests

// Note: We're not setting globalThis.crypto here
// It will be mocked in individual test files using vi.stubGlobal

// Setup TextEncoder if not available
if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = TextEncoder;
}

// Setup performance if not available
if (!globalThis.performance) {
  globalThis.performance = {
    now: () => Date.now()
  };
}

// Setup AbortSignal.timeout if not available
if (!AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

console.log('Test environment setup complete');
