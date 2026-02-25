/**
 * @ng/tools-express
 *
 * Express.js HTTP server handle — programmatic route management and static file serving.
 * All methods accept serializable arguments so they work through HandleActorAdapter.
 */

import { Handle } from '@ng/handles-handle';
import { BaseDataSource } from '@ng/handles-data-sources-base';

/**
 * DataSource for Express server state.
 * Holds the Express app, server instance, route definitions, and static dirs.
 */
export class ExpressDataSource extends BaseDataSource {
  /**
   * @param {Object} [options]
   * @param {Object} [options.resourceManager] - ResourceManager instance (passed by RM)
   */
  constructor(options = {}) {
    super();
    /** @type {Object|null} Express app instance */
    this._app = null;
    /** @type {Object|null} HTTP server instance */
    this._server = null;
    /** @type {number|null} Bound port */
    this._port = null;
    /** @type {Array<Object>} Route definitions (applied or queued) */
    this._routes = [];
    /** @type {Array<Object>} Static directory mappings */
    this._staticDirs = [];
    /** @type {boolean} Whether the server is listening */
    this._running = false;
  }

  /**
   * @returns {Array}
   */
  query() {
    return [];
  }

  /**
   * @returns {{ type: string, version: string, operations: string[] }}
   */
  _getSchema() {
    return {
      type: 'express',
      version: '1.0.0',
      operations: ['start', 'stop', 'addJsonRoute', 'addTextRoute', 'addStaticDir']
    };
  }
}

/**
 * Handle for managing an Express HTTP server.
 *
 * All public methods accept only serializable arguments (strings, numbers, plain objects)
 * so they work correctly through HandleActorAdapter's `receive(method, { args })` pattern.
 */
export class ExpressHandle extends Handle {
  static handleMetadata = {
    name: 'express',
    description: 'Express HTTP server handle — start/stop servers, add JSON/text routes, serve static files',
    keywords: ['express', 'http', 'server', 'web', 'routes', 'api'],
    category: 'web'
  };

  static methodMetadata = {
    start: {
      agentFriendly: true,
      description: 'Start the Express server. Port 0 assigns a random available port.',
      parameters: [
        { name: 'port', type: 'number', optional: true, description: 'Port to listen on (default 0 = random)' }
      ]
    },
    stop: {
      agentFriendly: true,
      description: 'Stop the running Express server.',
      parameters: []
    },
    addJsonRoute: {
      agentFriendly: true,
      description: 'Add a declarative JSON endpoint. Route responds with the given JSON body.',
      parameters: [
        { name: 'method', type: 'string', description: 'HTTP method: get, post, put, delete' },
        { name: 'path', type: 'string', description: 'URL path (e.g. "/api/health")' },
        { name: 'responseBody', type: 'object', description: 'JSON object to return' },
        { name: 'statusCode', type: 'number', optional: true, description: 'HTTP status code (default 200)' }
      ]
    },
    addTextRoute: {
      agentFriendly: true,
      description: 'Add a declarative text/HTML endpoint.',
      parameters: [
        { name: 'method', type: 'string', description: 'HTTP method: get, post, put, delete' },
        { name: 'path', type: 'string', description: 'URL path (e.g. "/hello")' },
        { name: 'responseText', type: 'string', description: 'Text/HTML to return' },
        { name: 'contentType', type: 'string', optional: true, description: 'Content-Type header (default "text/plain")' }
      ]
    },
    addStaticDir: {
      agentFriendly: true,
      description: 'Serve static files from a filesystem directory.',
      parameters: [
        { name: 'urlPath', type: 'string', description: 'URL prefix (e.g. "/static")' },
        { name: 'fsPath', type: 'string', description: 'Absolute filesystem path to serve' }
      ]
    },
    getPort: {
      agentFriendly: true,
      description: 'Get the port the server is listening on.',
      parameters: []
    },
    getURL: {
      agentFriendly: true,
      description: 'Get the base URL of the running server.',
      parameters: []
    },
    isRunning: {
      agentFriendly: true,
      description: 'Check whether the server is currently running.',
      parameters: []
    }
  };

  /**
   * @param {ExpressDataSource} [dataSource] - DataSource instance
   */
  constructor(dataSource) {
    super(dataSource || new ExpressDataSource());
  }

  /**
   * Start the Express server.
   * @param {number} [port=0] - Port to listen on (0 = random available port)
   * @returns {Promise<{ port: number, url: string }>}
   */
  async start(port = 0) {
    if (this.dataSource._running) {
      throw new Error('Server is already running');
    }

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());

    this.dataSource._app = app;

    // Apply any queued routes
    for (const routeDef of this.dataSource._routes) {
      this._applyRoute(app, routeDef);
    }

    // Apply any queued static dirs
    for (const sd of this.dataSource._staticDirs) {
      app.use(sd.urlPath, express.static(sd.fsPath));
    }

    // Start listening
    const server = await new Promise((resolve, reject) => {
      const srv = app.listen(port, () => resolve(srv));
      srv.on('error', reject);
    });

    this.dataSource._server = server;
    this.dataSource._port = server.address().port;
    this.dataSource._running = true;

    return {
      port: this.dataSource._port,
      url: `http://localhost:${this.dataSource._port}`
    };
  }

  /**
   * Stop the running server.
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.dataSource._running || !this.dataSource._server) {
      return;
    }

    await new Promise((resolve, reject) => {
      this.dataSource._server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.dataSource._server = null;
    this.dataSource._app = null;
    this.dataSource._port = null;
    this.dataSource._running = false;
  }

  /**
   * Add a JSON route. Can be called before or after start().
   * @param {string} method - HTTP method (get, post, put, delete)
   * @param {string} path - URL path
   * @param {Object} responseBody - JSON body to return
   * @param {number} [statusCode=200] - HTTP status code
   * @returns {{ method: string, path: string, type: string }}
   */
  addJsonRoute(method, path, responseBody, statusCode = 200) {
    const routeDef = { type: 'json', method: method.toLowerCase(), path, responseBody, statusCode };
    this.dataSource._routes.push(routeDef);

    // If server is already running, apply immediately
    if (this.dataSource._app) {
      this._applyRoute(this.dataSource._app, routeDef);
    }

    return { method: routeDef.method, path, type: 'json' };
  }

  /**
   * Add a text/HTML route. Can be called before or after start().
   * @param {string} method - HTTP method
   * @param {string} path - URL path
   * @param {string} responseText - Text/HTML to return
   * @param {string} [contentType='text/plain'] - Content-Type header
   * @returns {{ method: string, path: string, type: string }}
   */
  addTextRoute(method, path, responseText, contentType = 'text/plain') {
    const routeDef = { type: 'text', method: method.toLowerCase(), path, responseText, contentType };
    this.dataSource._routes.push(routeDef);

    if (this.dataSource._app) {
      this._applyRoute(this.dataSource._app, routeDef);
    }

    return { method: routeDef.method, path, type: 'text' };
  }

  /**
   * Serve static files from a directory. Can be called before or after start().
   * @param {string} urlPath - URL prefix
   * @param {string} fsPath - Filesystem path
   * @returns {{ urlPath: string, fsPath: string }}
   */
  addStaticDir(urlPath, fsPath) {
    const sd = { urlPath, fsPath };
    this.dataSource._staticDirs.push(sd);

    if (this.dataSource._app) {
      import('express').then(mod => {
        this.dataSource._app.use(urlPath, mod.default.static(fsPath));
      });
    }

    return { urlPath, fsPath };
  }

  /**
   * Get the port the server is listening on.
   * @returns {number|null}
   */
  getPort() {
    return this.dataSource._port;
  }

  /**
   * Get the base URL of the running server.
   * @returns {string|null}
   */
  getURL() {
    if (!this.dataSource._port) return null;
    return `http://localhost:${this.dataSource._port}`;
  }

  /**
   * Check whether the server is running.
   * @returns {boolean}
   */
  isRunning() {
    return this.dataSource._running;
  }

  /**
   * Apply a route definition to an Express app.
   * @param {Object} app - Express app instance
   * @param {Object} routeDef - Route definition
   * @private
   */
  _applyRoute(app, routeDef) {
    const handler = routeDef.type === 'json'
      ? (_req, res) => res.status(routeDef.statusCode).json(routeDef.responseBody)
      : (_req, res) => res.status(200).type(routeDef.contentType).send(routeDef.responseText);

    app[routeDef.method](routeDef.path, handler);
  }
}

export default ExpressHandle;
