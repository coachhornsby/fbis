// Deploy only the controlled handlers. Legacy helper exports are testable in
// index.js but must not become named Worker entrypoints.
export {default} from './index.js';
