/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // undici precisa rodar como dependência nativa do Node (proxy de IP fixo)
  serverExternalPackages: ["undici"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Nenhuma resposta de API pode ser cacheada por proxies ou pelo navegador.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
