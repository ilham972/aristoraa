// Phase 3 (§3.6) — public-board source switch, read side.
//
// Which board the app's navigation treats as PRIMARY. The flag itself lives in
// the learning-engine config (single source of truth) and stays "legacy" until
// the founder flips it to "cohort" after the parallel-run. This module is the
// thin, inert branch: while the flag is "legacy" it resolves to the existing
// /leaderboard (which is never modified); flipped to "cohort" it points nav at
// the new /leaderboard/leagues board.
//
// config.ts is pure constants (no Convex runtime imports), so importing it into
// client code is safe and tree-shakeable.

import { LEADERBOARD_PRIMARY } from '../../convex/learningEngine/config';

export const PRIMARY_BOARD_HREF: '/leaderboard' | '/leaderboard/leagues' =
  LEADERBOARD_PRIMARY === 'cohort' ? '/leaderboard/leagues' : '/leaderboard';
