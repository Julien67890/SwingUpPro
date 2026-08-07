/* =========================================================
   SwingUpPro - Service Worker
   Incrémente CACHE_VERSION à chaque mise en ligne
   pour forcer le rafraîchissement chez les utilisateurs.
   ========================================================= */
const CACHE_VERSION = 'swinguppro-v24';

/* Fichiers de l'application, mis en cache à l'installation */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './confidentialite.html',
  './privacy.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

/* Domaines externes : mis en cache à l'usage, jamais bloquants */
const RUNTIME_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com'
];

/* ---------- installation ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pré-cache partiel :', err))
  );
});

/* ---------- activation : purge des anciens caches ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- interception des requêtes ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  /* On ne touche qu'aux GET */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Extensions du navigateur (chrome-extension://) et autres schémas :
     le cache refuse de les stocker, on les laisse passer intactes. */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Domaines tiers non prévus (mesure d'audience, Stripe, etc.) :
     on ne s'en mêle pas. Les intercepter faisait remonter une erreur
     dès qu'un bloqueur ou une coupure réseau faisait échouer l'appel. */
  if (url.origin !== self.location.origin && !RUNTIME_HOSTS.includes(url.hostname)) return;

  /* Firebase / Firestore : toujours le réseau, jamais de cache.
     Sinon les données de compte seraient servies périmées. */
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis.com') &&
      !RUNTIME_HOSTS.includes(url.hostname)) {
    return;
  }

  /* Navigation (ouverture de la page) : réseau d'abord, cache en secours.
     Garantit qu'une mise à jour du HTML est vue immédiatement en ligne,
     et que l'appli s'ouvre quand même hors ligne. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Ressources externes autorisées (polices, SDK Firebase) :
     cache d'abord, réseau en secours et mise en cache au passage. */
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  /* Fichiers de l'appli : cache d'abord, réseau en secours. */
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
