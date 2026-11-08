/** @type {import('next').NextConfig} */
// Pin the project root: the repo root has its own package-lock.json (the SpacetimeDB starter).
const nextConfig = { turbopack: { root: import.meta.dirname } };
export default nextConfig;
