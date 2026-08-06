import { eq, ok } from './harness.mjs'
import { shimmerOpacity, shimmerDuration } from '../../shared/shimmer.mjs'

eq(shimmerOpacity(3, 3), 1.0, 'the highlight position is fully bright')
eq(shimmerOpacity(0, 10), 0.4, 'far from the highlight is the dim baseline')
ok(shimmerOpacity(3, 4) > 0.4 && shimmerOpacity(3, 4) < 1.0,
   'one step away is partially lit')
eq(shimmerOpacity(3, 4), shimmerOpacity(3, 2), 'the falloff is symmetric')
ok(shimmerOpacity(0, 2.4) === 0.4, 'the falloff reaches baseline at 2.4 characters')

eq(shimmerDuration(0), 700, 'short strings clamp to the 700ms floor')
eq(shimmerDuration(5), 700, 'five characters still clamps')
eq(shimmerDuration(10), 1300, 'longer strings scale at 130ms per character')
