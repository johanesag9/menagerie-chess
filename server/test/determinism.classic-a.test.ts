import { determinismSuite } from './determinism';

// Classic is the slow one (chess.js), so it runs as two files side by side.
determinismSuite('classic', 1, 50);
