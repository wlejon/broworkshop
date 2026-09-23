// What the page has done so far, shared by app.js and the headless smoke test.

export const session = {
  model: null,             // the loaded LayaModel (also model.js's `model`)
  loading: false,
  loadError: '',
  loadMs: 0,
  lastResult: null,        // last single-request result
  lastObservedMs: 0,
  singleError: '',
};
