// Used only by the integration test. Redirect Tencent QR requests to the local fixture server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'ilinkai.weixin.qq.com') {
    return realFetch(new URL(url.pathname + url.search, process.env.TEST_WEIXIN_ORIGIN), options);
  }
  return realFetch(input, options);
};
