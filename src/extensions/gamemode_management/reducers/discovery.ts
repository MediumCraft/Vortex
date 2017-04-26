import { IReducerSpec } from '../../../types/IExtensionContext';

import { discoveryFinished, discoveryProgress, setPhaseCount } from '../actions/discovery';

import update = require('react-addons-update');

/**
 * reducer for changes to the known mods
 */
export const discoveryReducer: IReducerSpec = {
  reducers: {
    [setPhaseCount as any]: (state, payload) => {
      let res = update(state, { phases: { $set: {} } });
      for (let i = 0; i < payload; ++i) {
        res = update(res, {
          phases: { [i]: { $set: { progress: 0, directory: 0 } } },
        });
      }
      return res;
    },
    [discoveryProgress as any]: (state, payload) =>
      update(state, {
        running: {$set: true},
        phases: {
          [payload.idx]: {
            progress: {$set: payload.percent},
            directory: {$set: payload.directory},
          },
        },
      }),
    [discoveryFinished as any]:
        (state, payload) => update(state,
                                   {
                                     running: {$set: false},
                                     phases: {$set: []},
                                   }),
  },
  defaults: {
    running: false,
    phases: {},
  },
};
