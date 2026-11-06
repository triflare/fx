// The headless VM adapter lives in src/ so `fx test` and the test suite load
// the same storage, renderer, and DOM stand-ins.
export { createVm, loadProject } from "../../src/vm.js";
