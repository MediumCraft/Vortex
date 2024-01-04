import { IExtensionContext } from '../../types/IExtensionContext';
import { IProfile, IMod, IState } from '../../types/IState';

import { actions, fs, log, selectors, tooltip, types, util } from 'vortex-api';

export default function init(context: IExtensionContext) {

  context.registerAction('mod-icons', 150, 'changelog', {}, 'Export', () => {
    const state: IState = context.api.getState();
    const activeGame: string = selectors.activeGameId(state);
    const activeProfile: IProfile = selectors.activeProfile(state);    

    const mods: { [modId: string]: IMod } = util.getSafe(state, ['persistent', 'mods', activeGame], {}); 

    Object.keys(activeProfile.modState).map((modId) => {

      const mod: IMod = mods[modId];

      if(mod === undefined) return; // if mod is undefined, skip it
      if(mod.type === 'collection') return; // if mod is a collection, skip it

      const modState = activeProfile.modState[modId].enabled ? '+' : '-';
      const name = mod.attributes?.modName ?? mod.attributes?.name ?? mod.attributes?.fileName ??  '';
      const version = mod.attributes?.version ?? '';
      const category: string = util.resolveCategoryName(mod.attributes?.category, state);
      const uploader = mod.attributes?.uploader ?? '';
      const source = mod.attributes?.source ?? '';
      const homepage = mod.attributes?.homepage ?? '';

      console.log(`[${modState}] ${name} | ${version} | ${category} | ${uploader} | ${source} | ${homepage}`);
    });
    
    return true;    
  });

}
