// JavaScript config to avoid requiring TypeScript at runtime
/** @type {import('next').NextConfig} */
module.exports = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/radius_login',
        permanent: true,
      },
    ];
  },
};
