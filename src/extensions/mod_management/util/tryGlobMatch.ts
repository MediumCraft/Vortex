/* eslint-disable */
import memoizeOne from 'memoize-one';
import { Minimatch, MinimatchOptions } from 'minimatch';

export interface IMatcherArgs {
  pattern: string;
  expression: string;
  options?: MinimatchOptions;
}

const tryGlobMatch = memoizeOne((args: IMatcherArgs) => {
  const opts = args.options ?? { nocase: true, optimizationLevel: 2 };
  const matcher = new Minimatch(args.pattern, opts);
  return matcher.match(args.expression);
});

export default tryGlobMatch;