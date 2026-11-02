/**
 * Collects teardown functions so every listener, timer and subscription
 * registered while the widget is mounted is released when it unmounts.
 */
export class Disposer {
  constructor() {
    this._fns = [];
  }

  /** Register a teardown function. Returns it for convenience. */
  add(fn) {
    if (typeof fn === 'function') this._fns.push(fn);
    return fn;
  }

  /** Add a DOM event listener and register its removal. */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.add(() => target.removeEventListener(type, handler, options));
  }

  interval(fn, ms) {
    const id = setInterval(fn, ms);
    this.add(() => clearInterval(id));
    return id;
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.add(() => clearTimeout(id));
    return id;
  }

  /** Run all teardown functions in reverse order. Errors never escape. */
  dispose() {
    const fns = this._fns.splice(0).reverse();
    for (const fn of fns) {
      try {
        fn();
      } catch {
        /* teardown must never throw */
      }
    }
  }
}

/** Tiny observable used by the services to notify the UI. */
export class Emitter {
  constructor() {
    this._subs = new Set();
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  emit(value) {
    for (const fn of [...this._subs]) {
      try {
        fn(value);
      } catch {
        /* one broken subscriber must not break the others */
      }
    }
  }

  clear() {
    this._subs.clear();
  }
}
