import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('/api/data', 'routes/api.data.tsx'),
] satisfies RouteConfig;
