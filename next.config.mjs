/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key:'X-Content-Type-Options',value:'nosniff' }, { key:'Referrer-Policy',value:'same-origin' },
      { key:'X-Frame-Options',value:'SAMEORIGIN' }, { key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()' },
      // A script-src without nonces would break App Router hydration. Enforce compatible restrictions first.
      { key:'Content-Security-Policy',value:"base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'" },
    ] }, {source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store'}]}];
  },
};
export default config;
