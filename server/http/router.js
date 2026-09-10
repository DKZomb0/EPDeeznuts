/**
 * A small pattern router.
 *
 * Enough for a JSON API with `:param` segments, and nothing more - the app has
 * no framework, so what it does have should be readable in one sitting.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    this.routes.push({ method, ...compile(pattern), handler, ...options });
    return this;
  }

  get(pattern, handler, options) {
    return this.add('GET', pattern, handler, options);
  }

  post(pattern, handler, options) {
    return this.add('POST', pattern, handler, options);
  }

  patch(pattern, handler, options) {
    return this.add('PATCH', pattern, handler, options);
  }

  put(pattern, handler, options) {
    return this.add('PUT', pattern, handler, options);
  }

  delete(pattern, handler, options) {
    return this.add('DELETE', pattern, handler, options);
  }

  /** Mount another router's routes under a prefix. */
  use(prefix, router) {
    for (const route of router.routes) {
      this.add(route.method, prefix + route.source, route.handler, { public: route.public });
    }
    return this;
  }

  match(method, pathname) {
    let pathExists = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    // Distinguishing 404 from 405 saves a lot of guessing during integration.
    return pathExists ? { methodMismatch: true } : null;
  }
}

function compile(pattern) {
  const keys = [];
  const regexSource = pattern
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '/([^/]+)';
      }
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    })
    .join('');
  return { source: pattern, keys, regex: new RegExp(`^${regexSource || '/'}/?$`) };
}
