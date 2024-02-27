import { setUpdateChannel, showDialog } from '../../actions';
import { IExtensionApi } from '../../types/IExtensionContext';
import { IState, UpdateChannel } from '../../types/IState';
import { getVisibleWindow, UserCanceled } from '../../util/api';
import { log } from '../../util/log';
import opn from '../../util/opn';
import { truthy } from '../../util/util';

import { NEXUS_BASE_URL } from '../nexus_integration/constants';

import {app as appIn, dialog as dialogIn, ipcMain} from 'electron';
import {autoUpdater as AUType, ProgressInfo, UpdateInfo} from 'electron-updater';
import * as semver from 'semver';
import uuidv5 from 'uuid/v5';
import { RegGetValue } from 'winapi-bindings';
import { getApplication } from '../../util/application';

let app = appIn;
let dialog = dialogIn;
if (process.type === 'renderer') {
  // tslint:disable-next-line:no-var-requires
  const remote = require('@electron/remote');
  app = remote.app;
  dialog = remote.dialog;
}

const appName = 'com.nexusmods.vortex';
const ELECTRON_BUILDER_NS_UUID = '50e065bc-3134-11e6-9bab-38c9862bdaf3';

const myguid = (() => {
  let cached: string;
  return () => {
    if (cached === undefined) {
      cached = uuidv5(appName, ELECTRON_BUILDER_NS_UUID);
    }
    return cached;
  };
})();

interface IProgressInfo {
  bps: number;
  percent: number;
  total: number;
  transferred: number;
}

function openStable() {
  opn(`${NEXUS_BASE_URL}/site/mods/1`).catch(() => null);
}

function openTesting() {
  opn('https://www.github.com/Nexus-Mods/Vortex#release').catch(() => null);
}

function updateWarning() {
  dialog.showMessageBoxSync(getVisibleWindow(), {
    type: 'info',
    title: 'Vortex update',
    message: 'Vortex will be updated after closing. '
      + 'Please do not turn off your computer until it\'s done. '
      + 'If you interrupt the installation process Vortex may stop working.',
    buttons: ['Continue'],
    noLink: true,
  });
}

function setupAutoUpdate(api: IExtensionApi) {
  const autoUpdater: typeof AUType = require('electron-updater').autoUpdater;

  const state: () => IState = () => api.store.getState();
  let notified: boolean = false;
  let channelOverride: UpdateChannel;

  const parsedVersion = semver.parse(app.getVersion());  
  const lastUpdateChannel = state().settings.update.channel;
  //const newUpdateChannel = parsedVersion.prerelease[0] as UpdateChannel ?? undefined;

  // check what version the app is being run, and set channel accordingly. In case they've installed a beta but wasn't before
  log('info', 'version info', {
    getVersion: app.getVersion(),
    parsedVersion: parsedVersion,
    isPackaged: app.isPackaged,
    lastUpdateChannel
  });

  // we are running a pre-release version, so lets check if we need to update the channel
  if (parsedVersion.prerelease.length > 0) {

    // if we were stable before, then we need to update the channel to what we have now.
    // if we were pre-release before, we need to check what level

    const lastUpdateChannel = state().settings.update.channel;
    const newUpdateChannel = parsedVersion.prerelease[0] as UpdateChannel;

    // on stable, none or next channel last time, so need to change channel regardless
    if(lastUpdateChannel === 'stable' || lastUpdateChannel === 'latest' || lastUpdateChannel === 'none' || lastUpdateChannel === 'next' ) {
      api.store.dispatch(setUpdateChannel(newUpdateChannel));
      log('info', `Currently running a version of Vortex that is a pre-release (${newUpdateChannel}) and previously it was (${lastUpdateChannel}). Changing update channel to match`);
    } else if (lastUpdateChannel === 'beta' && newUpdateChannel === 'alpha') {
      //  we only want to update if it's now alpha, if it's the other way round, we don't care
      api.store.dispatch(setUpdateChannel(newUpdateChannel));
      log('info', `Currently running a version of Vortex that is more of a pre-release (${newUpdateChannel}) than previously (${lastUpdateChannel}). Changing update channel to match`);
    }
  }  

  log('info', 'setupAutoUpdate complete');

  const queryUpdate = (updateInfo: UpdateInfo): Promise<void> => {
    return new Promise<void>((resolve, reject) => {

      /*
      if (semver.satisfies(version, '^' + autoUpdater.currentVersion.version)) {
        // don't warn on a "compatible" update
        return resolve();
      }*/

      let filteredReleases = updateInfo.releaseNotes;
      
      if(typeof filteredReleases === 'string') {
        log('info', 'release notes are a string', filteredReleases);
      } else {
        log('info', 'release notes are an array'); 

        filteredReleases = filteredReleases.filter(release => {
          {
            const comparisonResult = semver.compare(release.version, updateInfo.version);
            return comparisonResult === 0 || comparisonResult === -1;
          }
        });

        log('info', 'filtered releases');     
        filteredReleases.forEach(release => {
          log('info', release.version);          
        });
      }      

      notified = true;

      
      api.sendNotification({
        id: 'vortex-update-notification',
        type: 'info',
        title: 'Update available',
        message: `${updateInfo.version} is available.`,
        noDismiss: true,
        actions: [          
          { title: 'What\'s New', action: () => {
            api.showDialog('info', `What\'s New in ${updateInfo.version}`, {
              htmlText: typeof filteredReleases === 'string' ? filteredReleases : filteredReleases.map(release =>                
                `<div class="changelog-dialog-release">
                  <h2>${release.version}</h2>
                  ${release.note}
                </div>`
                ).join(''),
            }, [
              { label: 'Close' },
              { label: 'Ignore', action: () => reject(new UserCanceled()) },
              { label: 'Download', action: () => resolve() }
            ],
            'new-update-changelog-dialog');
          } },
          {
            title: 'Ignore',
            action: dismiss => {
              dismiss();
              reject(new UserCanceled());
            },
          },
        ],
      });
    });
  };

  autoUpdater.on('error', (err) => {
    if ((err.message !== undefined) && err.message.startsWith('powershell.exe')) {
      api.showErrorNotification(
        'Checking for update failed',
        'Failed to verify the signature of the update file. This is probably caused '
        + 'by an outdated version of powershell or security settings that prevent Vortex from '
        + 'running it.\n'
        + 'You could try updating powershell, otherwise please disable automatic updates '
        + 'and update Vortex manually.',
        { allowReport: false });
    } else if (err.message === 'Unexpected end of JSON input') {
      api.showErrorNotification(
        'Checking for update failed',
        'Failed to verify the signature of the update file, please try again later.',
        { allowReport: false });
    } else if ((err.message === 'net::ERR_CONNECTION_RESET')
               || (err.message === 'net::ERR_NAME_NOT_RESOLVED')
               || (err.message === 'net::ERR_INTERNET_DISCONNECTED')) {
      api.showErrorNotification(
        'Checking for update failed',
        'This was probably a temporary network problem, please try again later.',
        { allowReport: false });
    } else {
      api.showErrorNotification('Checking for update failed', err, { allowReport: false });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (channelOverride !== undefined) {
      log('info', 'installed version seems to be a non-stable release, switching update channel');
      api.store.dispatch(setUpdateChannel(channelOverride));
      api.sendNotification({
        id: 'switched-to-beta-channel',
        type: 'info',
        message: 'You are running a beta version of Vortex so auto update settings have been '
               + 'changed to keep you up-to-date with current betas.',
      });
    }
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log('info', 'found update available', info);
    const installedVersion = semver.parse(getApplication().version);
    const version = semver.parse(info.version);

    const channel = channelOverride ?? api.getState().settings.update.channel;

    if ((channel === 'stable')
      && (channelOverride === undefined)
      && ((version.major < installedVersion.major)
        || (version.minor < installedVersion.minor))) {
      log('info', 'installed version newer than the available update, check if this is a beta');
      channelOverride = 'beta';
      return;
    }


    let instPath: string;
    if (process.platform === 'win32') {
      try {
        instPath = RegGetValue('HKEY_LOCAL_MACHINE',
                               `SOFTWARE\\${myguid()}`,
                               'InstallLocation').value as string;
      } catch (err) {
        api.sendNotification({
          type: 'warning',
          message: 'Update can\'t be installed automatically',
          actions: [
            { title: 'More', action: dismiss => {
              api.showDialog('info', 'Update can\'t be installed automatically', {
                text: 'An update for Vortex is available but it can\'t be installed automatically because '
                  + 'a necessary registry key has been removed. Please install the latest version of Vortex manually.',
              }, [
                { label: 'Close' },
                { label: 'Open Page', action: () => {
                  if (channel === 'beta') {
                    openTesting();
                  } else {
                    openStable();
                  }
                  dismiss();
                } },
              ]);
            } },
          ],
        });
        return;
      }
    }

    log('info', 'update available', {
      current: getApplication().version,
      update: info.version,
      instPath,
    });

    queryUpdate(info)
      .then(() => autoUpdater.downloadUpdate()
        .catch(err => {
          log('warn', 'Downloading update failed', err);
        }))
      .catch(() => null);
  });

  autoUpdater.on('update-not-available', () => {
    log('info', 'no update available');
  });

  autoUpdater.on('download-progress', (info: ProgressInfo) => {
    if (notified) {
      api.sendNotification({
        id: 'vortex-update-notification',
        type: 'activity',
        message: 'Downloading update',
        progress: info.percent,
      });
    }
  });

  autoUpdater.on('update-downloaded',
    (updateInfo: UpdateInfo) => {
      log('info', 'update downloaded');

      app.on('before-quit', updateWarning);


      let filteredReleases = updateInfo.releaseNotes;
      
      if(typeof filteredReleases === 'string') {
        log('info', 'release notes are a string', filteredReleases);
      } else {
        log('info', 'release notes are an array'); 

        filteredReleases = filteredReleases.filter(release => {
          {
            const comparisonResult = semver.compare(release.version, updateInfo.version);
            return comparisonResult === 0 || comparisonResult === -1;
          }
        });

        log('info', 'filtered releases');     
        filteredReleases.forEach(release => {
          log('info', release.version);          
        });
      }



      api.sendNotification({
        id: 'vortex-update-notification',
        type: 'success',
        message: 'Update downloaded',
        actions: [
          {
            title: 'What\'s New',
            action: () => {
              api.store.dispatch(showDialog('info', `What's New in ${updateInfo.version}`, {
                htmlText: typeof filteredReleases === 'string' ? filteredReleases : filteredReleases.map(release =>                
                  `<div class="changelog-dialog-release">
                    <h2>${release.version}</h2>
                    ${release.note}
                  </div>`
                  ).join(''),
              }, [
                  { label: 'Close' },
                ],
                'new-update-changelog-dialog'),
                );
            },
          },
          {
            title: 'Restart & Install',
            action: () => {
              app.removeListener('before-quit', updateWarning);
              autoUpdater.quitAndInstall();
            },
          },
        ],
      });
    });

  const checkNow = (channel: UpdateChannel) => {
    if (!state().session.base.networkConnected) {
      log('info', 'Not checking for updates because network is offline');
    }

    log('info', 'checking for vortex update:', channel);
    const didOverride = channelOverride !== undefined;


    /**
     * CONDITIONS FOR DEV ENV/TESTING/STAGING
     * If running in dev mode, then we aren't packed, and for updating to be tested we need to set the following:
     * 'autoUpdater.forceDevUpdateConfig = true;' and this will cause the autoUpdater to look for dev-app-update.yml
     *  dev-app-update.yml is a file that is created in the root of the project, and it contains the following:
     *  owner: Nexus-Mods
     *  repo: Vortex-Staging
     *  provider: github
     * 
     *  These settings are then the default that are used by autoUpdater
     * 
     *  if 'stable' is selected then we have to have the following for the releases to correctly match:
     *  autoUpdater.allowPrerelease = false; 
     *  GitHub 'Set as the latest release' on it's release and contain a latest.yml
     *  other versions are not considered if 'set as latest release' isn't used
     * 
     * if a prerelease channel is selected, like 'alpha' or 'beta' then we have to have the following for the releases to correctly match:
     *  autoUpdater.allowPrerelease = true;
     */

    // if we are running in dev mode, force the dev update config otherwise it won't run. new defaults are
    // set in the dev-app-update.yml file and this file must exist in the root of the project
    if(process.env.NODE_ENV === 'development') {
      autoUpdater.forceDevUpdateConfig = true;       
    }


    //autoUpdater.allowPrerelease = channel !== 'stable';

    // env USE_VORTEX_STAGING is basically used to determine if we are using our 'Staging' github repo, Vortex-Staging
    
    const useVortexStaging = process.env.USE_VORTEX_STAGING ?? 'false';    
    
    // official docs stay not to use this but I think that is for general use.
    // we do want to be able to set the repo based on the USE_VORTEX_STAGING env variable
    // in an installed, production setting    
    
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'Nexus-Mods',
      repo: useVortexStaging ? 'Vortex-Staging' : 'Vortex',
      updaterCacheDirName: 'vortex-updater', // matches the app-update.yml that is generated but not used because of this function
      private: false,
      publisherName: [
        'Black Tree Gaming Limited',
        'Black Tree Gaming Ltd'
      ]
    });    

    //autoUpdater.allowDowngrade = true;
    autoUpdater.autoDownload = false;  
    autoUpdater.fullChangelog = true; // not atm, but could be useful for the future

    switch (channel) {
      case 'stable':
      case 'latest':
        autoUpdater.allowPrerelease = false;
        autoUpdater.channel = 'latest';
        break;
      case 'alpha':
      case 'beta':
        autoUpdater.allowPrerelease = true;
        autoUpdater.channel = channel;
        break;
      default:
        autoUpdater.allowPrerelease = false;
        autoUpdater.channel = 'latest';
        break;
    }

    log('info', 'autoUpdater config is ', {
      //feed: autoUpdater.updateConfigPath,
      currentVersion: autoUpdater.currentVersion.version,
      channel: autoUpdater.channel,
      allowPrerelease: autoUpdater.allowPrerelease,
      allowDowngrade: autoUpdater.allowDowngrade,
      autoDownload: autoUpdater.autoDownload,
    });
    
    autoUpdater.checkForUpdates()
      .then(check => {
        log('info', 'completed update check', check.updateInfo);

        // do a check here for if a regular type (properly installed, not dev or epic or whatever)
        // then that's the only time that we want to do the auto download
        if (api.getState().app.installType === 'regular') {
          if (truthy(check.downloadPromise)) {
            check.downloadPromise.catch(err => {
              log('warn', 'Checking for update failed', err);
            });
          }
        }        

        if (!didOverride && (channelOverride !== undefined)) {
          return checkNow(channelOverride);
        }
      })
      .catch(err => {
        log('warn', 'Checking for update failed', err);
      });
  };

  ipcMain.on('check-for-updates', (event, channel: string) => {
    checkNow(channel as UpdateChannel);
  });

  ipcMain.on('set-update-channel', (event, channel: any, manual: boolean) => {
    try {
      log('info', 'set channel', { channel, manual, channelOverride });
      
      if ((channel !== 'none')     
        && ((channelOverride === undefined) || manual)    
        //&& (process.env.NODE_ENV !== 'development') 
        && (process.env.IGNORE_UPDATES !== 'yes')) {
        
        if (manual) {
          channelOverride = channel;
        }

        checkNow(channel);
      }
    } catch (err) {
      log('warn', 'Checking for update failed', err);
      return;
    }
  });
}

export default setupAutoUpdate;
