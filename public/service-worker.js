// This is a basic service worker file. 
// It's managed by the @ducanh2912/next-pwa library.
// You generally do not need to edit this file.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // The fetch event is handled by the next-pwa library which injects its own logic.
  // This file serves as a placeholder for the build process.
});
