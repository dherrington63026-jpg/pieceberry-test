// Connects the game's Shop and Club to RevenueCat inside the phone app. On the web it does nothing.
// Sets window.PBStore = { owned(), restore(), buy(id), prices() } before the game runs; the game asks it what the player owns at every start.
// buy/restore/owned give the list of ids the player owns WITHOUT the store prefix (pieceberry_pack_seasons -> pack_seasons);
// any active Club subscription gives 'club'. The keys below are RevenueCat's PUBLIC app keys (appl_... iPhone, goog_... Android), safe to ship.
// Needs David's RevenueCat account (one app per game). Until a key is set the game says "store not available" and sells nothing.
(function () {
  var KEYS = { ios: '', android: '' };
  var PRE = 'pieceberry_';            // = the final app name, lowercase, plus an underscore (see PRODUCTS.md); change with the name
  var ENTITLEMENT = 'club';           // the RevenueCat entitlement that both Club subscriptions unlock
  var ONE_TIME = ['pack_seasons', 'pack_harbors', 'pack_pantry', 'pack_villages', 'pack_mosaics', 'pack_friends',
    'bg_felt', 'bg_linen', 'bg_slate', 'bg_oak', 'bg_cabin', 'bg_starry',
    'style_soft', 'style_glossy', 'style_wooden', 'style_stained',
    'snd_chimes', 'snd_drops', 'snd_bubble', 'snd_paper',
    'music_zen', 'music_tea', 'music_lantern', 'music_fireside', 'music_piano', 'music_beach', 'music_lullaby', 'music_sunrise'];
  var SUBS = ['club_monthly', 'club_yearly'];
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var key = KEYS[C.getPlatform()];
  var RC = (C.Plugins && C.Plugins.Purchases) || (C.registerPlugin && C.registerPlugin('Purchases'));
  if (!key || !RC) return;            // no key yet: nothing is sold
  var ready = RC.configure({ apiKey: key });
  function strip(p) { p = String(p).split(':')[0]; return p.indexOf(PRE) === 0 ? p.slice(PRE.length) : p; }   // Google subscription ids look like id:baseplan
  function owned(res) {
    var ci = (res && (res.customerInfo || res)) || {}, out = [];
    (ci.allPurchasedProductIdentifiers || []).forEach(function (p) { p = strip(p); if (ONE_TIME.indexOf(p) >= 0) out.push(p); });
    if (ci.entitlements && ci.entitlements.active && ci.entitlements.active[ENTITLEMENT]) out.push('club');
    return out;
  }
  var cache = {};
  function products(ids, type) {
    return RC.getProducts({ productIdentifiers: ids.map(function (i) { return PRE + i; }), type: type }).then(function (r) {
      (r.products || []).forEach(function (p) { cache[strip(p.identifier)] = p; });
      return cache;
    });
  }
  window.PBStore = {
    owned: function () { return ready.then(function () { return RC.getCustomerInfo(); }).then(owned); },
    restore: function () { return ready.then(function () { return RC.restorePurchases(); }).then(owned); },
    buy: function (id) {
      var sub = SUBS.indexOf(id) >= 0;
      return ready.then(function () { return cache[id] ? cache : products([id], sub ? 'SUBSCRIPTION' : 'NON_SUBSCRIPTION'); }).then(function (c) {
        if (!c[id]) throw new Error('product not found: ' + id);
        return RC.purchaseStoreProduct({ product: c[id] });
      }).then(owned);
    },
    prices: function () {
      return ready.then(function () { return Promise.all([products(ONE_TIME, 'NON_SUBSCRIPTION'), products(SUBS, 'SUBSCRIPTION')]); }).then(function () {
        var out = {}; Object.keys(cache).forEach(function (i) { out[i] = cache[i].priceString; }); return out;
      });
    }
  };
})();
