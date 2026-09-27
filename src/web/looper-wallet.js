/**
 * Looper wallet shim — injected into agent-built pages that reference
 * window.ethereum. It gives a dapp preview a wallet-shaped API:
 *
 *   reads   → this runtime's read proxy (/api/web3/rpc) — works with no wallet
 *             installed at all, mainnet Base.
 *   wallet  → the console HOST bridge → the operator's real wallet, behind a
 *             host-rendered confirmation panel (decoded + simulated). The
 *             build can ask; only the operator can approve.
 *
 * If a real wallet already exists (the page downloaded and hosted for real),
 * the shim stands down — window.ethereum there is the extension's.
 */
(function () {
  if (window.ethereum) return;

  var src = '';
  try {
    src = (document.currentScript && document.currentScript.src) || '';
  } catch (e) {
    /* ignore */
  }
  var token = '';
  try {
    token = new URL(src, document.baseURI || location.href).searchParams.get('token') || '';
  } catch (e) {
    /* ignore */
  }
  var apiUrl = '/api/web3/rpc' + (token ? '?token=' + encodeURIComponent(token) : '');

  var READ_METHODS = {
    eth_chainId: 1,
    net_version: 1,
    web3_clientVersion: 1,
    eth_blockNumber: 1,
    eth_getBalance: 1,
    eth_call: 1,
    eth_getCode: 1,
    eth_getStorageAt: 1,
    eth_getTransactionCount: 1,
    eth_gasPrice: 1,
    eth_estimateGas: 1,
    eth_getLogs: 1,
    eth_getTransactionReceipt: 1,
    eth_getTransactionByHash: 1,
  };

  var pending = {};
  var seq = 0;

  function fail(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function readViaProxy(method, params) {
    return fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: params || [] }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          throw fail('read proxy: bad response (HTTP ' + r.status + ')', -32603);
        });
      })
      .then(function (b) {
        if (!b || b.error) throw fail((b && b.error && b.error.message) || 'read failed', (b && b.error && b.error.code) || -32603);
        return b.result;
      });
  }

  function viaHost(method, params) {
    return new Promise(function (resolve, reject) {
      if (window.parent === window) {
        reject(
          fail(
            'wallet bridge unavailable — this page is not inside the console preview. Host it yourself (a real wallet extension then takes over) or open it from the console builds tab.',
            4901,
          ),
        );
        return;
      }
      var id = 'lw' + ++seq;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(fail('wallet request timed out after 3 minutes', 4901));
      }, 180000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      window.parent.postMessage({ type: 'looper-wallet-request', id: id, method: method, params: params || [] }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d || d.type !== 'looper-wallet-response' || !d.id) return;
    var p = pending[d.id];
    if (!p) return;
    delete pending[d.id];
    clearTimeout(p.timer);
    if (d.error) p.reject(fail(d.error.message || 'request failed', d.error.code));
    else p.resolve(d.result);
  });

  var ethereum = {
    isLooperShim: true,
    request: function (args) {
      args = args || {};
      return READ_METHODS[args.method] ? readViaProxy(args.method, args.params) : viaHost(args.method, args.params);
    },
    on: function () {
      return ethereum;
    },
    addListener: function () {
      return ethereum;
    },
    removeListener: function () {
      return ethereum;
    },
    removeAllListeners: function () {
      return ethereum;
    },
  };

  try {
    Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });
  } catch (e) {
    window.ethereum = ethereum;
  }
  try {
    window.dispatchEvent(new Event('ethereum#initialized'));
  } catch (e) {
    /* ignore */
  }
})();
