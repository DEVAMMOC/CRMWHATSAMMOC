// apps/api/src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3001',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  evolution: {
    url: process.env.EVOLUTION_URL ?? '',
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
  },
});
